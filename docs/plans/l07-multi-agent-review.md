## Plan: L07 - multi-agent review (fan one PR out to N agents and compare them) plus its companion agent-run-log

### Understanding
Build both L07 specs as one body of work: the companion (`docs/specs/L07-agent-run-log.md`, AC-1..AC-18) first, because it produces the shared trace drawer the main feature's "View trace" mounts, then the main feature (`docs/specs/L07-multi-agent-review.md`, AC-1..AC-55).
The backend change is real but narrow: `executeRuns` becomes parallel at concurrency 3, `multi_agent_runs` gains a link from `agent_runs`, and one deterministic clustering pass groups findings that already exist.
Out of scope: worktrees, per-agent checkouts, any second model call, agent-to-agent communication, a combined score, `Learn`, `Reply to author`, and the `Memory` / `Agent Performance` / `CI Runs` nav entries.
The four design mockups are NOT the source of truth: each spec's Design review section overrides them, and every rejected line is named per step below.
Nothing in this plan writes a spec or changes product behaviour the specs did not decide.

### Architectural constraints
- Routes are transport only: zod `params`/`body`/`querystring`, one service call, no drizzle, no `Schema.parse(req.body)` - source: `server/AGENTS.md`, rule `routes-are-transport-only` | skill `onion-architecture`.
- Only a `repository.ts` or `repository/*.ts` imports the drizzle query builder - source: `server/AGENTS.md`, rule `queries-live-in-repositories`.
- One module must not reach into another module's folder; only `service.ts`, `types.ts`, `constants.ts` and `modules/_shared/` are exempt - source: `.claude/repo-facts.md`, rule `no-cross-module-imports`.
- The service owns the transaction boundary; repository methods take an optional `DbOrTx` - source: `server/AGENTS.md` | skill `onion-architecture` rule 6.
- Migrations are generated, never hand-written: edit `src/db/schema/*.ts` then `pnpm db:generate` - source: root `AGENTS.md` "Do not touch".
- `pnpm db:generate` turns interactive and hangs on piped stdin when one table both gains and drops columns; keep the edit additive and never pipe stdin - source: `.claude/repo-facts.md` "Environment traps".
- A contract change lands in `server/src/vendor/shared/**` AND `client/src/vendor/shared/**` in the SAME step, verified with `diff -q` on the touched files only - source: root `AGENTS.md`, `.claude/repo-facts.md`.
- `client/src/vendor/shared` is a TYPES-ONLY copy in practice: import from it with `import type` only. The first runtime value import breaks `pnpm build` while typecheck, lint and test stay green - source: `client/INSIGHTS.md:307`.
- A server test importing `test/helpers/pg.ts` MUST be named `*.it.test.ts` - source: `server/AGENTS.md`.
- An integration test that omits a provider from `overrides.llm` is NOT hermetic; pass `secrets: new MockSecretsProvider({})` too - source: `server/INSIGHTS.md:248`, `.claude/repo-facts.md`.
- Client data access only through `src/lib/hooks/*` -> `src/lib/api.ts`; query keys live in the hook file - source: `client/AGENTS.md`.
- One feature must not import a sibling feature's `_components`; promote to `src/components/`. Enforced by `pnpm lint` (`client/eslint.config.mjs:86-110`) - source: `client/AGENTS.md`.
- User-facing strings go through next-intl; a new namespace file is auto-discovered, no registration step (`client/src/i18n/request.ts:16-25`) - source: `client/AGENTS.md`.
- Do-not-touch paths bordering this work: `server/src/db/migrations/**`, `client/src/vendor/ui/**`, `server/clones/**`, `.env`.
  `client/src/vendor/ui/nav.ts` is the ONE knowing exception, taken in Step D2 - see that step.
- Style: plain hyphen only, never the em dash character, in code comments, i18n strings, commit messages and any Markdown this work adds.

### Skills for the implementer
| Step | Skill | Why |
| --- | --- | --- |
| A1, C3, C4 | `onion-architecture` | New repository file, service methods and the route/service split in `modules/reviews`. |
| A1, C4 | `fastify-best-practices` | New routes, zod querystring schema, per-route rate-limit config. |
| A1, B3, C3 | `drizzle-orm-patterns` | New queries, the window function for last-10-per-agent, the schema edit. |
| B3 | `postgresql-table-design` | FK column, its manual index, and the `ON DELETE` action. |
| B2 | `zod` | The contract edits in both vendor copies. |
| A2, A3, D1, D3, D4, D5 | `frontend-ui-architecture` | Where the promoted components live, and the feature/`src/components` boundary. |
| A3, D3, D4 | `next-best-practices` | New App Router segments, `layout.tsx`, thin `page.tsx`, `useSearchParams`. |
| A3, D3, D4, D5 | `react-best-practices` | Tab state, polling, localStorage preference, list rendering. |
| A3, D3, D4, D5 | `react-testing-library` | The client tests each of those steps adds. |
| B2 | `typescript-expert` | `AgentColumn.findings` moving to `FindingRecord` and the `ConflictTake` union narrowing. |
| final | `engineering-insights` | Task wrap-up into the touched modules' `INSIGHTS.md`. |

---

## PHASE A - the companion spec (`docs/specs/L07-agent-run-log.md`)

**Step A1 - server: list one agent's runs**
- Files: `server/src/vendor/shared/contracts/observability.ts:1` , `client/src/vendor/shared/contracts/observability.ts:1` , `server/src/modules/reviews/repository/run.repo.ts:103` , `server/src/modules/reviews/repository.ts:25` , `server/src/modules/reviews/service.ts:70` , `server/src/modules/reviews/routes.ts:147`
- Does:
  - Adds `AgentRunSummary` and `AgentRunsPage` to BOTH `observability.ts` copies in this one step.
    `AgentRunSummary` carries exactly the fields the companion's row table names: `run_id`, `ran_at`, `pr_id` (nullable), `pr_number` (nullable), `pr_title` (nullable), `status`, `error`, `findings_count`, `blockers`, `score`, `duration_ms`, `cost_usd`, `source`.
    `AgentRunsPage` = `{ runs: AgentRunSummary[], has_more: boolean }`.
  - Adds `listRunsForAgent(db, workspaceId, agentId, { limit, before })` to `run.repo.ts`, left-joining `pull_requests` for number and title, workspace-scoped on `agent_runs.workspace_id`, ordered `ran_at DESC, id DESC`, selecting `limit + 1` rows to derive `has_more`.
    The `id` tiebreak is required, not decoration: two runs of the same agent share a timestamp after every multi-agent run, and the companion's Edge cases demand a stable order across reloads.
  - Composes it on `ReviewRepository`, adds `ReviewService.listRunsForAgent` which 404s through `container.agentsRepo.getById(workspaceId, agentId)` before touching the table, and registers `GET /agents/:id/runs` with `params: IdParams` and a zod querystring `{ limit: coerce int 1..50 default 50, before: iso datetime optional }`.
- Does not: add any column to `agent_runs`; write `source: 'ci'` anywhere; filter by source; touch `listRunsForPull`.
- Skills: `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm arch:check` , `cd server && pnpm typecheck` , `diff -q server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts`

**Step A2 - client: promote RunTraceDrawer out of the pulls route**
- Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**` (moved) , `client/src/components/run-trace-drawer/**` (new location) , `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:19` , `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:249`
- Does:
  - Moves the whole folder to `client/src/components/run-trace-drawer/`, keeping `RunTraceDrawer.tsx`, `RunTraceDrawer.test.tsx`, `constants.ts`, `helpers.ts`, `index.ts`, `styles.ts` and the entire `_components/` subtree (`atoms.tsx`, `FindingsSection`, `PromptBlock`, `PromptModalBody`, `ToolCallRow`, `TraceBody`, `TraceSection`) together.
  - Rewrites its deep relative imports (`../../../../../../../lib/hooks/trace`) to the `@/` alias, since the folder now sits outside `src/app`, and fixes the test's `vi.mock` paths and its `messages/en/*.json` import path to match.
  - Updates the single production call site to `import RunTraceDrawer from "@/components/run-trace-drawer";` and passes `running` from the page, derived from the run's status, so an in-flight run opens on the Live log tab. It is not passed today (`page.tsx:249-257`), which is why a running run opened from the Timeline shows the trace tab and subscribes to no events.
  - Adds focus return on close inside the promoted component: capture `document.activeElement` on mount, restore it on unmount.
    `client/src/vendor/ui/kit/Drawer.tsx` sets `role="dialog" aria-modal="true"` and implements no focus management at all, and it is frozen, so the behaviour belongs in the feature.
- Does not: change the drawer's tabs, sections or trace content; edit `client/src/vendor/ui/kit/Drawer.tsx`; change any existing ASSERTION in `RunTraceDrawer.test.tsx` (only its mock and message import paths move); change the URL-driven `?trace=` open/close mechanism on the PR page.
- Skills: `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test` , `cd client && pnpm lint` , `cd client && pnpm typecheck` , `cd client && pnpm build`

**Step A3 - client: the Runs tab in the agent editor**
- Files: `client/src/lib/hooks/runs.ts` (new) , `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11` , `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx:28` , `client/src/app/agents/[id]/page.tsx:16` , `client/src/app/agents/[id]/_components/AgentEditor/_components/RunsTab/**` (new) , `client/messages/en/runs.json` , `client/messages/en/agents.json`
- Does:
  - Adds `client/src/lib/hooks/runs.ts` with an exported `agentRunsKeys` factory and `useAgentRuns(agentId)` calling `api.get<AgentRunsPage>` against `/agents/${agentId}/runs`. Types come in with `import type` only.
  - Adds `{ key: "runs", labelKey: "editor.tabs.runs", icon: "History" }` to `TABS` AFTER the `evals` entry, adds the mount branch in `AgentEditor.tsx`, and adds `"runs"` to `VALID_TABS` in `client/src/app/agents/[id]/page.tsx:16`.
    All THREE edits are required: a key missing from `VALID_TABS` renders the tab, sets `?tab=runs`, and then silently shows Config, and typecheck, lint and the component test all pass because the component test passes `tab` as a prop and never goes through the page.
  - Adds `_components/RunsTab/` with `RunsTab.tsx`, `RunsTab.test.tsx`, `styles.ts`, `index.ts`, following `EvalsTab.tsx` as the structural template (one hook, explicit early-return loading / error / empty states, `useTranslations`).
    A row shows when the run started, its pull request, status, findings count, score, duration, cost and source; a failed run shows its recorded error on the row; a run with no pull request still renders. Rows are keyboard-activatable and open `@/components/run-trace-drawer` for that run, passing `running` for an in-flight run.
    The 50-row cap gets a load-more control driven by the `before` cursor.
  - Adds a `runsTab.*` block to `client/messages/en/runs.json` and `editor.tabs.runs` to `client/messages/en/agents.json`.
- Does not: add aggregates, charts or an accept-rate; add any run control (start, cancel, re-run, delete); filter by source; show the run's model or provider or grounding summary (all three are `open` in the companion's Design review, not decided).
- Skills: `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test` , `cd client && pnpm lint` , `cd client && pnpm typecheck`

---

## PHASE B - foundations for the main feature

**Step B1 - one implementation of range overlap, shared**
- Files: `server/src/modules/_shared/overlap.ts` (new) , `server/src/modules/eval/scoring.ts:19-24` , `server/src/modules/eval/scoring.ts:54-71`
- Does: moves `Located` and `overlaps` verbatim, doc comment included, into `server/src/modules/_shared/overlap.ts`, and has `scoring.ts` import and re-export them (`export { overlaps }; export type { Located };`) so `test/eval-scoring.test.ts` and every existing call site keep compiling unchanged.
  `modules/_shared/` is the only home that lets both `eval` and `reviews` use one implementation: `no-cross-module-imports` exempts `^src/modules/_shared/`, and `eval-scoring-is-pure` forbids only `src/{platform,adapters,db}/`, reviewer-core and drizzle.
  This is the same move `rollupSeverities` made from `pulls/status.ts` to `modules/_shared/severity.ts` for the same reason.
- Does not: change the matching semantics or the range normalisation; move `evalF1` / `evalWilson`; put `overlaps` in `vendor/shared` (no client consumer exists, and a runtime value there breaks `pnpm build`).
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm arch:check`

**Step B2 - the contract changes, both vendor copies, one step**
- Files: `server/src/vendor/shared/contracts/observability.ts:22-86` , `client/src/vendor/shared/contracts/observability.ts:22-86` , `server/src/vendor/shared/contracts/trace.ts:148-173` , `client/src/vendor/shared/contracts/trace.ts:148-173`
- Does, identically in both copies:
  - **Deletes `AgentColumnFinding`** and sets `AgentColumn.findings: z.array(FindingRecord)`, importing `FindingRecord` from `./review-api.js`.
    One shape, not two: `FindingRecord` is exactly what the existing `FindingCard` renders, so the tabs view mounts it unchanged, and it carries the `rationale` a cluster cell needs and the `confidence` the cluster title tie-break needs. No cycle: `review-api.ts` does not import `observability.ts`.
  - **Adds `'cancelled'` to `AgentColumn.status`.** `agent_runs.status` has four values and a user can cancel one agent mid-run; the current three-value enum would fail validation on that row.
  - **Narrows `ConflictTake`**: `verdict: z.union([Severity, z.literal('did_not_flag'), z.literal('no_opinion')])` and `note: z.string().nullable()`.
    `note` carries the flagging finding's own rationale truncated to one line, and is `null` for both non-flagging stances. The required `note` alongside `'ignored'` was exactly the invented explanatory sentence the spec rejects, and `'ignored'` also could not tell a silent agent apart from an agent whose run failed. Nothing in the codebase reads these contracts today, so no consumer breaks.
  - **Leaves `Conflict.line` unchanged**, and documents it in the field's comment as "the start line of the finding that supplied this cluster's title".
    This is the deliberate decision on the range question: clustering matches on ranges, the wire carries only the label, and no range ever crosses the boundary - so no shape change is warranted.
  - **Extends `MultiAgentRun`** with `pr_title: z.string().nullish()`, `status: z.enum(['running','done','failed'])` and `total_cost_partial: z.boolean()`.
    `total_cost_partial` is what makes a run with an unknown-cost agent honest rather than silently low.
  - **Adds `MultiAgentRunRequest`** = `z.object({ agent_ids: z.array(z.string().uuid()).min(2) })`, so "fewer than two agents" is refused at the boundary with a 422 rather than in a handler.
  - **Adds `AgentRunEstimate`** = `{ agent_id, median_duration_ms: number|null, median_cost_usd: number|null, samples: number }`.
  - **Adds `multi_agent_run_id: z.string().nullable()` to `RunSummary`** in `contracts/trace.ts` (both copies), which is what lets the PR page group a multi-agent run's rows without a second request.
  - Rewrites the `observability.ts` header comment's route list to the routes Step C4 actually adds.
- Does not: touch `contracts/eval-ci.ts`, `contracts/productionize.ts` or `adapters.ts`, whose two copies have already drifted; add a `finding_id` to `ConflictTake` (the linking cell is `open` in the Design review, not decided); change `AgentStats`, `CuratorMerge` or `CuratorResult`.
- Skills: `zod`, `typescript-expert`
- Verify: `diff -q server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` , `diff -q server/src/vendor/shared/contracts/trace.ts client/src/vendor/shared/contracts/trace.ts` , `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm typecheck` , `cd client && pnpm typecheck`

**Step B3 - schema: tie an agent run to its multi-agent run**
- Files: `server/src/db/schema/runs.ts:8-42` , `server/src/db/schema/runs.ts:52-61` , `server/src/db/migrations/**` (generated, never hand-edited)
- Does:
  - Moves the existing `multiAgentRuns` declaration above `agentRuns` in the file, then adds to `agentRuns`: `multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })`, plus `multiIdx: index('agent_runs_multi_idx').on(t.multiAgentRunId)`.
    Single-valued in one direction, which is what the spec's criteria need; a join table would be wider than the requirement.
    `set null`, not `cascade`: `agent_runs.pr_id` is already `set null` so a run survives its pull request, and a cascade here would contradict that by destroying runs when their grouping row goes.
    The index is manual because Postgres does not auto-index a FK column, and this column is the read path for "the agent runs of this multi-agent run".
  - Runs `cd server && pnpm db:generate` then `cd server && pnpm db:migrate`.
    The edit is purely additive - one column and one index, nothing dropped - so `db:generate` stays non-interactive.
- Does not: hand-write or hand-edit the migration; add a `started_at` column; add an ordinal column; pipe anything into `pnpm db:generate`; delete any unused table.
- Skills: `drizzle-orm-patterns`, `postgresql-table-design`
- Verify: `cd server && pnpm db:generate` prints a new migration and exits without prompting; `cd server && pnpm exec vitest run test/reviews.it.test.ts --no-file-parallelism`

---

## PHASE C - backend behaviour

**Step C1 - the fan-out becomes parallel**
- Files: `server/src/modules/reviews/constants.ts` , `server/src/modules/reviews/run-executor.ts:145-183`
- Does:
  - Adds `REVIEW_FANOUT_CONCURRENCY = 3` to `reviews/constants.ts` with a comment citing `server/src/platform/jobs.ts:42` as the repository's existing default.
  - Replaces the sequential `for (const { agent, runId } of jobs)` loop with a `PQueue({ concurrency: REVIEW_FANOUT_CONCURRENCY })`, scheduling one task per job and awaiting the queue.
    The existing per-agent `try/catch` moves inside the task unchanged, so per-agent failure isolation is preserved by construction. `p-queue` is already a dependency and is already imported from inside a module (`modules/repo-intel/pipeline/full.ts:25`).
- Does not: route any of this through `container.jobs` / `JobRunner`.
  `JobRunner.enqueue` wraps every handler in `withRetry` at a default of 2, so one throw after a successful model call re-issues and re-bills every call the first attempt made - the same reason `modules/eval/routes.ts:88-91` keeps eval runs off it.
- Does not: change `runOneAgent`, `failAll`, the `RunLogger` fan-out, or `markReviewed`'s position inside the per-agent transaction.
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , then `cd server && pnpm exec vitest run test/reviews.it.test.ts test/skills.it.test.ts --no-file-parallelism`

**Step C2 - the pure multi-agent logic**
- Files: `server/src/modules/reviews/multi-agent.ts` (new) , `server/src/modules/reviews/multi-agent.test.ts` (new) , `server/.dependency-cruiser.cjs:32` , `.claude/repo-facts.md` (regenerated)
- Does:
  - Adds `multi-agent.ts` holding every pure function this feature needs, with no `Container`, no drizzle, no adapter and no `db` import:
    - `clusterFindings(byAgent)` - two findings share a cluster when their `file` strings are equal and their line ranges share at least one line, using `overlaps` from `../_shared/overlap.js`.
    - `clusterTitle(cluster)` - the highest-severity finding's title, tie-broken by highest `confidence`, then by agent order.
    - `stanceFor(agent, cluster)` - a `Severity` plus that finding's one-line rationale when the agent flagged it, `did_not_flag` when its run succeeded and it did not, `no_opinion` when its run failed or was cancelled. When one agent has several findings in a cluster, its highest-severity one wins the cell.
    - `isDivergent(cluster)` - true unless every agent whose run succeeded reports the same stance.
    - `isConflict(cluster)` - true only when two or more agents reported findings of DIFFERENT severities.
    - `medianOf(values)` and `estimateFor(runs)` for the pre-run estimate.
  - **Agent order is defined here and used everywhere**: agent name ascending, then `agent_run.id` ascending as the tiebreak for a run whose agent was deleted.
    This is a plan decision the spec left implicit. `AgentsRepository.listEnabled` has no `orderBy` at all, so Postgres returns enabled agents in arbitrary order, and "the order of the agents in the run" would otherwise not be reproducible across two reads of the same run.
  - Adds `multi-agent.test.ts` as a hermetic table test over clustering, titling, stances, divergence and conflicts, including the reversed-range case, the same-line-different-file case, and the multiple-findings-per-agent case.
  - Adds a `multi-agent-clustering-is-pure` rule to `server/.dependency-cruiser.cjs`, mirroring `eval-scoring-is-pure` at line 32: `from: '^src/modules/reviews/multi-agent\.ts$'`, `to: '^src/(platform|adapters|db)/|^\.\./reviewer-core|^(node_modules/)?drizzle-orm'`.
    "The clustering makes no model call" is the central claim of the disagreement section, exactly as "scoring makes no model call" was L06's, so it is enforced mechanically rather than asserted.
  - Regenerates `.claude/repo-facts.md` with `./scripts/repo-facts.sh`, because a depcruise rule changed.
- Does not: import `Container`, the container, an adapter, `db/`, or the review engine into `multi-agent.ts`; widen or allowlist any existing rule.
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm arch:check`.
  Watch the new rule go RED once by temporarily adding `import type { Container } from '../../platform/container.js'` to `multi-agent.ts`, then revert - an unwatched rule is an untested rule.

**Step C3 - repository and service**
- Files: `server/src/modules/reviews/repository/multi-agent.repo.ts` (new) , `server/src/modules/reviews/repository/run.repo.ts:224-247` , `server/src/modules/reviews/repository.ts:25-27` , `server/src/modules/reviews/service.ts:103-138`
- Does:
  - Adds `repository/multi-agent.repo.ts` (matching the existing split-by-aggregate convention alongside `review.repo.ts`, `run.repo.ts`, `pull.repo.ts`) with:
    `createMultiAgentRun(tx, { workspaceId, prId })`, `getMultiAgentRun(db, workspaceId, id)` joined to the pull request for number and title, `runsForMultiAgentRun(db, multiAgentRunId)` joined to `agents` for the name and to `reviews`/`findings` for the summary, verdict and findings, `activeMultiAgentRunForPull(db, workspaceId, prId)`, and `recentSuccessfulRunsByAgent(db, workspaceId)`.
    `recentSuccessfulRunsByAgent` uses `row_number() OVER (PARTITION BY agent_id ORDER BY ran_at DESC)` filtered to `<= 10` over `status = 'done'` rows, built with the drizzle query builder and `.as('ranked')` rather than a raw `sql` template - the shape `getResolvedCallersTopN` already uses in this repo.
    Every query is workspace-scoped.
  - Gives `run.repo.ts#createAgentRun` an optional `multiAgentRunId` and an optional `DbOrTx`, defaulting to today's behaviour.
  - Adds to `ReviewService`:
    `startMultiAgentRun(workspaceId, prId, agentIds, logger?)` - resolves and validates the agents, refuses with a 409 `AppError` naming the in-flight run when a multi-agent run of this pull request still has a `running` agent run, then opens ONE transaction that inserts the `multi_agent_runs` row and the N `agent_runs` rows, and only after it commits fires the existing `void this.executor.executeRuns(...)`.
    The transaction boundary is the service's because there is a business decision between the writes.
    `getMultiAgentRun(workspaceId, id)` - assembles columns and clusters through the pure functions of Step C2, derives `status` (`running` if any agent run is running; `failed` if every terminal run failed; else `done`), `total_duration_ms` as the LARGEST of the agent runs' durations, `total_cost_usd` as the SUM of the known costs with `total_cost_partial` true when any is null.
    `agentRunEstimates(workspaceId)` - the median duration and median cost per agent over that agent's last ten successful runs, `null` with `samples: 0` for an agent that has never succeeded.
- Does not: use `container.jobs`; write `source: 'ci'`; store any cluster, any conflict or any aggregate (all are computed on read); add a status column to `multi_agent_runs`; re-run an individual agent inside a recorded run.
- Skills: `onion-architecture`, `drizzle-orm-patterns`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm arch:check` , `cd server && pnpm typecheck`

**Step C4 - routes**
- Files: `server/src/modules/reviews/routes.ts:13-21` , `server/src/modules/reviews/routes.ts:147`
- Does, all with schema-first zod:
  - `POST /pulls/:id/multi-agent-run` - `params: IdParams`, `body: MultiAgentRunRequest`, `config: { rateLimit: { max: 4, timeWindow: '1 minute' } }`, returning the created `MultiAgentRun` with every column `running`.
    4 per minute is the tightest limit on this API, shared with `POST /reviews/diff` (`routes.ts:75`) and `POST /agents/:id/eval-runs` (`eval/routes.ts:110`), chosen there for the same reason: one request fanning out into billable calls. Carry that reason in a comment above the route, and the "not behind the job runner, on purpose" note with it.
  - `GET /multi-agent-runs/:id` - the whole results screen in one request: header, columns and clusters.
  - `GET /agents/run-estimates` - every enabled agent's estimate, so the configure screen issues no request when a checkbox is toggled.
  - Updates the module's route-list doc comment at `routes.ts:13-21`.
- Does not: hand-parse `req.body`; import drizzle or `src/db`; add a `GET /pulls/:id/multi-agent-runs` list route (the PR page reads the grouping off `RunSummary.multi_agent_run_id`, which it already fetches).
- Skills: `fastify-best-practices`, `onion-architecture`, `zod`
- Verify: `cd server && pnpm exec vitest run test/routes-smoke.test.ts` , `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm arch:check`

**Step C5 - the integration test**
- Files: `server/src/modules/reviews/multi-agent.it.test.ts` (new)
- Does: drives the whole path through `buildApp` + `app.inject` against a real Postgres, with `overrides.llm` covering EVERY provider the seeded agents use AND `secrets: new MockSecretsProvider({})`, so nothing can fall back to `~/.devdigest/secrets.json` and spend money.
  Covers: one agent run per selected agent; peak concurrent `completeStructured` calls never exceeds 3 with five agents; one diff load and one intent classification per multi-agent run; no other agent's name appears in any run's persisted `prompt_assembly`; the run rows carry the same fields a single-agent run records; one failing agent leaves the rest intact; every agent failing marks the run failed; duration is the max and cost the sum with the partial flag; the read issues zero provider calls; the cluster set for two findings at 28-30 and 29-31 on one file; a cluster every successful agent flagged identically is absent; the second start on the same pull request is refused with the in-flight run named; a finding off the diff never reaches a column or a cluster.
  Polls for the persisted TRACE document, never for `agent_runs.status === 'done'` - the status flips inside the persistence transaction while `saveRunTrace` runs just after it, and the race is invisible when the file runs alone.
- Does not: import `test/helpers/pg.ts` from any file not named `*.it.test.ts`.
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run .it.test --no-file-parallelism` , and READ the per-file lines: a file reporting "N skipped" with `Docker not available` did not run, and the lane still exits 0.

---

## PHASE D - the client for the main feature

**Step D1 - promote FindingCard**
- Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**` (moved) , `client/src/components/finding-card/**` (new location) , `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:9`
- Does: moves `FindingCard.tsx`, `FindingCard.test.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`, `index.ts` to `client/src/components/finding-card/` and points its ONE importer at `@/components/finding-card`.
  Required because the multi-agent results screen must render the same card, and a route importing a sibling feature's `_components` is rejected by `pnpm lint`.
  `EvalCaseModal` needs no move - it already sits at `@/components/eval-case-modal` and is already mounted from two routes.
- Does not: change the card's props; add a `Learn` or `Reply to author` action (the card already has neither, and both are rejected by the spec); change any existing assertion in `FindingCard.test.tsx`.
- Skills: `frontend-ui-architecture`, `react-testing-library`
- Verify: `cd client && pnpm test` , `cd client && pnpm lint` , `cd client && pnpm typecheck`

**Step D2 - nav entry and data hooks**
- Files: `client/src/vendor/ui/nav.ts:21-39` , `client/src/vendor/ui/nav.ts:61-74` , `client/messages/en/shell.json` , `client/src/lib/hooks/multi-agent.ts` (new)
- Does:
  - Adds ONE `NAV` item to the **WORKSPACE** group - `{ key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent", gKey: "m" }` - and ONE matching `SHORTCUTS` row.
    **This is the single place this plan knowingly edits a do-not-touch path.**
    `client/src/vendor/ui/nav.ts` is listed under `client/src/vendor/ui/**` in root `AGENTS.md`, yet `Sidebar.tsx` renders the `NAV` const directly and there is no app-side extension point, so `client/INSIGHTS.md:147` records this as "the one sanctioned exception to the vendored-UI freeze, data-only", and L02, L05 and L06 each added their entry the same way (commits `346bc7e`, `ac5edd8`, `cf38793`, `cebd9dd`, `3fe1394`), always as the same two-line diff.
    The course taken is therefore: follow the precedent, keep the edit to data only, and change nothing else in `vendor/ui/`.
  - `WORKSPACE`, not `GLOBAL`: the mockup's GLOBAL placement is rejected by the spec's Design review, because the page is repository-scoped and the same mockup shows a repository breadcrumb and switcher.
  - Grep `client/messages/en/shell.json` for `nav.multi-agent` BEFORE writing it; the design system ships these keys ahead of the lessons.
  - Adds `client/src/lib/hooks/multi-agent.ts` with an exported `multiAgentKeys` factory, `useAgentRunEstimates()`, `useStartMultiAgentRun()` and `useMultiAgentRun(runId)`, which polls every 4 seconds while any column is `running` - the same shape `usePrRuns` uses (`client/src/lib/hooks/reviews.ts:48-56`). Types come in with `import type` only.
- Does not: touch `client/src/components/app-shell/helpers.ts` - line 28 already returns `multi-agent` for any path containing `/multi-agent`; add `memory`, `agent-performance` or `ci-runs` nav entries; edit anything else under `client/src/vendor/ui/`; open an SSE stream for the results screen.
- Skills: `frontend-ui-architecture`, `react-best-practices`
- Verify: `cd client && pnpm test src/components/app-shell/helpers.test.ts` , `cd client && pnpm lint` , `cd client && pnpm typecheck`

**Step D3 - the configure screen**
- Files: `client/src/app/repos/[repoId]/multi-agent/layout.tsx` (new) , `client/src/app/repos/[repoId]/multi-agent/page.tsx` (new) , `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentConfigureView/**` (new) , `client/messages/en/runs.json`
- Does:
  - Adds `layout.tsx` mounting `ShellLayout`, copied from `client/src/app/repos/[repoId]/onboarding/layout.tsx` - a page that renders its own `AppShell` remounts the nav and re-registers its shortcut listeners on every navigation.
  - Adds a thin `page.tsx` that reads `params.repoId`, calls `useSetCrumb`, and renders one view component, following `repos/[repoId]/onboarding/page.tsx:17-26`.
  - Adds `MultiAgentConfigureView` with explicit early-return states rather than stacked ternaries: step 1 is the pull-request picker, and while no pull request is chosen step 2 is replaced by a "pick a pull request first" message and the run control stays disabled. Once a pull request is chosen, step 2 lists every enabled agent as a selectable row **sorted by name ascending**, with a select-all control and no upper limit on the selection.
  - Each agent row shows the agent's icon, its name and its stored `description`. **Nothing else.**
  - The run control is labelled with the live count and reads `(0)` with nothing selected, and stays disabled below two agents, with the reason stated beside it.
  - The estimate sits beside the run control, computed entirely client-side from `useAgentRunEstimates()`: duration is the LARGEST of the selected agents' medians, cost is the SUM. An agent with no successful run is left out and the estimate is marked partial; with no selected agent having history, the area is empty.
  - **Rewrites the pre-seeded `runs.json` `page.*` strings that contradict the spec.** `page.subtitle` says "every enabled agent" but the user chooses agents; `page.runAll` reads "Run all agents" but AC-7 requires the live counter; `page.meta` reads "fan-out via p-queue", which both leaks a library name and is not what AC-32 asks for. Add the missing keys: the estimate line, the partial marker, select-all, the empty pull-request picker, the fewer-than-two reason, and `conflicts.noOpinion`.
- Does not: show a run duration, a cost or a verdict sentence on an agent row (Design review: rejected, it is leakage from the results screen); show `(4)` with nothing selected (Design review: a mockup error); render "fan-out via worktrees"; issue a request per checkbox toggle; use an em dash in any new string.
- Skills: `next-best-practices`, `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test` , `cd client && pnpm lint` , `cd client && pnpm typecheck` , `cd client && pnpm build`

**Step D4 - the results screen**
- Files: `client/src/app/repos/[repoId]/multi-agent/[runId]/page.tsx` (new) , `client/src/app/repos/[repoId]/multi-agent/[runId]/_components/MultiAgentResultsView/**` (new) , `client/messages/en/runs.json`
- Does:
  - Header line: the agent count, that they ran in parallel, the run's duration and the run's cost, with the pull request's number and title beside it, and a partial marker when any cost is unknown.
  - A columns/tabs toggle whose choice is persisted in `localStorage` under `dd-multi-agent-view`, following the `dd-repo` / `dd-theme` pattern in `client/src/lib/repo-context.tsx:31,40` and `client/src/lib/theme.tsx:26`.
  - Each agent shows its name, duration, cost, score, findings with severity, title, file and start line, its findings count, and a control that opens `@/components/run-trace-drawer` for that run. A failed agent shows its recorded error in place of a score and a findings list; a running agent is shown as running, not as having found nothing.
  - The tabs view shows the agent's persisted review summary verbatim as its one-line verdict, and mounts `@/components/finding-card` plus `@/components/eval-case-modal`, giving exactly Accept, Dismiss and Turn into eval case.
  - The disagreement section renders one column per agent in the run **in every row**, including agents that produced nothing and agents whose runs failed. A silent agent's cell reads `conflicts.didNotFlag` and nothing else; a failed agent's cell reads `conflicts.noOpinion`, visibly distinct from it; a flagging agent's cell shows its severity and that finding's own rationale truncated to one line. The show-only-conflicts toggle hides every cluster where no two agents differ on severity. When nothing diverges, the section states the agents agreed instead of rendering an empty table.
  - Every severity, every agent identity and the "did not flag" stance are carried by TEXT, not only by colour.
  - Narrow viewport falls back from columns to tabs; cluster rows stack one agent per line with the agent name as the label; long titles truncate; a long unbroken token wraps or scrolls within its cell.
- Does not: render a column for an agent that was not in the run (the mockup's unselected Architecture column is a mockup error); put any explanatory sentence in a silent cell; show `Learn` or `Reply to author`; offer a per-agent re-run; issue one request per agent; make a cluster cell link to its finding (that is `open` in the Design review, not decided).
- Skills: `next-best-practices`, `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test` , `cd client && pnpm lint` , `cd client && pnpm typecheck` , `cd client && pnpm build`

**Step D5 - the pull request page absorbs a multi-agent run**
- Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:248-256`
- Does: groups the rows sharing a non-null `multi_agent_run_id` into one timeline entry labelled with the number of agents and the time the multi-agent run started, whose control navigates to `/repos/${repoId}/multi-agent/${multiAgentRunId}`.
- Does not: change how single-agent rows render; remove the per-run trace or delete controls; change the `ReviewRunAccordion` header's `N findings` prefix - `e2e/specs/04-pr-findings.flow.json` asserts the literal substring "2 findings" there, so anything new is APPENDED after it, never substituted.
- Skills: `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test` , `./scripts/e2e.sh`

### Test strategy
New tests: `server/src/modules/reviews/multi-agent.test.ts` (hermetic, the clustering and estimate table), `server/src/modules/reviews/multi-agent.it.test.ts` (DB-backed, the one integration test for this workflow), `client/.../RunsTab/RunsTab.test.tsx`, and component tests for `MultiAgentConfigureView` and `MultiAgentResultsView`.
Existing suites that must stay green without an assertion being edited: `server/test/reviews.it.test.ts` and `server/test/skills.it.test.ts` (they run the fan-out that Step C1 parallelises), `server/test/eval-scoring.test.ts` (Step B1 moves the function under it), `client/.../RunTraceDrawer.test.tsx` (Step A2 moves it, and the companion's AC-16 makes it the regression check for the move), `client/.../FindingCard.test.tsx` and `client/.../FindingsPanel.test.tsx` (Step D1), and `client/src/components/app-shell/helpers.test.ts`.
One DB-backed file is involved: `multi-agent.it.test.ts`. It must carry the `*.it.test.ts` suffix, pass `secrets: new MockSecretsProvider({})` alongside a full `overrides.llm`, and run under `--no-file-parallelism`.
Browser e2e gains no new flow: a multi-agent run needs an LLM and `e2e/` is deliberately key-free and model-free. `./scripts/e2e.sh` runs as a regression check only.

### Non-functional requirements
- Zero model calls beyond the N agent reviews plus the one shared intent classification the single-agent path already makes - enforced structurally by Step C2's `multi-agent-clustering-is-pure` depcruise rule and counted in Step C5.
- Concurrency is 3, matching `server/src/platform/jobs.ts:42` - Step C1.
- A multi-agent run never goes through `JobRunner`, whose default of two retries would re-issue and re-bill every model call the first attempt made - Steps C1 and C4.
- At most 4 starts per minute, matching the tightest existing limit on this API - Step C4.
- At most one multi-agent run in flight per pull request, refused with the in-flight run named - Step C3.
- Clustering under 10 ms for 10 agents at 20 findings each: at most 200 x 200 file-and-range comparisons, no I/O - Step C2.
- The results screen loads in ONE request; the Runs tab loads in ONE request returning at most 50 rows - Steps C4 and A1.
- The estimate reads at most the last ten successful runs per agent, bounded in SQL by a window function, not in JavaScript - Step C3.
- No new persisted data for the companion; the only new persistence anywhere is one nullable FK column - Step B3.
- Accessibility: every severity, agent identity and stance is carried by text as well as colour; every checkbox, toggle, trace control and finding action is tab-reachable; the trace drawer returns focus to the control that opened it - Steps A2, D3, D4.
- i18n: every user-facing string goes through next-intl, and no new string uses an em dash - Steps A3, D3, D4.
- Security: no new trust boundary. The diff, PR title and body, and project documents keep the existing untrusted delimiters and injection guard, unchanged, because the prompt path is untouched. One suspicion worth a look by `/security-review` rather than by this plan: `GET /agents/run-estimates` returns cost history for every enabled agent in the workspace on an unscoped-by-agent read.

### Stop conditions
- `pnpm db:generate` prompts instead of exiting: stop, do not pipe stdin, and report - the schema edit is meant to be purely additive.
- An existing `reviews.it.test.ts` or `skills.it.test.ts` case goes red after Step C1: stop and report rather than adjusting its assertion.
- The concurrent per-agent transactions contend on the shared `pull_requests` row through `markReviewed` badly enough to time out: stop and ask before moving `markReviewed` outside the per-agent transaction.
- Satisfying AC-17's stated observation point appears to require a new `agent_runs` column: stop and ask (see the closing questions).
- `client/messages/en/runs.json`'s pre-seeded `page.*` strings turn out to be asserted by an `e2e/specs/*.flow.json` file: stop and ask before rewriting them.
- Any step appears to need a second model call, an agent's output inside another agent's prompt, a worktree, or a new provider path: stop - all four are explicit non-goals.

### Acceptance criteria
- [ ] `overlaps` has exactly one implementation, in `modules/_shared/overlap.ts`, and both `eval` and `reviews` use it - verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`
- [ ] Both `observability.ts` copies and both `trace.ts` copies are byte-identical after the contract change - verify: `diff -q server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts && diff -q server/src/vendor/shared/contracts/trace.ts client/src/vendor/shared/contracts/trace.ts`
- [ ] `agent_runs.multi_agent_run_id` exists with its index, created by a GENERATED migration - verify: `cd server && git status --short src/db/migrations/` shows a new file nobody hand-edited, and `pnpm db:migrate` succeeds
- [ ] A five-agent run never has more than three model calls in flight - verify: the peak-concurrency case in `cd server && pnpm exec vitest run .it.test --no-file-parallelism`
- [ ] A multi-agent run loads its diff once and derives its intent once, and no agent's output appears in another agent's persisted prompt assembly - verify: the same integration file
- [ ] One failing agent leaves the others' results intact; every agent failing marks the run failed with each error shown - verify: the same integration file
- [ ] Duration is the max, cost is the sum, and an unknown cost marks the total partial - verify: the same integration file
- [ ] Reading a multi-agent run's results issues zero provider requests - verify: the model-call count assertion in the same integration file
- [ ] `multi-agent.ts` cannot reach the container, an adapter, the database or the review engine - verify: `cd server && pnpm arch:check`, watched red once before being trusted
- [ ] A second multi-agent run on a pull request with one in flight is refused, naming the in-flight run - verify: the same integration file
- [ ] The trace drawer lives in `client/src/components/run-trace-drawer/`, both screens import that one path, and no route `_components` folder contains it - verify: `rg -n "RunTraceDrawer" client/src` shows only the shared folder and two `@/components/run-trace-drawer` imports
- [ ] The pull request page's drawer behaviour is unchanged by the move - verify: `cd client && pnpm test` with `RunTraceDrawer.test.tsx`'s assertions untouched
- [ ] The Runs tab appears after Evals, is reachable at `?tab=runs` after a reload, lists only that agent's runs newest first, and opens each into the shared drawer - verify: `cd client && pnpm test` plus a manual load of `/agents/<id>?tab=runs`
- [ ] Multi-Agent Review sits in the WORKSPACE nav group and the shell highlights exactly one item on that page - verify: `cd client && pnpm test src/components/app-shell/helpers.test.ts`
- [ ] The run control reads `(0)` with nothing selected and stays disabled below two agents; an agent row shows only icon, name and description - verify: `cd client && pnpm test` on `MultiAgentConfigureView.test.tsx`
- [ ] The estimate is the max of the selected medians and the sum of the selected medians, partial when an agent has no history, absent when none does - verify: the same component test
- [ ] The results screen offers columns and tabs, remembers the choice across a reload, and its disagreement table has one column per agent in every row - verify: `cd client && pnpm test` on `MultiAgentResultsView.test.tsx`
- [ ] A silent cell reads "did not flag" and nothing else; a failed agent's cell is visibly distinct from it - verify: the same component test
- [ ] A finding accepted from the results screen shows as acted on in the pull request's findings list - verify: manual, `./scripts/dev.sh` then act on a finding and reload `/repos/<id>/pulls/<n>`
- [ ] The pull request's run history shows one multi-agent run as one group that navigates to its results - verify: `cd client && pnpm test` plus `./scripts/e2e.sh` green
- [ ] Nothing regressed anywhere - verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`, `cd server && pnpm exec vitest run .it.test --no-file-parallelism`, `cd server && pnpm arch:check`, `cd client && pnpm test && pnpm lint && pnpm typecheck && pnpm build`, `cd reviewer-core && npm test`, `./scripts/e2e.sh`

### Deliberately out of scope
- A seeded multi-agent run in `server/src/db/seed.ts` and a browser e2e flow over the results screen - see the rationale's Recommendations; picked up by whoever accepts that recommendation, not by this plan.
- `Learn`, `Reply to author`, `Memory`, `Agent Performance`, `CI Runs`, per-agent re-run, a combined score, semantic clustering, and any source filter on the Runs tab - all explicit non-goals of one spec or the other.
- Writing `source: 'ci'` runs - a later lesson.
- Architectural review of the result: `arch-evidence` then `architecture-reviewer`, with the layer placement of `multi-agent.ts` and `multi-agent.repo.ts` and the client `src/components/` promotions as the things to look at.
- Security review of the result: `/security-review`, with `GET /agents/run-estimates` and the new rate limit as the things to look at.

---

## Open questions for the user

Each has a default, so a short answer unblocks.

1. **Should the parallel fan-out apply to every fan-out, or only to multi-agent runs?**
   Default: every fan-out - `executeRuns` is one code path, the PR page's "run all" benefits identically, and forking it would mean two loops to keep in step.
2. **AC-17 says concurrency is observed at "the recorded start times of the agent runs", but all N rows are created up front with the same `ran_at`, so that is unobservable.**
   Default: verify it by counting concurrent model calls in the integration test, and add no column. The alternative is a new `agent_runs.started_at`.
3. **`client/messages/en/runs.json` is pre-seeded with L07 strings, three of which contradict the spec** ("every enabled agent", "Run all agents", "fan-out via p-queue").
   Default: rewrite them to match the spec's Design review, which is authoritative over both the mockups and the seeded copy.
