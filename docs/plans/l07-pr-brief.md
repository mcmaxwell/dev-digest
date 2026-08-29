# Plan: L05 PR Brief - grounded risks, ranked review focus, and an append-only brief history

Spec: `docs/specs/L05-pr-brief.md` (L05, approved)
Rationale: `docs/plans/l07-pr-brief.rationale.md`

## Understanding

Build a new `brief` server module that composes `pulls` + `intent` + `blast` facts
into ONE structured model call, grounds every path/line/endpoint the model returns
against a candidate set, persists a current brief plus an append-only history
entry, and serves it as a new PR Overview card. The card absorbs the intent card's
risk-area chips and the blast card's impact-summary block, deleting neither.
Out of scope: blast radius, intent, project-context, `PrBrief` in `contracts/brief.ts`,
`agent_runs`, any new external port, and deletion of any absorbed artifact.

## Architectural constraints

- **A module must not import another module's non-exempt file.** `no-cross-module-imports`
  (`server/.dependency-cruiser.cjs:33-57`) exempts only `service.ts`, `types.ts`,
  `constants.ts` of a sibling, plus `modules/_shared/`, and `dependencyTypesNot: ['type-only']`
  means value imports are the only thing it catches. Consequences, all binding:
  - `intent/helpers.ts::toBriefIntent` is **not importable**. Use
    `IntentService.renderBlock(prIntent)` (`server/src/modules/intent/service.ts:69-71`),
    the already-shipped seam. See Stop conditions.
  - `intent/hunk-map.ts::buildFileMap` is **not importable**. Step 3 moves it to
    `modules/_shared/hunk-map.ts`.
  - `intent/sources.ts::resolveRepoFiles` / `resolveLinkedIssue` are **not importable**
    and are not exported at all. Step 5 re-resolves both inside `brief` using
    `SPEC_FILE_CANDIDATES` and `LINKED_ISSUE_RE` from `intent/constants.ts` (exempt).
  - `intent/service.ts` and `blast/service.ts` **are** importable - the documented
    composition seam (`blast/service.ts:11-13` states it verbatim).
- **Only a repository imports the drizzle query builder**, and a table has exactly
  one owning repository - `queries-live-in-repositories`, `server/AGENTS.md:36-39`.
  `pr_files` is owned by `reviews/repository/pull.repo.ts:28`, so the prior-PR
  overlap query lands THERE and is reached via `container.reviewRepo`, never in
  `brief/repository.ts`.
- **Routes are transport only** - `routes-are-transport-only`. The degraded gate,
  the tenancy 404, and the single-flight guard live in the service
  (`blast/service.ts:44-48` states this as L02's lesson).
- **A service builds its own repository from `container.db`**, never from a
  container getter - tests construct `new XService({ db } as unknown as Container)`
  (`server/INSIGHTS.md:405-410`, and `blast/service.ts:54-56` follows it).
- **The contract lives in two physical copies** - `server/src/vendor/shared` (canonical)
  and `client/src/vendor/shared`. Both move in Step 1, in the same step.
- **The barrel `export *`s every contract file**, so a new contract file must
  re-export NOTHING it imports - a duplicate export is a build error in every
  consumer (`INSIGHTS.md:59-65`, `contracts/blast.ts:18-21`).
- **`contracts/brief.ts` is byte-identical before and after** (AC-53). It is
  imported from, never edited.
- **The brief's prompt does not go through `assemblePrompt`**, so the shared
  `INJECTION_GUARD` is NOT appended for free. `blast/prompt.ts:27-31` (`DATA_GUARD`)
  + `wrapUntrusted` from `platform/prompt.ts` is the reference implementation and
  must be copied in shape (AC-8, AC-9).
- **Never `withRetry` around a billable call.** NFR: "Retry wrapper around the call:
  None." Schema repairs go through `StructuredRequest.maxRetries` only
  (`vendor/shared/adapters.ts:63`), which `onboarding/service.ts:316` sets from
  `MAX_SCHEMA_REPAIRS`.
- **Do-not-touch borders this work:** `server/src/db/migrations/**` (generated -
  edit `db/schema/*.ts` then `pnpm db:generate`), `client/src/vendor/ui/**`,
  `server/clones/**`.
- **Keep migration 0019 purely additive.** `pnpm db:generate` turns interactive and
  hangs on piped stdin when one table both gains and drops columns
  (`.claude/repo-facts.md:97-99`, `server/INSIGHTS.md:469-475`). Never rename or
  drop `pr_brief.json`.
- **Client:** data access only through `src/lib/hooks/*` -> `src/lib/api.ts`; every
  user-facing string through next-intl; one feature must not import a sibling
  feature's `_components` (`client/AGENTS.md:33-43`).

## Skills for the implementer

| Step | Skill | Why |
| --- | --- | --- |
| 1 | `zod` | New contract file in both `vendor/shared` copies; `.extend()` over imported schemas, no re-exports |
| 2 | `postgresql-table-design`, `drizzle-orm-patterns` | `pr_brief` column additions + the append-only `pr_brief_history` table, its FK index and its ordering index |
| 3 | `onion-architecture` | Moving a shared pure helper into `modules/_shared/` is the sanctioned fix for `no-cross-module-imports` |
| 4 | `zod`, `typescript-expert` | Structured-output schema (flat `z.object`) + the pure grounding/candidate types |
| 5 | `onion-architecture` | Prompt assembly is application-layer pure code; `DATA_GUARD` + `wrapUntrusted` placement |
| 6 | `drizzle-orm-patterns`, `onion-architecture` | `brief/repository.ts` owns two tables; the overlap query goes to the `reviews` repository |
| 7 | `onion-architecture`, `fastify-best-practices` | Service composition + schema-first route with a per-route rate limit |
| 8 | - | Integration test; follows `test/blast.it.test.ts` |
| 9 | - | Generated repo card |
| 10 | `frontend-ui-architecture`, `react-best-practices` | New hook file + query-key factory |
| 11 | `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `next-best-practices` | The new card, its states, its colocated test |
| 12, 13 | `react-best-practices`, `react-testing-library` | Edits to two shipped cards + their tests |
| 14 | `react-best-practices`, `next-best-practices` | URL-param plumbing through the shared diff viewer |

## Steps

### Step 1 - New contract file, both vendor copies, one step

- Files (all `(new)` except the two barrels):
  `server/src/vendor/shared/contracts/pr-brief.ts` (new)
  `client/src/vendor/shared/contracts/pr-brief.ts` (new)
  `server/src/vendor/shared/index.ts:33` (add one `export *` line)
  `client/src/vendor/shared/index.ts` (same line, same position)
- Does: declares ONLY new names. Imports and extends, never redeclares:
  `Risk`, `RiskSeverity`, `PrHistoryItem` from `./brief.js`; `BlastIndexState` from
  `./blast.js`. Suggested surface (names verified free of collision by
  `rg '^export (const|type)' server/src/vendor/shared/contracts/*.ts`):
  `GroundedRisk` (`Risk.extend({ file_refs: z.array(z.string()).min(1) })`),
  `ReviewFocusEntry` (`{ file, line: number|null, reason }`),
  `BriefProse` (`{ what, why }` - two fields, never one blob),
  `BriefDropped` (per-category counts: risks, focus entries, file refs, lines,
  endpoints, crons), `BriefMeta` (`{ provider, model, head_sha, indexed_sha,
  generated_at, stale }`), `BriefStatus` (`'ok' | 'degraded'`),
  `BriefDegradedReason` (`'index_degraded' | 'clone_unavailable' | 'model_failed' |
  'no_files'`), `BriefHistoryEntry` (`{ head_sha, generated_at, risk_level, what }`),
  `BriefView` (the whole brief: prose, `risk_level: RiskSeverity`, `risks:
  GroundedRisk[]`, `review_focus: ReviewFocusEntry[]`, `history: PrHistoryItem[]`,
  `brief_history: BriefHistoryEntry[]`, `dropped`, `meta`, `index: BlastIndexState`,
  `status`, `degraded_reason`), and the wrapper
  `PrBriefResponse = z.object({ brief: BriefView.nullable() })` - nullable wrapper,
  mirroring `intent/routes.ts:11-17`'s reasoning, because the client's `apiFetch`
  turns any non-2xx into a thrown `ApiError`.
- Does not: touch `contracts/brief.ts` or `contracts/blast.ts`. Does not re-export
  `Risk`, `RiskSeverity`, `PrHistoryItem`, `BlastIndexState`, or any other imported
  name. Does not add a second `history`-named field - `history` is the **prior
  overlapping PRs**, `brief_history` is the **per-generation timeline**; they are
  different data and must never share a name.
- Skills: `zod`
- Verify: `diff -q server/src/vendor/shared/contracts/pr-brief.ts client/src/vendor/shared/contracts/pr-brief.ts`
  then `cd server && pnpm typecheck` and `cd client && pnpm typecheck`

### Step 2 - Schema and migration 0019

- Files: `server/src/db/schema/reviews.ts:135-140`, plus the generated
  `server/src/db/migrations/0019_*.sql` (produced by the tool, never hand-written)
- Does, **additively only**:
  1. `pr_brief` (`reviews.ts:135`) keeps `pr_id` PK and keeps the `json` column
     unchanged as the payload column. ADD: `head_sha text`, `indexed_sha text`,
     `provider text`, `model text`, `status text NOT NULL DEFAULT 'ok'`,
     `degraded_reason text`, `generated_at timestamptz NOT NULL DEFAULT now()`,
     `trace jsonb` (the persisted prompt - the DB-only mirror of `pr_intent.trace`
     at `reviews.ts:99-104`, which is what AC-6/7/8/9/10 are observed against).
     Carry a doc comment in the same voice as `prBlastSummary` (`reviews.ts:107-120`)
     stating that the table carries no `workspace_id`, so `BriefService` is the
     tenancy boundary, and that `stale` is derived on read from BOTH shas.
  2. NEW table `pr_brief_history`: `id uuid PK defaultRandom()`,
     `pr_id uuid NOT NULL references pull_requests(id) ON DELETE cascade`,
     `head_sha text NOT NULL`, `risk_level text NOT NULL`, `what text NOT NULL`,
     `generated_at timestamptz NOT NULL DEFAULT now()`, and ONE index on
     `(pr_id, generated_at)` - it is both the FK index Postgres does not create
     automatically and the read path's ordering index.
     `uuid ... defaultRandom()` over `BIGINT IDENTITY` because every id column in
     `db/schema/**` is a uuid; consistency beats the skill's default here.
- Does not: drop, rename, or retype `pr_brief.json`; touch `pr_blast_summary`
  (AC-33 requires existing rows stay readable, and no migration is needed for that);
  hand-edit the generated `.sql`.
- Skills: `postgresql-table-design`, `drizzle-orm-patterns`
- Verify: `cd server && pnpm db:generate` (must complete non-interactively and
  produce exactly one `0019_*.sql`), then `pnpm db:migrate`, then
  `pnpm exec vitest run --exclude '**/*.it.test.ts'`

### Step 3 - Move the hunk map into `_shared` and add the range extractor

- Files: `server/src/modules/_shared/hunk-map.ts` (new - the moved file),
  `server/src/modules/intent/hunk-map.ts` (deleted),
  `server/src/modules/intent/sources.ts:14` (import path),
  `server/src/modules/intent/constants.ts:21,23` (the two constants move with the file)
- Does: moves `buildFileMap` verbatim, comment block included, into
  `modules/_shared/hunk-map.ts` - the sanctioned sharing point, since
  `no-cross-module-imports` exempts `_shared/` and `diff-loader.ts:9-14` sets the
  precedent for exactly this move. Moves `MAX_FILE_MAP_FILES` and
  `MAX_HUNKS_PER_FILE` into the moved file (they have exactly one consumer,
  verified by `rg 'MAX_FILE_MAP_FILES|MAX_HUNKS_PER_FILE' server/src server/test client/src`)
  so `_shared` never imports from a feature module. ADDS one new pure export:
  `buildHunkRanges(diff: UnifiedDiff): Map<string, {start: number; end: number}[]>`,
  derived from the same `hunk.newStart` / `hunk.newLines` fields the `@@` headers
  are reconstructed from, so the rendered map and the grounding ranges can never
  disagree.
- Does not: change `buildFileMap`'s output by one character (AC-7 observes the
  persisted prompt against `buildFileMap` output for the same diff); change
  `safePath`; touch `adapters/git/diff-parser.ts`.
- Skills: `onion-architecture`
- Verify: `cd server && pnpm arch:check && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`

### Step 4 - `modules/brief` pure core: constants, structured schema, candidates, grounding

- Files (all new): `server/src/modules/brief/constants.ts`,
  `server/src/modules/brief/types.ts`, `server/src/modules/brief/schemas.ts`,
  `server/src/modules/brief/candidates.ts`, `server/src/modules/brief/ground.ts`,
  `server/src/modules/brief/history.ts`, plus colocated
  `candidates.test.ts`, `ground.test.ts`, `history.test.ts`
- Does:
  - `constants.ts` carries every ceiling from the spec's NFR table, nothing derived
    at a call site: `PROMPT_TOKEN_CEILING = 20_000`, `MODEL_TIMEOUT_MS = 30_000`,
    `MAX_SCHEMA_REPAIRS = 2`, `MAX_PROSE_CHARS = 400`, `MAX_REVIEW_FOCUS = 8`,
    `MAX_RISKS = 10`, `MAX_PRIOR_PRS = 5`, `MAX_BRIEF_HISTORY = 20`.
  - `schemas.ts`: a **flat** `z.object` for the model call plus
    `BRIEF_SCHEMA_NAME = 'PrRiskBrief'` - flat because a top-level `oneOf` is
    handled markedly worse by models (`blast/schemas.ts:4-17`, root
    `INSIGHTS.md:116-122`). `schemaName` is what AC-1 identifies the call by.
    `.max()` on the prose fields is advisory; the service clamps again.
  - `candidates.ts` (pure, no Container): builds the candidate set - the union of
    changed-file paths and blast caller-file paths; the endpoint set; the cron set;
    and the per-file line-range map. **The line-range map is built ONLY from
    `buildHunkRanges`.** `BlastCaller.line` is never passed into this file or into
    `ground.ts`, so AC-16 holds by construction rather than by a filter that could
    be removed later. This is the shape `modules/onboarding/candidates.ts:9-19`
    exists to teach: membership properties cannot be satisfied post-hoc.
  - `ground.ts` (pure, over the candidate set): the rejection gate. Drops a risk or
    focus entry whose file is outside the union (AC-13); drops an endpoint/cron
    reference outside the blast result (AC-14); drops a line outside that file's
    `@@` ranges while keeping the entry at file level (AC-15, AC-16); counts every
    drop by category (AC-17); returns an empty-but-valid brief when everything is
    dropped (AC-18); caps `risk_level` at the highest **surviving** severity (AC-19).
    Applies `MAX_RISKS` / `MAX_REVIEW_FOCUS` after grounding, preserving the model's
    order (AC-39).
  - `history.ts` (pure): ranks prior PRs of the same repo by changed-file overlap,
    most recent first, capped at `MAX_PRIOR_PRS`, mapped to `PrHistoryItem`.
- Does not: import `Container`, `drizzle-orm`, `src/db`, or anything under
  `modules/` other than `_shared/`. Does not read `BlastCaller.line`. Does not
  contain the prompt (Step 5) or any I/O (Step 7).
- Skills: `zod`, `typescript-expert`
- Verify: `cd server && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'`

### Step 5 - `modules/brief/prompt.ts`: the guard, the wrapper, the budget ladder

- Files: `server/src/modules/brief/prompt.ts` (new),
  `server/src/modules/brief/prompt.test.ts` (new)
- Does: assembles `{ system, user }` purely, modelled line for line on
  `server/src/modules/blast/prompt.ts`:
  - A `DATA_GUARD` constant appended to the system prompt, stating that everything
    inside `<untrusted>...</untrusted>` is data extracted from a third-party
    repository and never instructions, in any language (AC-9). This path does not
    call `assemblePrompt`, so it does **not** inherit `INJECTION_GUARD`
    (`blast/prompt.ts:19-24` and `server/AGENTS.md:58-60` both say so explicitly).
  - Every repository-derived block wrapped in `wrapUntrusted(label, text)` from
    `platform/prompt.ts` (AC-8) - the PR title/body block, the intent block, the
    file map, the blast digest, the spec excerpts, the prior-PR titles. `wrapUntrusted`
    is also what neutralises a literal closing delimiter, so a symbol or path named
    after it cannot close the block early.
  - A rule list carrying, verbatim in meaning, `blast/prompt.ts:36`'s constraint:
    the model has seen no diff and no source code, so it may describe reach and
    purpose but never claim a defect, a runtime behaviour, or an intent not in its
    inputs (AC-22). Plus: at most three sentences per field (AC-21); when the index
    note says `partial`, state plainly in `what` that the picture may be incomplete
    (AC-23) - reuse the shape of `blast/prompt.ts:42-53`'s `indexNote`.
  - A budget ladder over `PROMPT_TOKEN_CEILING`, measured with
    `container.tokenizer.count` passed in as a function (keeping this file pure).
    Blocks are dropped in the **fixed** order: prior-PR history, then blast callers,
    then spec excerpts, then the file map (AC-10). The assembler returns the list of
    blocks it kept, so the persisted trace can be asserted against a fixture that
    exceeds the ceiling.
  - No diff hunk body can reach it: the only change-location source is the Step 3
    file map (AC-6, AC-7).
- Does not: call the model, read the DB, take a `Container`, or use `withRetry`.
  Does not append `INJECTION_GUARD` from reviewer-core (this path does not use
  `assemblePrompt`; the explicit `DATA_GUARD` is the requirement).
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`

### Step 6 - Persistence: `brief/repository.ts` + the prior-PR overlap query

- Files: `server/src/modules/brief/repository.ts` (new),
  `server/src/modules/reviews/repository/pull.repo.ts:33` (add one query),
  `server/src/modules/reviews/repository.ts:53` (add one delegating method)
- Does:
  - `BriefRepository(db)` is the ONLY owner of `pr_brief` and `pr_brief_history`.
    `get(prId)`, `upsert(values, dbOrTx)` on `pr_brief` (replace-wholesale, same
    shape as `blast/repository.ts:42-50`), `appendHistory(values, dbOrTx)`, and
    `history(prId, limit)` ordered `generated_at` DESC (AC-45). It exposes
    `transaction(fn)` so the SERVICE owns the boundary, and the upsert + the append
    happen inside ONE transaction (`server/AGENTS.md:40-42`).
    **There is no update and no delete method on `pr_brief_history`** - AC-44 is
    enforced by the absence of the code path, not by discipline. Say so in the doc
    comment, alongside the `pr_intent`-style note that this table carries no
    `workspace_id` so the service is the tenancy boundary
    (`server/INSIGHTS.md:431-437`).
  - `pull.repo.ts` gains `overlappingPulls(db, repoId, prId, paths, limit)`:
    prior PRs of the same repo whose `pr_files.path` intersects `paths`, newest
    first. It goes here because `pr_files` is already owned here (`pull.repo.ts:28`)
    and a table has exactly one owning repository. `ReviewRepository` gets the
    one-line delegate so `brief` reaches it through `container.reviewRepo`.
- Does not: put a `pr_files` query in `brief/repository.ts`; import `drizzle-orm`
  anywhere outside a `repository*.ts`; add a `workspace_id` column to either table.
- Skills: `drizzle-orm-patterns`, `onion-architecture`
- Verify: `cd server && pnpm arch:check && pnpm typecheck`

### Step 7 - `BriefService` + `routes.ts` + registration + the prompt-log union

- Files: `server/src/modules/brief/service.ts` (new),
  `server/src/modules/brief/routes.ts` (new),
  `server/src/modules/index.ts:16,46` (one import + one entry),
  `server/src/platform/prompt-log.ts:89,111` (add `'brief'` to the `call` union)
- Does:
  - `BriefService(container)` builds `new BriefRepository(container.db)` in its
    constructor - from `container.db`, not a getter (`server/INSIGHTS.md:405-410`).
  - `get(workspaceId, prId)`: resolve the PR through
    `container.reviewRepo.getPull(workspaceId, prId)` and 404 FIRST (AC-49), read
    the stored row, derive `stale` on read against BOTH `head_sha` and
    `indexed_sha` from `BlastService.get()`'s `index.last_indexed_sha` - following
    `blast/service.ts:247-259`'s `rowToMeta`, not `pr_intent`'s single-SHA rule
    (AC-24). Returns the stored brief with **no model call** (AC-4) and never
    generates (AC-5, AC-26).
  - `generate(workspaceId, prId, { logger })`:
    1. Tenancy 404 first.
    2. An in-process single-flight map keyed by `prId`, claimed before any I/O, so
       a second in-flight request awaits the first's result instead of issuing a
       second call - the shape at `modules/onboarding/service.ts::requestGeneration`.
       Do NOT describe this as a TOCTOU fix in the commit message
       (`server/INSIGHTS.md:203-217`).
    3. Gather facts: `BlastService.get()` for reach + index state;
       `IntentService.get()` for the intent, rendered into the prompt via
       `IntentService.renderBlock(prIntent)`; `loadDiff(container,
       container.reviewRepo, ref, base, headSha, prId)` from
       `modules/_shared/diff-loader.ts` for the `@@` ranges; the linked issue via
       `container.github()` matched with `LINKED_ISSUE_RE` from `intent/constants.ts`,
       recorded with an explicit status and never with content when the fetch failed
       (AC-11); spec text via `SPEC_FILE_CANDIDATES` from `intent/constants.ts` over
       `container.git.readFile`, treating blank content as absent
       (`server/INSIGHTS.md:501-504`); prior overlapping PRs via
       `container.reviewRepo.overlappingPulls(...)`. **No raw `fetch`, no URL outside
       github.com pointing at this repository is ever dereferenced** (AC-12).
    4. Hard gates before any spend, each persisting a deterministic brief with an
       explicit `degraded_reason` and zero model calls: `index.status === 'degraded'`
       -> `index_degraded`; the clone gone -> `clone_unavailable`; no changed files ->
       `no_files`.
    5. `new SettingsService(this.container).resolveFeatureModel(workspaceId,
       'risk_brief')` (AC-2) - the same feature id `blast/service.ts:99` already uses.
    6. `logPromptAssembly(...)` with `call: 'brief'` BEFORE the call, so it survives
       a provider failure (`intent/service.ts:116-132` is the shape). Metadata only
       - content goes to `pr_brief.trace`, never to a log line.
    7. **Exactly one** `llm.completeStructured({ ..., maxRetries: MAX_SCHEMA_REPAIRS })`
       wrapped in `withTimeout(..., MODEL_TIMEOUT_MS)` and **not** in `withRetry`
       (AC-1; NFR "Retry wrapper: None"). A failure persists the deterministic brief
       with `degraded_reason: 'model_failed'` and returns 200, never an error status.
    8. Ground the result through Step 4's `ground.ts`, clamp each prose field to
       `MAX_PROSE_CHARS`, then in ONE transaction upsert `pr_brief` and append one
       `pr_brief_history` row carrying the head SHA the generation ran at
       (AC-43, AC-48).
    9. One `logger.info` line: ids, counts, `provider`, `model`, and the
       provider-reported `res.tokensIn` / `res.tokensOut` / `res.costUsd` - never
       a locally measured token count presented as spend (`server/INSIGHTS.md:188-201`).
    10. **No `agent_runs` row is created** (AC-3, AC-51).
  - `routes.ts`: `GET /pulls/:id/brief` (no per-route limit, the global 120/min
    covers a plain read) and `POST /pulls/:id/brief` with
    `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (AC-50), both
    `schema: { params: IdParams, response: { 200: PrBriefResponse } }`. Both return
    the whole envelope so the client seeds one cache entry with `setQueryData`.
    Transport only: `getContext` -> one service call.
  - `prompt-log.ts`: widen the `call` union at `:89` and `:111` from
    `'intent' | 'review' | 'onboarding'` to include `'brief'`. Nothing else in that
    file changes.
- Does not: create an `agent_runs` row; return any blast field in the response
  (the client already fetches `PrBlastResponse` for the shipped card - the brief
  carries only `index`); modify `pr_blast_summary` or the deprecated
  `POST /pulls/:id/blast/summary` route beyond a one-line "deprecated: superseded
  by POST /pulls/:id/brief, still functional, no longer called by the client"
  note in `blast/routes.ts`'s doc comment; use `withRetry`; import drizzle.
- Skills: `onion-architecture`, `fastify-best-practices`
- Verify: `cd server && pnpm arch:check && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`

### Step 8 - `brief.it.test.ts`

- Files: `server/src/modules/brief/brief.it.test.ts` (new)
- Does: follows `server/test/blast.it.test.ts` and
  `server/src/modules/onboarding/onboarding.it.test.ts`. Must:
  - Parse the response with the **client's** copy of the contract
    (`import { PrBriefResponse } from '../../../../client/src/vendor/shared/contracts/pr-brief.js'`),
    which is what turns AC-52 from a checklist item into a failing test
    (root `INSIGHTS.md:66-73`; `blast.it.test.ts:30-33`).
  - Pass `secrets: new MockSecretsProvider({})` **and** an explicit
    `overrides.llm` entry for every provider it can resolve - a test that omits
    either is not hermetic and makes real billable calls
    (`server/INSIGHTS.md:238-249`, `.claude/repo-facts.md:103-105`).
  - Cover: a PR from another workspace 404s (AC-49); a degraded index makes zero
    model calls and returns a deterministic brief (spy on the mock provider);
    `GET` after a generation issues no second call (AC-4); `/pulls/:id/runs` returns
    the same count before and after (AC-3) and `total_cost_usd` is unchanged (AC-51);
    two generations append two history rows and the first row is byte-identical
    afterwards (AC-43, AC-44); a model output naming two invented paths yields
    non-zero dropped counts and a 200 (AC-17, AC-18).
  - To observe what the SERVICE logged, construct it directly over `app.container`
    with a capturing logger - routes hand it `app.log`, which is a noop under the
    test config (`server/INSIGHTS.md:10-21`). That is the observation point for AC-1.
- Does not: use `vitest -t` to prove a case fails without its trigger - an
  `*.it.test.ts` file is one container and one accumulated fixture, so `-t` fails
  for the wrong reason (`server/INSIGHTS.md:285-294`).
- Verify: `cd server && pnpm exec vitest run .it.test --no-file-parallelism`
  (read the per-file lines - a green lane is not evidence a file ran;
  `server/INSIGHTS.md:275-283`)

### Step 9 - Regenerate the repo card and add the module README pointer

- Files: `.claude/repo-facts.md` (regenerated, never hand-edited),
  `server/src/modules/brief/README.md` (new),
  `AGENTS.md:79` (one new "Read when..." bullet, after the onboarding one)
- Does: runs `./scripts/repo-facts.sh` because a module and a contract file changed
  (`AGENTS.md:68-71`). The README follows `modules/onboarding/README.md`'s shape:
  the one model call, the candidate-set grounding, the degraded matrix, the two
  histories and why they are not the same thing. `CLAUDE.md` is a symlink to
  `AGENTS.md` - that is ONE edit, not two (root `INSIGHTS.md:79-87`).
- Verify: `git diff --stat .claude/repo-facts.md` shows the `brief` module and
  `contracts/pr-brief.ts` present

### Step 10 - Client data hook and i18n strings

- Files: `client/src/lib/hooks/brief.ts` (new),
  `client/messages/en/brief.json:1-13` (add keys into the EXISTING `brief` namespace)
- Does: `briefKeys = { all: ['pr-brief'], forPull: (prId) => ['pr-brief', prId] }`,
  `usePrBrief(prId)` (`enabled: !!prId`), and `useGenerateBrief(prId)` as a
  `useMutation` whose `onSuccess` does `qc.setQueryData(briefKeys.forPull(prId), data)`
  - byte-for-byte the shape of `client/src/lib/hooks/blast.ts:10-13,43-49`. Adds the
  new strings under the existing `brief` namespace (which `OverviewTab.tsx:20` and
  `IntentCard.tsx` already use); `client/src/i18n/request.ts:16-25` auto-discovers
  files, so no registration is needed and no new namespace file should be created.
  The pre-staged keys `block.risks`, `noRisks`, `noHistory`, `overlap` already exist
  at `brief.json:5,8,9,10` - reuse them rather than adding near-duplicates.
- Does not: add a `pr-brief.json` file; hand-write a query key in a component;
  put raw `fetch` anywhere but `lib/api.ts`.
- Skills: `frontend-ui-architecture`, `react-best-practices`
- Verify: `cd client && pnpm typecheck && pnpm lint`

### Step 11 - The PR Brief card

- Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`
  (new: `PrBriefCard.tsx`, `styles.ts`, `constants.ts`, `index.ts`,
  `PrBriefCard.test.tsx`),
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:27-35`
- Does: renders below the existing `s.briefGrid`
  (`OverviewTab/styles.ts:10-15` - the auto-fit grid the spec's narrow-viewport
  edge case refers to), so the brief's blocks stack beneath the two shipped cards.
  States, each an early return, not stacked ternaries:
  - no brief -> `EmptyState` with a generate CTA, copying `IntentCard.tsx:66-73`
    (AC-34)
  - generating -> CTA disabled + pending indicator (AC-35)
  - `status === 'degraded'` -> the deterministic brief plus its reason and a retry
    control, never an error page (AC-36); offline -> `ErrorState` with `onRetry`,
    the shape at `IntentCard.tsx:50-58` (edge case "Offline client")
  - `meta.stale` -> the FULL contents beneath a stale badge, reusing the
    `Badge icon="GitCommit" color="var(--sev-warning, #fbbf24)"` pattern at
    `IntentCard.tsx:127-131` - never an empty state (AC-25)

  Content: one paragraph of prose (`what` then `why`) and nothing else generated
  on the tab (AC-20); a `risk_level` badge on the section label (AC-19); the risks
  list, each risk exposing an activatable link whose accessible name contains the
  file path (AC-37); the review-focus list rendered in stored array order (AC-39),
  every entry Tab-reachable with a visible focus indicator and Enter-activatable
  (AC-40); the dropped counts (AC-17); a `provider - model` line, matching
  `SummaryBlock.tsx:56`'s `summary.by`; and a collapsible brief-history section
  rendered newest first (AC-45), present even with a single entry (AC-47), zipping
  the PR's `commits` (already on the page as `pr.commits`, passed to `FindingsTab`
  at `page.tsx:190`) against `brief_history` so a commit with no entry renders an
  explicit no-brief marker (AC-46). Severity and risk level are conveyed by icon or
  label **in addition to** colour, following `IntentCard/constants.ts:8-22`'s
  `RISK_ICON` + `RISK_COLOR` pairing (NFR: colour independence).
  Activating a review-focus entry calls
  `setParams({ tab: 'diff', file: path }, { scroll: false })` - Step 14 (AC-38).
  Colocated test follows `BlastRadiusCard.test.tsx:16-28,79-91`: hoisted `vi.mock`
  of `@/lib/hooks/brief` forwarding `prId`, real `messages/en/brief.json` through
  `NextIntlClientProvider`. Include the
  `expect(screen.getAllByRole('button'))`-style assertion that the card's only
  buttons are ones that do something - `MonoLink` without an `href` renders an
  inert clickable-looking button and `Chip` is a `<button>` even when it only shows
  a number (`client/INSIGHTS.md:85-93`). Stub `Element.prototype.scrollIntoView`
  in the test file; jsdom does not implement it (`client/INSIGHTS.md:202-213`).
- Does not: fetch blast data (the brief carries only `index`; the shipped
  `BlastRadiusCard` already fetches `PrBlastResponse`); import
  `../BlastRadiusCard/_components/*` or any sibling feature's internals
  (`client/INSIGHTS.md:95-101`); auto-generate on render - generation is a click
  (AC-26); render an `sr-only` live region as a bare sibling without a positioned
  parent (`client/INSIGHTS.md:259-275`).
- Skills: `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `next-best-practices`
- Verify: `cd client && pnpm test && pnpm typecheck && pnpm lint`

### Step 12 - Remove the intent card's risk-area chips

- Files:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx:149-164`
  (and the imports of `RISK_ICON` / `RISK_COLOR` that become unused)
- Does: deletes only the risk-areas JSX block, so the card keeps its quote, its
  scope columns, its confidence badge and its missing-context notice, and the
  Overview tab holds exactly one risk list (AC-41). A PR with an intent but no
  brief then shows scope columns and no chips (AC-42).
- Does not: delete `RISK_ICON` / `RISK_COLOR` from `IntentCard/constants.ts:8-22`;
  delete the `intent.riskAreas` key at `messages/en/brief.json:23`; change
  `pr_intent.risk_areas` on the server, which is still produced, stored and fed to
  the reviewer prompt by `intent/helpers.ts:93-98`; add a test for the removed
  block - there is no `IntentCard.test.tsx` today and creating one is Step 11's
  neighbour, not this step's job.
- Skills: `react-best-practices`
- Verify: `cd client && pnpm test && pnpm typecheck && pnpm lint`

### Step 13 - Stop rendering the blast impact summary

- Files:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx:13,47,172-177`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx:334-363`
- Does: removes the `SummaryBlock` import, the `useBlastSummary(prId)` call and the
  `<SummaryBlock/>` render, so the Overview tab carries no impact-summary heading
  (AC-32). Removes the now-dead `describe("BlastRadiusCard summary", ...)` block and
  the `useBlastSummary` hoisted mock at `BlastRadiusCard.test.tsx:17,24`.
- Does not: delete `SummaryBlock.tsx` (kept in the tree, unrendered); delete any
  `summary.*` key from `messages/en/blast.json:51-60`; delete `useBlastSummary`
  from `lib/hooks/blast.ts:43-49`; touch `IndexNotice.tsx`, the caller/symbol
  truncation counts, or the default-branch and per-file attribution caveats - those
  four index-honesty affordances must render exactly as before (AC-27 through
  AC-31), and the existing assertions in `BlastRadiusCard.test.tsx` outside the
  summary block are the regression guard.
- Skills: `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test && pnpm typecheck && pnpm lint`

### Step 14 - `file` URL param: open the Files changed tab with that file expanded

- Files: `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:89,205-220`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:14-25`,
  `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:14-32`,
  `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx:69-71`,
  `client/src/components/diff-viewer/FileCard/FileCard.tsx:59-61,78-84`
- Does: adds `const focusFile = search.get('file')` beside the shipped
  `focusFindingId` at `page.tsx:89` and threads it as an OPTIONAL `focusFile?: string
  | null` prop down to `FileCard`, where it forces `defaultOpen` for the matching
  path and scrolls it into view on mount using the technique already at
  `FileCard.tsx:78-84` (`jumpToFirstFinding`). This mirrors the shipped
  `tab`/`finding` cross-tab jump at `page.tsx:217-219`, including `scroll: false`.
  Optional props with the old default preserved, so every existing call site keeps
  compiling and rendering identically (`client/INSIGHTS.md:104-112`). Add the
  matching assertion to whichever diff-viewer test file exists, or a new colocated
  one (AC-38).
- Does not: change `AUTO_EXPAND_MAX_LINES`; change `SmartDiffViewer`'s existing
  `defaultOpen` heuristic for files that are not the focused one; fork `FileCard`.
- Skills: `react-best-practices`, `next-best-practices`
- Verify: `cd client && pnpm test && pnpm typecheck && pnpm lint`, then `./scripts/e2e.sh`

## Test strategy

- **New hermetic server tests** (Step 4, 5): `candidates.test.ts`, `ground.test.ts`,
  `history.test.ts`, `prompt.test.ts`, colocated in `modules/brief/` following L06's
  layout. These carry the whole grounding derivation table - every AC-13 through
  AC-19 case, plus AC-6/7/8/9/10 asserted against the assembled prompt string.
- **One new DB-backed file**: `server/src/modules/brief/brief.it.test.ts`. It is
  DB-backed, so the `*.it.test.ts` suffix is mandatory (`server/AGENTS.md:45`).
- **Existing suites that must stay green unchanged**: `server/test/blast*.test.ts`,
  `server/test/blast.it.test.ts`, `server/test/prompt-log.test.ts` (the `call` union
  widened), `server/test/contracts.test.ts`, `client` `BlastRadiusCard.test.tsx`
  minus its deleted summary block, `toMermaid.test.tsx`.
- **New client tests**: `PrBriefCard.test.tsx` (Step 11) and one diff-viewer
  assertion for the `file` param (Step 14).
- **AC-16 is proven twice**: structurally, by `BlastCaller.line` never entering
  `candidates.ts` or `ground.ts` as a parameter; and by a `ground.test.ts` fixture
  whose blast result carries a caller at a line outside the file's `@@` ranges and
  whose model output names that line - the entry must survive at file level with
  `line === null`.
- **AC-22 is proven at the prompt, not at the output.** Grading model prose is not
  a deterministic test. `prompt.test.ts` asserts the brief's system prompt states
  the same never-claim-a-defect constraint as `blast/prompt.ts:36`. A live grading
  pass against seeded `acme/payments-api` PR #482 is a MANUAL check, at no tier,
  for the same reason `run_agent_on_pr` is (`TESTING.md:70-74`).
- **AC-50 cannot be observed in any automated lane.** `app.ts:105` skips registering
  `@fastify/rate-limit` entirely when `NODE_ENV === 'test'`, which makes the
  per-route `config.rateLimit` inert. Verified by inspection that the route config
  matches `blast/routes.ts:43`.

## Non-functional requirements

- Prompt assembly ceiling 20,000 tokens, measured with `container.tokenizer` - Step 5.
- Model timeout 30,000 ms; at most 2 schema repairs (3 attempts); exactly 1 model
  call per generation; no retry wrapper - Step 7.
- Rate limit 10/min on `POST`, none beyond the global 120/min on `GET` - Step 7.
- Prose <= 3 sentences and <= 400 characters persisted per field - Step 4 (schema) and
  Step 7 (clamp).
- Caps: 8 review-focus entries, 10 risks, 5 prior PRs, 20 brief-history entries -
  Step 4 constants, applied after grounding.
- Degraded index: 0 model calls, 0 cost - Step 7 gate 4.
- Cost visibility: provider-reported `tokensIn`/`tokensOut`/`costUsd` only; a locally
  measured token count is never presented as spend - Step 7 step 9.
- i18n: every user-facing string through next-intl's existing `brief` namespace -
  Step 10.
- Accessibility: every risk link and review-focus entry Tab-reachable with a visible
  focus indicator; risk level and severity distinguishable without colour - Step 11.
- Migration cost: `pr_brief` is empty in every deployment (zero runtime consumers
  today), so the additive `ALTER` and the new table are effectively free - Step 2.
- Security: the untrusted-wrapper + `DATA_GUARD` requirement is carried by Step 5
  and the SSRF boundary by Step 7's fact gathering. One suspicion for
  `/security-review`: `pr_brief.trace` persists the full prompt including
  third-party repository text, exactly as `pr_intent.trace` already does - confirm
  it stays DB-only and never reaches a log line.

## Stop conditions

- If any step would need a new entry in `server/.dependency-cruiser.cjs`'s rules or
  an allowlist, stop. AC-54 forbids it and the config carries no allowlist today.
- If `pnpm db:generate` turns interactive or hangs, stop and re-check that the
  `pr_brief` edit is purely additive. Never pipe stdin into it.
- If `contracts/brief.ts` or `contracts/blast.ts` would need an edit to make the new
  contract compile, stop - AC-53 makes the first byte-identical, and a change to the
  second would force both vendor copies to move for no product gain.
- If `IntentService.renderBlock(prIntent)` turns out not to produce a usable intent
  block for the prompt, stop rather than importing `intent/helpers.ts` - that import
  fails `arch:check` and no AC names `toBriefIntent()`.
- If a test needs a real provider key or a real GitHub token to pass, stop. Pass
  `secrets: new MockSecretsProvider({})` plus an explicit `overrides.llm` entry.
- If deleting `SummaryBlock.tsx`, `useBlastSummary`, the `blast.json` `summary.*`
  keys, `POST /pulls/:id/blast/summary`, or the `pr_blast_summary` table looks
  necessary to make something compile, stop. The spec's disposition table keeps all
  six.

## Acceptance criteria

- [ ] Both copies of `contracts/pr-brief.ts` are byte-identical, and the barrel line
      is present in both - verify: `diff -q server/src/vendor/shared/contracts/pr-brief.ts client/src/vendor/shared/contracts/pr-brief.ts`
- [ ] `contracts/brief.ts` is unchanged in both copies - verify: `git diff --stat -- '*vendor/shared/contracts/brief.ts'` is empty
- [ ] Exactly one `0019_*.sql` was generated, it only ADDs to `pr_brief` and CREATEs
      `pr_brief_history`, and it applies - verify: `cd server && pnpm db:migrate`
- [ ] Layering holds with no new rule and no allowlist entry - verify: `cd server && pnpm arch:check`
- [ ] Server unit lane green, including the new grounding, candidate, prompt and
      history tests - verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- [ ] `brief.it.test.ts` green and actually RAN (read the per-file line, not the exit
      code) - verify: `cd server && pnpm exec vitest run .it.test --no-file-parallelism`
- [ ] Both packages typecheck - verify: `cd server && pnpm typecheck` and `cd client && pnpm typecheck`
- [ ] Client suite green, including `PrBriefCard.test.tsx` and the surviving
      `BlastRadiusCard.test.tsx` assertions - verify: `cd client && pnpm test`
- [ ] Client boundaries and hooks rules hold - verify: `cd client && pnpm lint`
- [ ] The Overview tab renders one paragraph of generated prose and one risk list;
      the partial-index notice, the two truncation counts and the two blast caveats
      still render - verify: `./scripts/e2e.sh`, then a manual pass on seeded
      `acme/payments-api` PR #482
- [ ] `.claude/repo-facts.md` lists the `brief` module and `contracts/pr-brief.ts` -
      verify: `git diff .claude/repo-facts.md`
- [ ] AC-22 manual grading pass recorded: the stored `what` and `why` for PR #482
      describe reach and purpose and claim no defect - verify: manual read of
      `GET /pulls/:id/brief`

## Deliberately out of scope

- Deleting `POST /pulls/:id/blast/summary`, `pr_blast_summary`, `SummaryBlock.tsx`,
  or the `blast.json` `summary.*` keys - a follow-up once the brief is observed to
  replace the summary in practice (spec Open question 1).
- A design pass on the brief-history section (no mockup exists - spec design review,
  status `open`).
- The graph view, the PR score ring, the verdict banner, and relocating the verdict
  banner into a PR BRIEF frame.
- Per-commit backfill of the brief history.
- Security review of the persisted-prompt path -> `/security-review`.
- Layering and boundary judgement over the finished diff -> `architecture-reviewer`
  after `arch-evidence`.
