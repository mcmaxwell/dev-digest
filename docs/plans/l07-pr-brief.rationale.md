# Rationale: L07 PR Brief - grounded risks, ranked review focus, and an append-only brief history

Contract: `docs/plans/l07-pr-brief.md`
Spec: `docs/specs/L07-pr-brief.md`

The implementer never opens this file. It exists for humans and for `plan-verifier`.

## Affected modules

| Package / module | What changes | Why |
| --- | --- | --- |
| `server/src/vendor/shared` + `client/src/vendor/shared` | New `contracts/pr-brief.ts`, one barrel line each | The envelope is a new vocabulary extending `brief.ts` + `blast.ts`; the barrel `export *`s all three, so nothing imported may be re-exported |
| `server/src/db/schema/reviews.ts` | `pr_brief` gains 8 columns; new `pr_brief_history` table | The existing `pr_id` PK is exactly right for the current brief; nothing in the table can express an append-only timeline |
| `server/src/modules/_shared` | `hunk-map.ts` arrives from `intent/` | `no-cross-module-imports` blocks the brief from importing `intent/hunk-map.ts`; `_shared/` is the sanctioned destination and `diff-loader.ts` is the precedent |
| `server/src/modules/intent` | `hunk-map.ts` and two constants leave; `sources.ts:14` import path | Consequence of the move; `buildFileMap`'s behaviour is unchanged |
| `server/src/modules/brief` (new) | The whole module | Owns the use case, the one model call, grounding and two tables |
| `server/src/modules/reviews` | One query + one delegate | `pr_files` is owned there; the prior-PR overlap query must live with its table |
| `server/src/platform/prompt-log.ts` | `call` union gains `'brief'` | It is a closed union at `:89` and `:111`; a new call kind cannot be logged without it |
| `server/src/modules/index.ts` | One import + one entry | Static module registry |
| `server/src/modules/blast/routes.ts` | Doc comment only | Marking the summary route deprecated, per the spec's disposition table |
| `client/src/lib/hooks/brief.ts` (new) | Query keys + read + generate | Every data hook lives in `lib/hooks/*` |
| `client/.../_components/PrBriefCard` (new) | The card | Colocated feature logic with its own test, per `client/AGENTS.md:33-34` |
| `client/.../_components/OverviewTab` | One render site | Where the card mounts, below the shipped auto-fit grid |
| `client/.../_components/IntentCard` | Risk-area block removed | AC-41, AC-42 |
| `client/.../_components/BlastRadiusCard` | Summary block unrendered + its two tests | AC-32 |
| `client/src/components/diff-viewer/**` + `page.tsx` + `DiffTab` | Optional `focusFile` prop chain | AC-38 has no existing mechanism |
| `client/messages/en/brief.json` | New keys in the existing namespace | `i18n/request.ts` auto-discovers files; the `brief` namespace already serves this tab |

## Verified facts this plan rests on

| Fact | Evidence |
| --- | --- |
| `no-cross-module-imports` exempts only `service.ts` / `types.ts` / `constants.ts` + `_shared/`, and `dependencyTypesNot: ['type-only']` means value imports are caught | `server/.dependency-cruiser.cjs:33-57` |
| The config carries NO allowlist, so any violation is a hard fail (AC-54) | `server/.dependency-cruiser.cjs:7-91` - six rules, zero exceptions blocks |
| `toBriefIntent` lives in `intent/helpers.ts` and takes `IntentClassification`, not `PrIntent` | `server/src/modules/intent/helpers.ts:69-75` |
| `IntentService.renderBlock(intent: PrIntent)` already exists as the prompt-block seam | `server/src/modules/intent/service.ts:69-71`, delegating to `helpers.ts:85-107` |
| `buildFileMap` has exactly one importer today | `rg 'hunk-map' server/src server/test` -> `intent/sources.ts:14` only |
| `MAX_FILE_MAP_FILES` / `MAX_HUNKS_PER_FILE` have exactly one consumer | `rg` over `server/src`, `server/test`, `client/src` -> `intent/hunk-map.ts` only |
| `resolveRepoFiles` and `resolveLinkedIssue` are module-private (not exported) | `server/src/modules/intent/sources.ts:77,157` - only `resolveSources` is exported at `:42` |
| `SPEC_FILE_CANDIDATES` and `LINKED_ISSUE_RE` are in `intent/constants.ts`, which IS exempt | `server/src/modules/intent/constants.ts:46-52,59` |
| `DATA_GUARD` + `wrapUntrusted` is the reference implementation, and this path does not inherit `INJECTION_GUARD` | `server/src/modules/blast/prompt.ts:19-31,102`; `server/AGENTS.md:58-60` |
| `wrapUntrusted` is re-exported from reviewer-core via `platform/prompt.ts` | `server/src/platform/prompt.ts:6-11` |
| The never-claim-a-defect rule the brief inherits | `server/src/modules/blast/prompt.ts:36` |
| Staleness derived from BOTH shas is the blast pattern, not the intent pattern | `server/src/modules/blast/service.ts:242-259` vs `intent/helpers.ts:47-62` |
| `risk_brief` is already a registered feature-model id and already resolved by `BlastService` | `server/src/vendor/shared/contracts/platform.ts:18,63`; `blast/service.ts:95-100`; `client/src/lib/feature-models.ts:28-34` |
| `pr_brief` is `pr_id` PK + `json` jsonb NOT NULL, with zero runtime consumers | `server/src/db/schema/reviews.ts:135-140`; `rg 'prBrief\|PrBrief'` finds only `db/schema.ts:33,70` and `client/src/lib/types.ts:35` |
| `pr_files` is owned by the reviews repository | `server/src/modules/reviews/repository/pull.repo.ts:28-33`, exposed at `repository.ts:51-53` |
| `pr_commits` is owned by `modules/pulls/repository.ts`, not on the Container | `server/src/modules/pulls/repository.ts:83` |
| `PrDetail.commits` is already on the PR page and passed to `FindingsTab` | `client/.../page.tsx:190` (`prCommits={pr.commits}`) |
| The one-envelope-from-the-POST pattern and its rationale | `server/src/modules/blast/routes.ts:22-24`; `client/src/lib/hooks/blast.ts:43-49` |
| Nullable read responses, and why they are not 404s | `server/src/modules/intent/routes.ts:11-17` |
| Per-route rate limit shape for a model-spending button | `server/src/modules/blast/routes.ts:41-43`; `intent/routes.ts:31-37` |
| The global rate limit is not registered under `NODE_ENV=test`, making per-route config inert there | `server/src/app.ts:103-107` |
| `PromptLogMeta.call` is a closed union | `server/src/platform/prompt-log.ts:89,111` |
| Schema repairs go through `StructuredRequest.maxRetries` | `server/src/vendor/shared/adapters.ts:55-70`; used at `onboarding/service.ts:316` |
| `withRetry`'s default is 3 retries and its `isRetryable` only fires on 429/5xx/network | `server/src/platform/resilience.ts:46-50,35-44` |
| The candidate-set-first pattern, and why post-hoc verification cannot satisfy membership/ordering ACs | `server/src/modules/onboarding/candidates.ts:9-19`; `verify.ts:22-29`; `server/INSIGHTS.md:337-344` |
| `loadDiff` lives in `_shared/` precisely so two modules can share it | `server/src/modules/_shared/diff-loader.ts:5-21` |
| A server integration test parses the response with the CLIENT's contract copy | `server/test/blast.it.test.ts:30-33`; root `INSIGHTS.md:66-73` |
| Migration numbering: 0018 is the highest | `ls server/src/db/migrations/*.sql` -> `0018_shallow_toro.sql` |
| The Overview grid, its `auto-fit minmax(380px, 1fr)`, and the two card render sites | `client/.../OverviewTab/OverviewTab.tsx:27-35`; `OverviewTab/styles.ts:10-15` |
| Intent risk chips and their single i18n key | `client/.../IntentCard/IntentCard.tsx:149-164`; `messages/en/brief.json:23` |
| `SummaryBlock` import, mutation call and render site; its two tests | `client/.../BlastRadiusCard/BlastRadiusCard.tsx:13,47,172-177`; `BlastRadiusCard.test.tsx:334-363` |
| `blast.json` `summary.*` keys exist and stay | `client/messages/en/blast.json:51-60` |
| No file-expand mechanism exists for AC-38; `defaultOpen` is heuristic-only | `client/.../DiffTab/DiffTab.tsx:14-25`; `diff-viewer/FileCard/FileCard.tsx:59-61`; `SmartDiffViewer.tsx:69-71`; `DiffViewer.tsx:14-32` |
| The shipped cross-tab jump precedent, and the Files tab's key is `"diff"` | `client/.../page.tsx:84,89,205,217-219` |
| next-intl namespaces are auto-discovered from `messages/<locale>/*.json`; only `en` exists | `client/src/i18n/request.ts:16-25` |
| `brief.json` already carries `block.risks`, `noRisks`, `noHistory`, `overlap` | `client/messages/en/brief.json:5,8,9,10` |
| The client test pattern is hoisted `vi.mock` of the hook module + real message fixtures | `client/.../BlastRadiusCard.test.tsx:16-28,79-91` |
| `IntentCard` has no colocated test today | researcher grep of `client/src` for `IntentCard` in `*.test.tsx` -> no hits |
| Empty-state, stale-badge and retry patterns to reuse | `IntentCard.tsx:50-58,66-73,127-131`; `SummaryBlock.tsx:36-40` |
| `MonoLink` without `href` and `Chip` render `<button>`; the regression assertion | `client/INSIGHTS.md:85-93` |
| jsdom implements neither `scrollIntoView` nor `navigator.clipboard` | `client/INSIGHTS.md:202-213` |
| Test commands and the unit/integration split | `TESTING.md:86-100`; `.claude/repo-facts.md:32-43` |

No researcher was asked an external question; the one subagent run was an internal
survey of `client/`, and every fact it returned that this plan uses is cited above
against a `path:line` the planner could name independently.

## Traceability

| Requirement | Step(s) | Acceptance criterion |
| --- | --- | --- |
| AC-1 | 7, 8 | `brief.it.test.ts` green (the schema-name assertion over a capturing logger) |
| AC-2 | 7 | Server unit + integration lanes green |
| AC-3 | 7, 8 | `brief.it.test.ts` green (runs count unchanged) |
| AC-4 | 7, 8 | `brief.it.test.ts` green (no second call on GET) |
| AC-5 | 7 | Server unit lane green |
| AC-6 | 3, 5 | Server unit lane green (`prompt.test.ts`) |
| AC-7 | 3, 5 | Server unit lane green (`prompt.test.ts` vs `buildFileMap`) |
| AC-8 | 5 | Server unit lane green |
| AC-9 | 5 | Server unit lane green |
| AC-10 | 5 | Server unit lane green (over-ceiling fixture) |
| AC-11 | 7 | Server unit lane green |
| AC-12 | 7 | Server unit lane green |
| AC-13 | 4 | Server unit lane green (`ground.test.ts`) |
| AC-14 | 4 | Server unit lane green |
| AC-15 | 4 | Server unit lane green |
| AC-16 | 4 | Server unit lane green + `BlastCaller.line` absent from `candidates.ts`/`ground.ts` signatures |
| AC-17 | 4, 8, 11 | Server unit + integration lanes green; client suite green |
| AC-18 | 4, 8 | `brief.it.test.ts` green (200 with empty lists) |
| AC-19 | 4, 11 | Server unit lane green; client suite green |
| AC-20 | 11, 13 | Client suite green; `./scripts/e2e.sh` |
| AC-21 | 4, 7 | Server unit lane green |
| AC-22 | 5 | `prompt.test.ts` green + the manual grading pass on PR #482 |
| AC-23 | 5 | Server unit lane green (partial-index fixture) |
| AC-24 | 7 | Server unit + integration lanes green |
| AC-25 | 11 | Client suite green |
| AC-26 | 7, 11 | Server unit lane green; client suite green |
| AC-27 | 13 | Client suite green (surviving `BlastRadiusCard.test.tsx` assertions) |
| AC-28 | 13 | Client suite green |
| AC-29 | 13 | Client suite green |
| AC-30 | 13 | Client suite green |
| AC-31 | 13 | Client suite green |
| AC-32 | 13 | Client suite green; `./scripts/e2e.sh` |
| AC-33 | 2, 13 | Only `0019_*.sql` generated, touching neither `pr_blast_summary` nor its rows |
| AC-34 | 11 | Client suite green |
| AC-35 | 11 | Client suite green |
| AC-36 | 11 | Client suite green |
| AC-37 | 11 | Client suite green (accessible-name assertion) |
| AC-38 | 11, 14 | Client suite green; `./scripts/e2e.sh` |
| AC-39 | 4, 11 | Server unit lane green (order preserved through grounding); client suite green |
| AC-40 | 11 | Client suite green (keyboard + focus-indicator assertions) |
| AC-41 | 11, 12 | Client suite green; `./scripts/e2e.sh` |
| AC-42 | 12 | Client suite green |
| AC-43 | 6, 7, 8 | `brief.it.test.ts` green |
| AC-44 | 6, 8 | `brief.it.test.ts` green (byte-identical earliest entry) |
| AC-45 | 6, 11 | Server integration lane green; client suite green |
| AC-46 | 11 | Client suite green |
| AC-47 | 11 | Client suite green |
| AC-48 | 7, 8 | `brief.it.test.ts` green |
| AC-49 | 7, 8 | `brief.it.test.ts` green (cross-workspace 404) |
| AC-50 | 7 | Route config inspection - not observable in any automated lane (`app.ts:103-107`) |
| AC-51 | 7, 8 | `brief.it.test.ts` green (total cost unchanged) |
| AC-52 | 1, 8 | `diff -q` on the two copies + `brief.it.test.ts` parsing with the client copy |
| AC-53 | 1 | `git diff --stat -- '*contracts/brief.ts'` empty |
| AC-54 | all | `cd server && pnpm arch:check` |
| Clarifying default: brief history ships inside the `GET /pulls/:id/brief` envelope | 1, 6, 7, 11 | AC-45, AC-47 |
| Clarifying default: AC-38's `focusFile` plumbing is in scope | 14 | AC-38 |

Every AC has a step. Every step serves at least one AC, except Step 9
(`repo-facts.md` + README), which serves the repo's own maintenance rule at
`AGENTS.md:68-71` rather than a spec criterion.

## Lessons from INSIGHTS.md

- **Build rows FROM the candidate set; post-hoc verification cannot satisfy a
  membership or ordering property** - `server/INSIGHTS.md:337-344`. This is why
  Step 4 splits `candidates.ts` from `ground.ts` and why `BlastCaller.line` is
  never a parameter of either. It converts AC-16 from a filter into a structural
  guarantee.
- **A service must build its own repository from `container.db`** - `server/INSIGHTS.md:405-410`.
  Step 7 says so explicitly, because tests construct `{ db } as unknown as Container`.
- **Never wrap a billable call in `withRetry`, and beware the queue re-creating it
  one layer up** - `server/INSIGHTS.md:325-335`. The brief runs inline rather than
  through `JobRunner`, so only the direct half applies, but it is the reason the
  plan forbids `withRetry` in writing rather than leaving it to taste.
- **A locally measured token count is not spend; the measured:billed ratio hit 5x on
  this codebase** - `server/INSIGHTS.md:188-201`. Step 7 reads `costUsd` from the
  provider result; the 20k ceiling is an assembly control only.
- **`drizzle-kit generate` turns interactive when one table both gains and drops
  columns, and hangs on piped stdin** - `server/INSIGHTS.md:469-475`, `92-99`. This
  is the single biggest reason Step 2 keeps `pr_brief.json` untouched.
- **An integration test omitting `secrets` or a provider from `overrides.llm` makes
  real billable calls** - `server/INSIGHTS.md:238-249`. Step 8 mandates both.
- **A green integration lane is not evidence a file ran** - `server/INSIGHTS.md:275-283`.
  The acceptance criterion says to read the per-file lines.
- **Do not use `vitest -t` to prove a new integration case fails without its trigger**
  - `server/INSIGHTS.md:285-294`.
- **To observe what a service logged, construct it with your own logger over
  `app.container`; routes hand it a noop under the test config** -
  `server/INSIGHTS.md:10-21`. This is the whole mechanism for AC-1.
- **`MockGitClient.readFile` resolves a missing path to `''`, so blank means absent**
  - `server/INSIGHTS.md:501-504`. Step 7's spec-candidate resolution must guard with
  `raw && raw.trim().length > 0`.
- **Do not trust "the DB schema already contains every table"; grep the nouns first**
  - `server/INSIGHTS.md:219-228`. Done: `pr_brief` exists, no history table does.
- **The barrel `export *`s every contract file, so a new file must re-export nothing
  it imports** - root `INSIGHTS.md:59-65`. Step 1's binding constraint.
- **A server integration test can parse the response with the client's contract copy,
  turning the two-copies rule into a failing test** - root `INSIGHTS.md:66-73`. Step 8.
- **`CLAUDE.md` is a symlink to `AGENTS.md`; that is one edit, not two** - root
  `INSIGHTS.md:79-87`. Step 9.
- **`MonoLink` without `href` and `Chip` render `<button>`; assert the card's only
  buttons do something** - `client/INSIGHTS.md:85-93`. Step 11, and it matters
  precisely because AC-37 and AC-40 are about activatable elements.
- **Give a shared `components/**` component a new capability with OPTIONAL props;
  never fork it** - `client/INSIGHTS.md:104-112`. Step 14's `focusFile` chain.
- **A sibling feature's `_components` cannot be imported; promote to the common
  ancestor** - `client/INSIGHTS.md:95-101`. Step 11's "does not".
- **jsdom implements neither `scrollIntoView` nor `navigator.clipboard`** -
  `client/INSIGHTS.md:202-213`. Step 11 and Step 14 both need the stub.
- **An `sr-only` absolutely-positioned live region needs a positioned parent, or it
  stretches the document and grows an outer scrollbar** - `client/INSIGHTS.md:259-275`.
  Relevant because Step 11 renders pending and stale announcements.
- **Grep the client too, not just the server, before building** - root
  `INSIGHTS.md:20-29`. It is what turned up `messages/en/brief.json`'s pre-staged
  `noRisks` / `noHistory` / `overlap` keys, which Step 10 reuses instead of adding
  near-duplicates.

## Skills applied while planning

| Skill | How it was loaded | What it constrained in this plan |
| --- | --- | --- |
| `onion-architecture` | preloaded | Ruled out three of the four seams the spec's participant table names. `no-cross-module-imports` exempts only `service.ts` / `types.ts` / `constants.ts`, which forced the `_shared/hunk-map.ts` move (Step 3), the `IntentService.renderBlock` substitution for `toBriefIntent` (Step 7), and re-resolving spec files inside `brief` from `intent/constants.ts` rather than importing `sources.ts`. It also placed the prior-PR overlap query in the `reviews` repository (Step 6) under "a table has exactly one owning repository", and kept the degraded gate and the single-flight guard in the service rather than the route (Step 7). |
| `postgresql-table-design` | preloaded | Shaped Step 2: `pr_brief_history` as append-only event data with an explicit index on `(pr_id, generated_at)` because Postgres does not auto-index FK columns; `TIMESTAMPTZ` for `generated_at`; `TEXT` throughout; `NOT NULL` with a non-volatile default so the `ALTER` does not rewrite. Its `BIGINT GENERATED ALWAYS AS IDENTITY` preference was deliberately overridden - every id in `server/src/db/schema/**` is `uuid ... defaultRandom()`, and one odd table out is a worse cost than the ideal key type. |
| `frontend-ui-architecture` | preloaded | Put the card in a colocated `_components/PrBriefCard/` folder with its own test rather than in `src/components/`; kept the query key in the hook file (Step 10) rather than in the component; forced the "one feature must not import a sibling's `_components`" line in Step 11; and drove Step 11's split-by-state (early return per UI state) instead of stacked ternaries. |
| `next-best-practices` | preloaded | Kept the new card inside the existing whole-page `"use client"` tree, so no new Suspense boundary is needed - the app already satisfies Next 15's `useSearchParams` requirement with ONE root boundary (`client/INSIGHTS.md:171-180`). Shaped Step 14 as a URL search param mirroring the shipped `finding` param, including `scroll: false`, rather than component state that would drop on tab unmount. |
| `zod` | frontmatter only (routing) | Step 1 and Step 4: `.extend()` over imported schemas, flat `z.object` for the structured-output schema, and the no-re-export rule. The frontmatter was sufficient to route both steps; the binding constraints came from `contracts/blast.ts:18-21` and `blast/schemas.ts:4-17`, which are this repo's own precedent. |
| `drizzle-orm-patterns`, `fastify-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert` | frontmatter only (routing) | Routed to steps; no step's shape depended on a rule invisible from the frontmatter, so none was invoked. |

## Recommendations

- **Name the two histories differently in code from the first line.** The envelope
  carries `history` (prior overlapping PRs, <= 5, deterministic - `PrHistoryItem`) and
  `brief_history` (the per-generation timeline, <= 20 - `BriefHistoryEntry`). The spec
  calls both "history" in different sections. A single `history` field or a
  `BriefHistory` type serving both would be the defect that ships. The plan already
  mandates this; it is worth stating as a deliberate choice rather than an accident.
- **Consider `POST /pulls/:id/brief` for generate rather than a `/generate` suffix.**
  It matches `POST /pulls/:id/intent` exactly (classify/re-classify on the noun), and
  keeps the four model-calling buttons on the PR page shaped identically. The plan
  assumes this.
- **AC-1's stated observation point does not exist for this feature.** It says "in
  the run's Live Log", but AC-3 forbids an `agent_runs` row, and the Live Log is the
  review run's SSE stream. The plan substitutes the `prompt.assembled` record with
  `call: 'brief'` plus one `'brief: generated'` line, which is the same observation
  `IntentService` gives for a standalone classify. If you want AC-1 observable
  exactly as written, the spec needs a different observation clause - that is a
  `specreator` edit, not a planning decision.
- **AC-22 is graded, not tested.** Nothing in this repository can decide whether a
  paragraph asserts a defect. The plan proves the constraint at the prompt and
  schedules a manual grading pass. If AC-22 is meant to be a shipping gate rather
  than a review note, it needs an eval fixture set, which this repo has no harness
  for. Worth deciding before implementation, not after.
- **Two of the design review's `open` items are cheap enough to close in Step 11.**
  Pairing severity with an icon or label (the NFR already requires colour
  independence) and showing a `provider - model` line (`SummaryBlock.tsx:56` already
  does it) both cost a few lines. The plan includes both; if you would rather ship
  the mockup literally, say so and they come out.
- **`IntentCard` has no test today**, so Step 12's removal is unverified except by
  `./scripts/e2e.sh`. A three-assertion `IntentCard.test.tsx` (scope columns render,
  no risk chips render, confidence badge survives) would make AC-41/AC-42 a failing
  test rather than a visual check. Not planned, because adding a test to a shipped
  untested component is scope the spec did not ask for.

## Risks and forks

- **Fork: brief history in the envelope, or its own route.** Options: (a) inside
  `GET /pulls/:id/brief` - one fetch, one cache entry, matches the whole-envelope
  precedent at `blast/routes.ts:22-24`; (b) `GET /pulls/:id/brief/history` - a
  second route, hook, contract type and cache key, but the timeline can grow past
  20 without inflating every brief read. Recommended: (a). A long-lived PR with 20
  capped entries adds a few hundred bytes; the second route is a follow-up if the
  cap ever moves. This is Clarifying question 1.
- **Fork: is AC-38's diff-viewer plumbing in scope now?** It is the only part of
  this feature that touches `client/src/components/diff-viewer/**`, a shared
  component L04 and L05 both left alone, and it is four files. Recommended: yes,
  in scope, as optional props with the old defaults preserved - a review-focus list
  whose entries do not open anything is the feature's whole point missing. This is
  Clarifying question 2.
- **Risk: the `_shared/hunk-map.ts` move touches shipped L03.** It is a pure move
  plus one import line plus two constants with a single consumer, and no test file
  imports it, so the blast radius is verifiably small. But it does mean L03's
  `sources.ts` is in this diff, which a reviewer will ask about. The alternative -
  duplicating `buildFileMap` inside `brief` - would let the two copies drift
  silently, exactly the failure `diff-loader.ts:9-14` was written to prevent.
- **Risk: `IntentService.renderBlock` may carry more than the brief wants.** Its
  output includes the confidence level, the risk areas and the missing-context list
  (`helpers.ts:85-107`). All three are legitimate input facts, and none is a diff
  body, so this is probably fine - but if the prompt reads badly, the fallback is a
  brief-local renderer over `PrIntent`, NOT an import of `toBriefIntent`. Named as
  a stop condition.
- **Risk: `BlastService.get()` on the generation path re-derives the whole blast.**
  It is a pure indexed read by design (`blast/service.ts:32-38`), so it is cheap,
  but it is one more DB round-trip on a request that also runs `loadDiff`'s real
  `git diff`. Acceptable behind an explicit button; worth measuring if generation
  ever moves onto an automatic path.
- **Open: AC-50 is unverifiable in CI.** `app.ts:105` skips the rate-limit plugin
  under `NODE_ENV=test`, so the per-route config never fires. Only inspection
  against `blast/routes.ts:43` proves it. No command covers this step.
- **Open: is `risk_brief` the right feature-model id for two features?** Both the
  deprecated blast summary and the brief resolve it. AC-2 mandates it for the brief,
  and the blast route is deprecated, so this converges naturally. Flagging it only
  so it is not read as an oversight.

## Alternatives rejected

- **Leave `pr_brief` untouched and create two brand-new tables.** Rejected: the
  server's own rule is that unused lesson tables sit empty by design and are not
  cleaned up (`server/AGENTS.md:50`), so `pr_brief` is the table this lesson was
  pre-shipped with. Creating `pr_brief_v2` beside it would leave a permanently
  confusing pair. Its `pr_id` PK is also exactly the right key for the current
  brief - the cache is one-per-PR and staleness is derived on read, not part of the
  identity. Only the append-only timeline does not fit, and that is what the second
  table is for.
- **Store the brief history as a jsonb array on `pr_brief`.** Rejected on two
  counts: AC-44 requires an entry to be byte-identical after a later regeneration,
  and rewriting a jsonb array on every generation is precisely modifying it; and
  Open question 7 already names the unbounded row growth on a long-lived PR.
- **Store the brief in typed columns instead of `pr_brief.json`.** Rejected: the
  payload is nested (risks with file-ref arrays, focus entries, dropped counts) and
  every field is served together and never queried individually, which is what
  `postgresql-table-design` means by "optional/semi-structured attrs". Typed columns
  would also mean dropping `json`, which is the one thing that turns `db:generate`
  interactive.
- **Put `buildHunkRanges` in `brief/` and leave `hunk-map.ts` where it is.**
  Rejected: `brief` would still need `buildFileMap`'s exact output for AC-7, and it
  cannot import it. Reimplementing the renderer to match byte-for-byte is the drift
  failure in a more expensive costume.
- **Give `brief` a `pr_files` query of its own.** Rejected under "a table has
  exactly one owning repository" - `pull.repo.ts:28` already owns it, and
  `modules/smart-diff` is the precedent for a composing module reading everything
  through `container.reviewRepo` (`server/INSIGHTS.md:356-365`). Unlike smart-diff,
  `brief` does own two tables, so it keeps a repository - but only for those two.
- **Run the generation through `JobRunner` like onboarding does.** Rejected: one
  structured call at a 30s ceiling has no 450s worst case, so it needs neither a
  per-kind budget nor a boot reaper - the same reasoning `IntentService` states at
  `intent/service.ts:44-47`. It also avoids `JobRunner.enqueue`'s
  `withRetry(retries: 2)` wrapper, which would re-issue a paid call up to three
  times per click (`server/INSIGHTS.md:325-335`).
- **Delete `SummaryBlock.tsx` and the summary route in this change.** Rejected by
  the spec's disposition table, and the reasoning is sound: removing a working route
  in the same change that redirects its only caller makes two failures
  indistinguishable.
- **A new `messages/en/pr-brief.json` namespace.** Rejected: the `brief` namespace
  already serves this exact tab (`OverviewTab.tsx:20`, `IntentCard.tsx`) and already
  carries pre-staged `noRisks` / `noHistory` / `overlap` keys. A second namespace for
  the same surface is a lookup people get wrong.
