## Rationale: L07 - multi-agent review plus its companion agent-run-log

Companion to `docs/plans/l07-multi-agent-review.md`.

### Affected modules
| Package / module | What changes | Why |
| --- | --- | --- |
| `server/src/modules/reviews` | Parallel fan-out, a new pure `multi-agent.ts`, a new `repository/multi-agent.repo.ts`, three service methods, four routes | It already owns `agent_runs`, `run_traces`, `reviews` and `findings`, and the new FK column sits on one of its tables. A separate module would have to write another module's table. |
| `server/src/modules/eval` | `overlaps` moves out of `scoring.ts` and is re-exported from it | Two modules now need one matching rule; `no-cross-module-imports` forbids either importing the other's internals. |
| `server/src/modules/_shared` | New `overlap.ts` | The only home both modules may import. |
| `server/src/db/schema/runs.ts` | One nullable FK column plus its index on `agent_runs` | `multi_agent_runs` exists but nothing points at it. |
| `server/src/vendor/shared` + `client/src/vendor/shared` | `observability.ts` and `trace.ts` in both copies | The L07 contracts exist but do not yet describe what the criteria need. |
| `server/.dependency-cruiser.cjs` | One new rule | "Clustering makes no model call" is the feature's central claim, and the L06 precedent enforces such a claim mechanically. |
| `client/src/components` | Gains `run-trace-drawer/` and `finding-card/` | Two routes now mount each, and `pnpm lint` forbids a route importing a sibling's `_components`. |
| `client/src/app/agents/[id]` | A fifth editor tab | The companion spec's whole point. |
| `client/src/app/repos/[repoId]/multi-agent` | New segment: layout, configure page, results page | The feature's screens. |
| `client/src/vendor/ui/nav.ts` | One data-only entry plus its shortcut | The only extension point; see below. |
| `client/src/lib/hooks` | New `runs.ts` and `multi-agent.ts` | Every data hook lives here. |
| `client/messages/en` | `runs.json` corrected and extended, `agents.json` gains one key | The pre-seeded strings contradict the spec in three places. |

### Verified facts this plan rests on
| Fact | Evidence |
| --- | --- |
| `POST /pulls/:id/review` accepts `all: true` and resolves every enabled agent | `server/src/modules/reviews/service.ts:46-57` |
| The executor awaits agents in a plain `for` loop | `server/src/modules/reviews/run-executor.ts:145` |
| The repository's existing queue default is concurrency 3 | `server/src/platform/jobs.ts:42` |
| `JobRunner` wraps every handler in `withRetry` at a default of 2 | `server/src/platform/jobs.ts:44,90-107`; the reasoning is written out at `server/src/platform/jobs.ts:47-61` |
| Eval runs deliberately stay off the job runner for that reason | `server/src/modules/eval/routes.ts:84-91` |
| Review runs are already fire-and-forget, not enqueued | `server/src/modules/reviews/service.ts:133` |
| 4 per minute is the tightest limit on this API and is used for exactly this reason | `server/src/modules/reviews/routes.ts:75`, `server/src/modules/eval/routes.ts:110` |
| `multi_agent_runs` exists with only `id, workspace_id, pr_id, ran_at` | `server/src/db/schema/runs.ts:52-61` |
| `agent_runs` carries no reference to it | `server/src/db/schema/runs.ts:8-42` |
| `agent_runs.pr_id` is `ON DELETE set null`, so a run outlives its pull request | `server/src/db/schema/runs.ts:16` |
| `agent_runs.status` has four values including `cancelled`, but `AgentColumn.status` has three | `server/src/db/schema/runs.ts:28` vs `server/src/vendor/shared/contracts/observability.ts:41` |
| `createAgentRun` hardcodes `source: 'local'` and takes no transaction handle | `server/src/modules/reviews/repository/run.repo.ts:224-247` |
| All N `agent_runs` rows are created up front, before execution, so `ran_at` is identical across a fan-out | `server/src/modules/reviews/service.ts:117-129` |
| `ConflictTake` has a required `note` alongside `verdict: Severity \| 'ignored'` | `server/src/vendor/shared/contracts/observability.ts:52-58` |
| `Conflict` declares a single `line` | `server/src/vendor/shared/contracts/observability.ts:66-71` |
| Both `observability.ts` copies are currently byte-identical, and both barrels re-export the file | `diff -q` returns clean; `server/src/vendor/shared/index.ts:33`, `client/src/vendor/shared/index.ts:33` |
| Nothing in the codebase reads the L07 contracts today | `rg` for `MultiAgentRun\|AgentColumn\|ConflictTake` finds only the two contract files |
| `FindingRecord` is `FindingShape` plus `review_id`, `accepted_at`, `dismissed_at` - exactly what `FindingCard` renders | `server/src/vendor/shared/contracts/review-api.ts:15-20`; `client/.../FindingCard/FindingCard.tsx:26-47` |
| `FindingCard` already offers exactly Accept, Dismiss and Turn into eval case - no Learn, no Reply | `client/.../FindingCard/FindingCard.tsx:104-128` |
| `FindingCard` has exactly one importer today | `client/.../FindingsPanel/FindingsPanel.tsx:9` |
| `EvalCaseModal` already lives at `@/components/eval-case-modal` and is mounted from two routes | `client/.../FindingsPanel.tsx:12`, `client/.../EvalsTab.tsx:22` |
| `overlaps` is file equality plus normalised range intersection | `server/src/modules/eval/scoring.ts:64-71` |
| `eval-scoring-is-pure` forbids `scoring.ts` from reaching platform, adapters, db, reviewer-core or drizzle | `server/.dependency-cruiser.cjs:20-31` |
| `no-cross-module-imports` exempts `modules/_shared/` and another module's `service.ts`/`types.ts`/`constants.ts` only | `server/.dependency-cruiser.cjs:47-71` |
| `rollupSeverities` is the in-repo precedent for moving a two-module helper into `_shared` | `server/src/modules/_shared/severity.ts:1-9`; `server/INSIGHTS.md:420-426` |
| `p-queue` is already a dependency and is already imported from inside a module | `server/package.json:45`; `server/src/modules/repo-intel/pipeline/full.ts:25,126` |
| `AgentsRepository.listEnabled` has NO `orderBy`, so enabled agents come back in arbitrary order | `server/src/modules/agents/repository.ts:63-68` |
| `agents.description` exists and is non-null | `server/src/db/schema/agents.ts:14` |
| `findings` carries `rationale` and `confidence`, which the cluster cell and the title tie-break need | `server/src/db/schema/reviews.ts:47,50` |
| `reviewsForPull` returns every review of the pull request with its agent name, so a multi-agent run's findings already all appear on the PR page | `server/src/modules/reviews/service.ts:160-174` |
| A window subquery is built with the drizzle query builder plus `.as()`, not raw SQL | `server/INSIGHTS.md:482-490` |
| `activeKeyFor` already returns `multi-agent` for any path containing `/multi-agent`, checked before the `pulls` branch | `client/src/components/app-shell/helpers.ts:26-40` |
| `NAV` has two groups, WORKSPACE and SKILLS LAB, and repo scoping is the literal `:repoId` token in `href` | `client/src/vendor/ui/nav.ts:21-39,77-80` |
| L02, L05 and L06 each added their nav entry to the frozen `nav.ts` as the same two-line diff | commits `346bc7e`, `ac5edd8`, `cf38793`, `cebd9dd`, `3fe1394` |
| Editing `nav.ts` is recorded as the one sanctioned, data-only exception to the vendored-UI freeze | `client/INSIGHTS.md:147-158` |
| Adding an editor tab is THREE edits, and missing `VALID_TABS` fails silently past typecheck, lint and the component test | `client/INSIGHTS.md:64-72`; `client/src/app/agents/[id]/page.tsx:16-17` |
| `TABS` is declared in the editor's own `constants.ts`; `AgentEditor` takes `tab`/`onTab` as props | `client/.../AgentEditor/constants.ts:11-16`; `client/.../AgentEditor.tsx:17-36` |
| `RunTraceDrawer` has exactly one importer, via a relative path, and its props are `runId`, `agentName?`, `prNumber?`, `findings?`, `running?`, `onClose` | `client/.../pulls/[number]/page.tsx:19,249-257`; `client/.../RunTraceDrawer.tsx:19-29` |
| The PR page opens the drawer through `?trace=` and does NOT pass `running`, so a live run opens on the trace tab with no SSE subscription | `client/.../page.tsx:85,221,249-257`; `client/.../RunTraceDrawer.tsx:41,46` |
| Neither the drawer nor `vendor/ui/kit/Drawer.tsx` implements focus trapping or focus return, despite `aria-modal="true"` | `client/src/vendor/ui/kit/Drawer.tsx:26-27,21-24,55` |
| The sibling-`_components` ban is a `no-restricted-imports` regex that allows ancestor and own-feature imports | `client/eslint.config.mjs:86-110` |
| `client/messages/en/runs.json` is pre-seeded with `page.*`, `conflicts.*` and `column.*` keys | `client/messages/en/runs.json` |
| Three of those pre-seeded strings contradict the spec: `page.subtitle` says "every enabled agent", `page.runAll` reads "Run all agents", `page.meta` reads "fan-out via p-queue" | same file; contradicts AC-5, AC-7 and AC-32 |
| A new message namespace needs no registration - `request.ts` scans the directory | `client/src/i18n/request.ts:16-25` |
| `usePrRuns` polls every 4 s while a run is running, and `reviewsKeys` is the key factory | `client/src/lib/hooks/reviews.ts:21-24,48-56` |
| `localStorage` precedents are `dd-repo` and `dd-theme`, both hand-rolled, with no shared hook | `client/src/lib/repo-context.tsx:31,40`; `client/src/lib/theme.tsx:26` |
| `repos/[repoId]/onboarding` is the repo-scoped page template: thin `page.tsx`, its own `layout.tsx` mounting `ShellLayout` | `client/src/app/repos/[repoId]/onboarding/page.tsx:17-26`, `layout.tsx:1-9` |
| e2e flow 04 asserts the literal substring "2 findings" in the ReviewRunAccordion header | `client/INSIGHTS.md:171-174`; `e2e/specs/04-pr-findings.flow.json` |
| `server/package.json` is `skip-worktree`, so CI invokes the test split directly rather than through committed scripts | `TESTING.md:109-112` |

### Traceability

**Main spec, `docs/specs/L07-multi-agent-review.md`**

| Requirement | Step(s) | Acceptance criterion |
| --- | --- | --- |
| AC-1 | D2 | Multi-Agent Review sits in the WORKSPACE nav group |
| AC-2 | D2 | the shell highlights exactly one item on that page |
| AC-3 | D3 | the run control reads `(0)` ... (configure-screen component test) |
| AC-4 | D3 | same |
| AC-5 | D3, C3 | same |
| AC-6 | D3 | an agent row shows only icon, name and description |
| AC-7 | D3 | the run control reads `(0)` with nothing selected |
| AC-8 | D3, B2 | ... stays disabled below two agents |
| AC-9 | D3 | same |
| AC-10 | D3 | same |
| AC-11 | C3, C4, D3 | the estimate is the max of the selected medians |
| AC-12 | C3, C4, D3 | ... and the sum of the selected medians |
| AC-13 | C3, D3 | ... partial when an agent has no history |
| AC-14 | C3, D3 | ... absent when none does |
| AC-15 | C3, C4, D3 | same, plus no provider request in the integration file's read assertions |
| AC-16 | C3, C4 | a five-agent run ... (integration file, run-row count case) |
| AC-17 | C1, C5 | a five-agent run never has more than three model calls in flight |
| AC-18 | C1, C5 | a multi-agent run loads its diff once |
| AC-19 | C1, C5 | ... and derives its intent once |
| AC-20 | C5 | no agent's output appears in another agent's persisted prompt assembly |
| AC-21 | C3, C5 | a five-agent run ... (field-by-field comparison case) |
| AC-22 | C1, C3, C5, D4 | one failing agent leaves the others' results intact |
| AC-23 | C3, C5, D4 | every agent failing marks the run failed with each error shown |
| AC-24 | C3, C5, D4 | duration is the max |
| AC-25 | C3, C5, D4 | cost is the sum |
| AC-26 | B2, C3, D4 | an unknown cost marks the total partial |
| AC-27 | B2, D5 | the run history shows one multi-agent run as one group |
| AC-28 | D5 | ... that navigates to its results |
| AC-29 | verify only (no change) | a finding accepted from the results screen shows as acted on in the PR's findings list |
| AC-30 | D4 | the results screen offers columns and tabs |
| AC-31 | D4 | ... and remembers the choice across a reload |
| AC-32 | C3, D3, D4 | (header line, results component test) |
| AC-33 | B2, C3, D4 | (per-agent column/tab content, results component test) |
| AC-34 | C3, D4 | same |
| AC-35 | C3, D4 | same |
| AC-36 | C2, C5 | reading a multi-agent run's results issues zero provider requests |
| AC-37 | D1, D4 | (Accept / Dismiss / Turn into eval case only, results component test) |
| AC-38 | D4 | a finding accepted from the results screen shows as acted on |
| AC-39 | B2, C3, D4 | a failed agent shows its error in place of a score |
| AC-40 | B2, C3, D2, D4 | a running agent is shown as running |
| AC-41 | B1, C2, C5 | the cluster set for two findings at 28-30 and 29-31 |
| AC-42 | C2 | `multi-agent.ts` cannot reach the container, an adapter, the DB or the engine |
| AC-43 | C2, C5 | (cluster title case in the pure test) |
| AC-44 | B2, C2, D4 | (the `file:line` label, results component test) |
| AC-45 | C2, C3, D4 | one column per agent in every row |
| AC-46 | C2, C5 | a cluster every successful agent flagged identically is absent |
| AC-47 | C2, D4 | (the show-only-conflicts toggle, results component test) |
| AC-48 | B2, C2, D4 | a silent cell reads "did not flag" and nothing else |
| AC-49 | B2, C2, D4 | ... a failed agent's cell is visibly distinct from it |
| AC-50 | B2, C2, D4 | (severity plus one-line rationale, results component test) |
| AC-51 | C2, C5 | (highest-severity-wins case in the pure test) |
| AC-52 | C2, D4 | (the "agents agreed" state, results component test) |
| AC-53 | verify only (no change) | nothing regressed anywhere |
| AC-54 | verify only (existing citation gate) | a finding off the diff never reaches a column or a cluster (integration file) |
| AC-55 | verify only (no change) | nothing regressed anywhere |

**Companion spec, `docs/specs/L07-agent-run-log.md`**

| Requirement | Step(s) | Acceptance criterion |
| --- | --- | --- |
| AC-1 | A3 | the Runs tab appears after Evals |
| AC-2 | A3 | ... is reachable at `?tab=runs` after a reload |
| AC-3 | A1, A3 | ... lists only that agent's runs |
| AC-4 | A1, A3 | ... newest first |
| AC-5 | A1 | same (no source filter in the query) |
| AC-6 | A1, A3 | same (row content) |
| AC-7 | A1, A3 | same (failed row) |
| AC-8 | A1, A3 | same (row with no pull request) |
| AC-9 | A3 | same (empty state) |
| AC-10 | A2, A3 | ... and opens each into the shared drawer |
| AC-11 | A2 | the PR page's drawer behaviour is unchanged by the move |
| AC-12 | A2, A3 | (no-trace state, drawer test) |
| AC-13 | A2, A3 | (live log for an in-flight run) |
| AC-14 | A2 | (focus return, drawer test) |
| AC-15 | A2, D1 | the trace drawer lives in `client/src/components/run-trace-drawer/` |
| AC-16 | A2 | the PR page's drawer behaviour is unchanged by the move |
| AC-17 | A1, A3 | the Runs tab loads in one request |
| AC-18 | A3 | ... and requests a trace only when a drawer opens |

**Clarification defaults** (see the plan's Open questions)

| Default | Step(s) | Acceptance criterion |
| --- | --- | --- |
| The parallel fan-out applies to every fan-out, including the PR page's "run all" | C1 | nothing regressed anywhere |
| AC-17 is verified by counting concurrent model calls, not by reading `ran_at` | C5 | a five-agent run never has more than three model calls in flight |
| The contradicting pre-seeded `runs.json` `page.*` strings are rewritten to match the spec | D3 | the run control reads `(0)` with nothing selected |

### Lessons from INSIGHTS.md
- Adding an editor tab is THREE edits, and the missing `VALID_TABS` entry fails silently past typecheck, lint and the component test - `client/INSIGHTS.md:64-72` - Step A3 names all three files explicitly, because L05's Context tab shipped broken on exactly this.
- `client/src/vendor/shared` is types-only in practice; the first runtime value import breaks `pnpm build` while every other gate stays green - `client/INSIGHTS.md:307-318` - Steps A3 and D2 mandate `import type`, and every client step's verify list carries `pnpm build`.
- Editing `nav.ts` is the one sanctioned, data-only exception to the vendored-UI freeze, and `activeKeyFor` / `shell.json` keys are usually pre-shipped - `client/INSIGHTS.md:147-158` - Step D2 takes the exception knowingly and greps `shell.json` first.
- The sidebar's active item carries no accessible attribute, so "the right nav item is highlighted" is only assertable at the `activeKeyFor` seam - `client/INSIGHTS.md:274-283` - AC-2's acceptance criterion targets `helpers.test.ts`, not the DOM.
- A shared component gains a capability through OPTIONAL props, never a fork - `client/INSIGHTS.md:138-146` - Steps A2 and D1 move components without changing their prop contracts.
- The workaround for a frozen `vendor/ui` primitive belongs in the FEATURE - `client/INSIGHTS.md:119-127` - Step A2 puts focus return in the promoted drawer, not in `vendor/ui/kit/Drawer.tsx`.
- Order is not a contract anywhere in this stack; a surface that needs one must establish it - `client/INSIGHTS.md:86-97` - Step C2 defines the agent order explicitly, because `listEnabled` has no `orderBy`.
- Don't poll `agent_runs.status === 'done'` and then read `run_traces`; the status flips inside the transaction while `saveRunTrace` runs after it, and the race is invisible in a single-file run - `server/INSIGHTS.md:261-274` - Step C5 polls for the trace document.
- An integration test that omits a provider from `overrides.llm` reads the developer's real keys and spends money - `server/INSIGHTS.md:248-259` - Step C5 mandates `MockSecretsProvider({})`.
- A green integration lane is NOT evidence a file ran; a file whose Docker probe failed reports "N skipped" and the lane still exits 0 - `server/INSIGHTS.md:285-293` - Step C5's verify line says to read the per-file lines.
- `JobRunner.enqueue` re-runs a whole handler up to three times per click and re-issues the model call even when the throw came after it succeeded - `server/INSIGHTS.md:359-369` - Step C1's "does not" is written from this.
- Path-classification knowledge two modules need belongs in `_shared`, because `no-cross-module-imports` exempts only `service.ts`/`types.ts`/`constants.ts` - `server/INSIGHTS.md:332-344` - Step B1's placement.
- "The latest review of a PR" is not `reviewsForPull(prId)[0]`, and taking only the newest row silently drops all but one agent's findings "the moment multi-agent runs land (L07)" - `server/INSIGHTS.md:413-419` - the reason AC-29 needs no change: `reviewsForPull` returns every review, and `smart-diff` already groups by `run_id`. Worth re-reading during Step C5 if any PR-page count comes out low.
- `drizzle-kit generate` turns interactive and hangs on piped stdin when one table both gains and drops columns - `server/INSIGHTS.md:504-509` - Step B3 keeps the edit additive and forbids piping.
- `sum()` returns a STRING; wrap in `Number()` before it meets a zod `z.number()` - `server/INSIGHTS.md:499-501` - relevant to `total_cost_usd` in Step C3.
- Services are constructed as `new XService({ db } as unknown as Container)` in some tests, so a service must build its own repository from `container.db`; container getters are for cross-module reads only - `server/INSIGHTS.md:439-449` - Step C3 keeps `ReviewService`'s existing shape.
- A build cache, not a code bug, is the usual cause of a mass integration failure - `server/INSIGHTS.md:569-580` - read before debugging a red lane.

### Skills applied while planning
| Skill | How it was loaded | What it constrained in this plan |
| --- | --- | --- |
| `onion-architecture` | preloaded | Put the whole feature in `modules/reviews` rather than a new module, because a new module would have to write `agent_runs` - another module's table. Kept the transaction boundary in the service (Step C3), kept the routes to zod plus one service call (Step C4), and put the shared `overlaps` in `modules/_shared/` (Step B1) because rule 2's repository ownership and `no-cross-module-imports` leave no other legal home. Also drove adding the `multi-agent-clustering-is-pure` rule, following the skill's "architecture that isn't mechanically checked erodes". |
| `frontend-ui-architecture` | preloaded | The promotion rule ("promote when a SECOND consumer appears") is why `RunTraceDrawer` and `FindingCard` move to `src/components/` in Steps A2 and D1 and not before, and why `EvalCaseModal` moves nowhere. Unidirectional imports fixed the destination as `src/components/`, since the pulls route and the agents route share no ancestor segment. "Logic out of components" shaped the view -> hook -> `lib/api` layering of Steps A3, D2, D3, D4. |
| `next-best-practices` | preloaded | Each new segment gets its own `layout.tsx` mounting `ShellLayout` and a thin `page.tsx` (Steps D3, D4), following the App Router hybrid organisation and the existing onboarding segment. The results screen is addressed by a `[runId]` dynamic segment rather than a query parameter, so AC-28 has a real destination. |
| `postgresql-table-design` | preloaded | Step B3's FK gets a MANUAL index, because Postgres does not auto-index FK columns, and an explicit `ON DELETE` action is chosen rather than defaulted - `set null`, matching the existing `agent_runs.pr_id` intent that a run outlives its parent. Also why no new table was added: the link is single-valued, so a column beats a junction table. |
| `zod` (frontmatter only) | routed, not invoked | The contract edits stay declarative in both copies; `MultiAgentRunRequest.agent_ids.min(2)` moves the "two agents minimum" rule to the boundary. |
| `drizzle-orm-patterns` (frontmatter only) | routed, not invoked | The last-ten-per-agent read is a window subquery built with the query builder plus `.as()`, per the in-repo precedent, not raw SQL. |

### Recommendations
- **Add `finding_id: z.string().nullable()` to `ConflictTake` now.** The spec's Design review lists "a cluster cell could link to the finding it stands on" as `open`, and the cost of adding the field while the contract is already being edited is one line in two files. Deciding it later means a second contract change in both vendor copies. The plan above does NOT do this, because an `open` line is not settled product behaviour.
- **Seed one multi-agent run in `server/src/db/seed.ts`.** It would let `e2e/specs/` cover the results screen, the columns/tabs toggle and the disagreement table deterministically with no LLM and no key, which is exactly the gap the plan currently accepts. It is scope the specs did not ask for.
- **Extract a small `usePersistedPreference` hook when adding `dd-multi-agent-view`.** It would be the third hand-rolled `localStorage` read/write in the client (`dd-repo`, `dd-theme`), which is where the promotion rule says to extract. The plan hand-rolls the third one to keep the step small.
- **Give `AgentsRepository.listEnabled` a deterministic `orderBy`.** It has none today, so "all enabled agents" comes back in arbitrary order for every existing caller, including the PR page's "run all". The plan works around it by sorting in the new surfaces rather than changing a shared read mid-feature.
- **Consider showing the grounding summary on a Runs-tab row.** The companion's Design review calls it "the single best one-glance signal of a prompt that started hallucinating locations", it is already on the run row, and the tab is the screen where a prompt is being tuned. It is marked `open`, so the plan leaves it out.

### Risks and forks
- **N concurrent per-agent transactions all `UPDATE` the same `pull_requests` row** through `markReviewed` (`run-executor.ts:353`), inside the same transaction that inserts the review and its findings. The lock order is identical in every transaction, so a deadlock is not expected, but the row lock is held for each agent's whole persistence transaction and serialises the tail of the fan-out. Options: leave it (recommended - the transactions are short and correctness is unaffected), or hoist `markReviewed` to a single call after the queue drains. Default: leave it, with the stop condition in the plan. This is the step the planner was least sure of.
- **AC-17's stated observation point does not exist.** All N `agent_runs` rows are created up front (`service.ts:117-129`) with `ran_at` defaulting to `now()`, so the recorded start times of a five-agent run are indistinguishable. Options: add a `started_at` column, or count concurrent model calls in the integration test. Recommended: count the calls - it needs no schema change, and it is the same technique L06 used to make "no model call per case" a real assertion rather than a hopeful one.
- **The pre-seeded `runs.json` `page.*` strings contradict the spec** in three places. Rewriting them is the right call, but they were shipped by the design system ahead of the lesson, and if an `e2e` flow asserts one of them the rewrite breaks it. Stop condition in the plan; the implementer should grep `e2e/specs/*.flow.json` for the strings before editing.
- **Making the whole fan-out parallel changes the existing PR-page "run all" path**, not just the new one. That is the simpler implementation and the spec calls the `for` loop the real backend change, but it is a behaviour change to a shipped feature. The existing `reviews.it.test.ts` and `skills.it.test.ts` are the regression check.
- **`server/package.json` is `skip-worktree`.** Do not add a `verify:l07` script and rely on it; the committed file diverges from the local one, which is why CI invokes `pnpm exec vitest run ...` directly. Every verify line in the plan uses the direct invocation.
- **Payload size.** Putting `FindingRecord` in `AgentColumn.findings` sends full rationales and suggestions for every agent's findings in one response. The spec's NFR is "one request", not a byte budget, and it is what lets the tabs view mount the existing card unchanged. If a ten-agent run with 200 findings each turns out to be slow to transfer, the fix is pagination in the columns view, not a second shape.
- **The `RunLogger` fan-out under concurrency.** Three agents now emit into the shared pre-work logger at once. `parentLog.forRun(runId)` narrows per run and each trace is built from that run's own buffer, so the persisted traces should stay correct - but this is behaviour nothing tests today, and Step C5 should assert that each run's persisted `log` contains its own agent's events and the shared diff/intent events, and nothing from another agent.
- **Open question only the user or a researcher can settle:** whether the `Users` icon key exists in the vendored icon set for the nav entry. The implementer should read `client/src/vendor/ui` for the available `Icon.*` names before writing it, and pick an existing one - `vendor/ui` may not be extended.

### Alternatives rejected
- **A new `modules/multi-agent` server module.** It would own `multi_agent_runs` cleanly, but it would have to write `agent_runs.multi_agent_run_id` - a column on a table the `reviews` module owns - which `queries-live-in-repositories` and the one-owning-repository-per-table rule both forbid. Routing that write back through `ReviewService` would give the feature two homes for one transaction.
- **A join table between `agent_runs` and `multi_agent_runs`.** Wider than the requirement: nothing wants one agent run in two multi-agent runs, and the spec says so explicitly.
- **Keeping `AgentColumnFinding` as a reduced shape.** Two finding shapes on one screen means the columns view and the tabs view read different objects, and the tabs view would need a second request or a second contract to get the rationale and the action state. One shape is fewer moving parts, and the existing card already consumes it.
- **Adding a `status` column to `multi_agent_runs`.** Every value it would hold is derivable from the member runs on read, and a stored status is a second source of truth that can disagree with them after a reap.
- **SSE for the results screen.** `useRunEvents` exists and would work, but the screen needs the whole aggregate re-derived, not an event stream, and `usePrRuns`'s 4-second poll is the pattern this codebase already uses for exactly this. Polling is fewer moving parts.
- **Putting `overlaps` in `vendor/shared`.** `evalF1`/`evalWilson` live there because the client displays the same numbers the server computes. No client consumer of `overlaps` exists, and a runtime value in the client's copy of the barrel breaks `pnpm build` while every other gate stays green.
- **Adding a `started_at` column to make AC-17 observable in SQL.** New persistence for an observability criterion that the integration test can answer directly, and the companion spec's own NFR is "no new persisted data".
