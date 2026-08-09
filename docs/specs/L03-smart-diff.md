# L03 — Smart Diff

## Goal

Stop presenting a pull request as a flat, arbitrarily ordered list of files.
GitHub returns changed files in an order that owes nothing to what the change is *about*, so a reviewer meets a 92-line `package-lock.json` hunk with the same weight as the token-bucket limiter the PR exists for.

Smart Diff re-orders the **Files changed** tab by the role each file plays in the change — **core**, **wiring**, **boilerplate** — collapses what should be skimmed, and expands and marks whatever the last review flagged.

The whole feature is built around one non-negotiable: **it costs nothing to compute.**
No LLM call, no new table, no migration, no cache, no contract change.
Every answer is a pure function of data the PR already carries, which is why the grouping is available the moment a PR is imported and can never drift from the diff the user is reading.

## Scope

1. **`smart-diff` server module** — `GET /pulls/:id/smart-diff`, returning the `SmartDiff` contract that has shipped unused in `contracts/brief.ts` since the starter.
   It owns no state and has **no `repository.ts`**: it reads entirely through `container.reviewRepo`, so it never imports the query builder.
2. **A deterministic classifier** — `modules/smart-diff/classify.ts` is pure (no I/O, no container), with every pattern and threshold in `constants.ts`.
   It is therefore testable as a table, and the rules can be read without reading the algorithm.
3. **Split suggestion** — the same pass reports whether the PR is too large to review in one sitting, and which directories it would fall apart into.
4. **`SmartDiffViewer`** — the Files-changed tab in reviewer order, with a Smart / Original toggle. Original renders today's `DiffViewer` untouched.
5. **Line-level marks** — the existing `FileCard` / `CodeLine` gain *optional* props, so the plain diff behaves exactly as before.

Out of scope: `pseudocode_summary` (see Decisions), Blast Radius, PR Brief composition, and any re-ordering *inside* a file.

## Data flow

`GET /pulls/:id/smart-diff` → `getContext` resolves the workspace → `SmartDiffService.pullOr404` resolves the PR **first** (the tenancy boundary — `pr_files` and `findings` carry no `workspace_id` of their own) → `container.reviewRepo.getPrFiles` and `.reviewsForPull` run in parallel → `latestReviewFindings` keeps the newest review, plus every review sharing its `run_id` → `findingLinesByPath` drops dismissed findings and keys the rest by `start_line` → `buildSmartDiff` classifies, groups, sorts and sizes → the route serialises against `SmartDiffResponse`.

On the client, `useSmartDiff` supplies the grouping and `usePrReviews` (already in cache for the Agent-runs tab) supplies the severity of each flagged line.
`FileCard` receives a `flags` map and a `defaultOpen` decision per file.

## Decisions

- **`pseudocode_summary` is always `null`.**
  The contract keeps the field, and the UI omits the row. Filling it means either an LLM call — which contradicts the feature's premise — or a mechanical "adds foo(), imports bar" line that reads worse than no line at all. The seam stays open for a later lesson.
- **A severity mark is a control, not decoration.**
  Clicking one crosses to the Agent runs tab with that exact `FindingCard` opened, focused and scrolled to, via `?finding=<id>` in the URL — so the jump survives a reload and can be shared.
  The mark carries the finding's **id**, not just its severity, which is why `flags` is `Map<line, FindingFlag>`; a line the server flagged that the client cannot resolve to a finding still renders, but stays inert rather than looking clickable and doing nothing.
  Each accordion decides for itself whether it owns the finding, rather than the tab resolving a run id — that also works for a review predating run tracking, which the existing `targetRunId` path cannot match.
- **The Smart/Original choice lives in `?order=`, not component state.**
  The tab unmounts on every switch, so component state silently dropped the reader back to Smart order each time they came back from Findings — which is precisely the trip the severity marks now encourage.
- **Severity is not in the contract.**
  The server owns *which* lines are flagged (`finding_lines`); the client colours them from the reviews it already holds. This keeps the endpoint a pure grouping of files, and keeps the marks in step with the findings list the user is looking at — including one they just dismissed.
  A line the server flagged but the client cannot colour still renders (as `INFO`); a lookup miss must never silently drop a flagged line.
- **Company / assistant context collapses, but is its own rule.**
  `.company/`, `.claude/`, `.cursor/` (at any depth), a `MEMORY.md` or `*.memory.*` anywhere, and `.github/copilot-*` are knowledge a team keeps beside the code — not application code, and not what the PR is about.
  They join the `boilerplate` group rather than earning a fourth role, because a new `SmartDiffRole` would change the Zod enum in both vendored contract copies for a difference the reviewer does not act on: both groups mean "collapsed, skim".
  They get a separate predicate (`isCompanyContext`) rather than being folded into the boilerplate lists, because the *reason* differs — boilerplate is generated bulk, this is maintained prose — and the next person changing one list should not silently change the other.
  Every rule is name-scoped so real code is never demoted: `src/company/billing.ts`, `src/memory/cache.ts` and `src/copilot-session.ts` all stay `core`, and `.github` stays wiring apart from the Copilot files.
- **Most specific wins, and `core` is the default.**
  Boilerplate beats wiring beats core, so a generated `index.ts` under `dist/` is build output rather than a barrel. An unrecognised path is always `core`, so the failure mode is "reviewed unnecessarily", never "skimmed by mistake".
- **A patch of nothing but imports/exports is wiring wherever it lives.**
  It requires at least one real `import`/`export`, so a brace-only refactor inside real code is not swept in.
- **Empty groups are omitted.**
  A section headed "Boilerplate · 0 files" is chrome. Callers needing a fixed three-group shape reindex by `role`.
- **A flagged file opens regardless of its role.**
  A finding in a lock file is exactly the one boilerplate change worth reading. Role decides the default; a finding overrides it.
- **Dismissed findings are excluded; accepted ones are not.**
  The user has ruled on a dismissed finding, and letting it keep a file expanded would make dismissing feel inert. An accepted finding is work still to be done.
- **A split is only suggested when there is something to split into.**
  Over-threshold PRs whose files all sit in one directory get the size warning and an empty `proposed_splits` — proposing a single split containing every file is noise, not advice. Boilerplate is excluded from the buckets: a lock file follows whichever split its manifest lands in.
- **The route 404s rather than returning null**, unlike `GET /pulls/:id/intent`. An intent may legitimately not exist yet; every imported PR has a smart diff, and an empty one only means it changed no files.
- **No contract change.**
  `SmartDiff`, `SmartDiffRole`, `SmartDiffFile`, `ProposedSplit` and `SmartDiffResponse` already existed in both vendored copies of `@devdigest/shared`, byte-identical. Nothing was added, so nothing could drift.
- **The seeded PR's `pr_files` gained patch text.**
  The demo PR's four files had `patch = NULL`, so the whole Files-changed tab read "No diff text available" and the feature's line marks were invisible in the demo data. Each file now carries the first hunk of its patch, line-accurate where it matters: the seeded findings point at `src/config.ts:12` and `src/api/users.ts:45`, and those are exactly the lines the patches add.

## Acceptance criteria

- The Files-changed tab opens in Smart order, showing a **Core logic / Wiring / Boilerplate** section per non-empty group, each with the description that says how much attention it deserves and its file count.
- `src/config.ts` on the seeded PR is expanded despite being wiring, reports "1 finding" in its header, and marks line 12 with a `CRITICAL` rail **and** an icon-plus-label badge — never colour alone.
- Clicking a file's finding badge expands it and scrolls its first flagged line into view.
- Toggling to **Original order** renders the pre-existing `DiffViewer` unchanged, and inline GitHub commenting works in both orders.
- A PR with no reviews still groups correctly, with every `finding_lines` empty.
- Clicking a severity mark on a flagged line opens the Agent runs tab with `?finding=<id>`, that finding's card expanded and focused, and the run's accordion open.
- `cd server && pnpm verify:l03` runs the whole lesson's suite in one command, and self-skips the DB-backed half when Docker is unavailable.
- `GET /pulls/:id/smart-diff` 404s for an unknown id and for a PR in another workspace, and 422s on a non-uuid id before the handler runs.
- A PR over 400 changed lines or 20 files gets the split banner; one whose files share a single directory gets the banner with no proposed splits.
- `pnpm arch:check` passes in `server/` with no new allowlist entry, and `diff` reports both vendored copies of `contracts/brief.ts` and `contracts/review-api.ts` identical and unchanged.
