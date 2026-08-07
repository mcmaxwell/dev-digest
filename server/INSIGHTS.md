# Insights — server

Append-only lessons specific to this package (including `src/modules/repo-intel`),
kept in fixed sections — append into the matching one, never rewrite old
entries. Cross-cutting lessons go to the root INSIGHTS.md. Format and quality
gates: `.claude/skills/engineering-insights/SKILL.md`.

## What Works

- [2026-07-31] Give a repository a `transaction(fn)` method and let write
  helpers take an optional `DbOrTx` (`src/db/client.ts`) defaulting to `this.db`.
  The SERVICE picks the boundary, every existing single-write call site keeps
  compiling unchanged, and joining a transaction is one extra argument — see
  `run-executor.ts` persisting review + findings + markReviewed +
  completeAgentRun as one unit.
- [2026-08-02] For any candidate an LLM proposes about the repo, make the
  UPSERT KEY a normalized form of the claim (`conventions.rule_key` =
  sorted content tokens of the rule, unique per repo) and never recompute it
  when the USER edits the text. The key is the claim's identity across scans;
  recomputing it on edit makes the next scan fail to recognise the rule it
  already proposed, so the model's original phrasing reappears as a second
  pending card beside the user's edited one. With a stable key the upsert
  refreshes evidence/scores while `status` and the edited wording survive —
  which is what makes a re-scan non-destructive
  (`modules/conventions/{service,repository}.ts`, regression-tested in
  `test/conventions.it.test.ts` "an edit must not fork the card").
- [2026-08-02] To grade an LLM claim about a codebase, have the model emit a
  MACHINE-CHECKABLE probe alongside the claim (`{positive, negative}` regexes)
  and run both through `container.codeIndex.grep`: `adherence = pos/(pos+neg)`
  turns "the model believes this" into "the repo does this 94% of the time".
  Verified evidence only proves the pattern EXISTS; counting violations is what
  proves it is the rule (`modules/conventions/adherence.ts`). Treat a
  failed/timed-out probe as UNMEASURED (cap confidence), never as a violation —
  deleting the candidate would turn an infra hiccup into a lost finding.
- [2026-07-31] When adding a FK to a column that never had one, ship a
  `drizzle-kit generate --custom` migration BEFORE the generated one to heal
  dangling rows (`0011_heal_dangling_review_refs.sql`). Postgres validates
  existing rows when the constraint is added, so any developer database with an
  orphaned reference would fail `db:migrate` — and hand-editing the generated
  file is forbidden.

- [2026-08-04] Any MODEL-AUTHORED string that reaches a spawned process must be
  screened for a leading `-` AND passed after `-e` / `--`, not just validated as
  well-formed. A conventions probe of `--pre=sh` is a legal regex that
  `isSafeProbePattern` accepted, and `spawn(rg, [...flags, pattern, root])`
  parsed it as ripgrep's `--pre` flag — which runs a command per searched file.
  Fixed in both places (`modules/conventions/adherence.ts` rejects a leading
  dash; `adapters/codeindex/ripgrep.ts` uses `-e pattern -- root`). Reachable
  end-to-end because sampled repo text can prompt-inject the probe.

- [2026-08-04] A background job whose ceiling is BELOW its honest worst case
  fails in the worst possible way: `withTimeout` only rejects the awaited
  promise, it cannot cancel the work, so the job row goes `failed` while the
  pipeline keeps running and whatever row it opened stays open. Conventions
  needs ~450s (selection + 2 retryable batches) against JobRunner's 120s
  default; a real repo measured 111s, i.e. it kept tripping a limit it sat just
  under. Budget per kind at `jobs.register(kind, handler, {timeoutMs})` from the
  module's own constants, and pair it with a boot reaper — ANY table with a
  `running` status needs one (see `reapStaleScans` / `reapStaleRunningRuns`),
  because a `running` row that also acts as a uniqueness guard turns one crash
  into a permanently disabled feature.

## What Doesn't Work

- [2026-08-02] Don't poll `agent_runs.status == 'done'` and then immediately read
  `run_traces` in a test: the status flips INSIDE the persistence transaction in
  `run-executor.ts` while `saveRunTrace` runs just after it, so the trace read can
  race and return 404/empty. Poll for the trace document itself (see
  `test/skills.it.test.ts`).
- [2026-07-28] Rolling up PR-list aggregates from only the LATEST review
  diverges from the detail page, which flattens findings across ALL review
  runs (multi-agent: the newest run can be clean while others hold findings)
  — users read this as "list shows 0 but inside I have several". List rollups
  must use the same population as the detail view
  (`src/modules/pulls/routes.ts` findings breakdown).
  - [2026-07-28] Same divergence existed for the SCORE ring; fixed via
    `worstLatestScoreByPr` (`src/modules/pulls/status.ts`) — worst score among
    each agent's latest review, unit-tested in `test/pulls-status.test.ts`.

## Codebase Patterns

- [2026-07-28] `rollupSeverities` in `src/modules/pulls/status.ts` is the
  canonical per-severity findings rollup — reuse it (the reviews module imports
  it in `repository/run.repo.ts`) instead of re-counting severities; its
  `SeverityCounts` type lives in `@devdigest/shared` `contracts/findings.ts`,
  not in status.ts.
  - [2026-07-31] MOVED to `src/modules/_shared/severity.ts`. Two modules need it
    (pulls + reviews) and `no-cross-module-imports` in `.dependency-cruiser.cjs`
    now rejects reaching into another module's folder for it.
- [2026-07-28] Runs link to reviews only via `reviews.run_id` (no FK), and
  `reviews.kind` can be `'summary'` — any run↔findings aggregation must filter
  `kind = 'review'` and `run_id IS NOT NULL`, else summary rows skew counts.
  - [2026-07-31] The FK now EXISTS: `reviews.run_id` → `agent_runs.id`
    `ON DELETE cascade` and `reviews.agent_id` → `agents.id` `ON DELETE set null`
    (migration 0012). `deleteAgentRun` is therefore a single DELETE — do not
    re-add the manual "delete reviews first" compensation. The `kind`/`run_id`
    filtering above still applies to aggregations.
- [2026-07-31] Services are constructed as `new XService({ db } as unknown as
  Container)` in tests (`test/agents-versions.it.test.ts:167`), so a service
  MUST build its own repository from `container.db` rather than reading a
  container getter — switching to `container.agentsRepo` compiles fine and then
  fails at runtime with "Cannot read properties of undefined". Container
  repository getters exist for CROSS-module access only.

## Tool & Library Notes

- [2026-08-02] Drizzle `text('col', { enum: [...] })` is TypeScript-only — the DB
  has no CHECK constraint, so widening the enum (e.g. adding a `skills.source`
  value) needs contract + schema edits but NO migration; `pnpm db:generate`
  confirms with "No schema changes".
- [2026-08-02] `@fastify/multipart` can be registered INSIDE one module's routes
  plugin (`modules/skills/routes.ts`) — encapsulation keeps every other module
  JSON-only, and the global plugins (helmet/cors/…) registered before modules
  still apply. No need to touch `app.ts` for a single upload route.
- [2026-07-28] Drizzle's `sum()` returns a STRING (SQL numeric), not a number —
  wrap in `Number(...)` before putting it in a JSON response, or Zod
  `z.number()` contracts reject it (see the `total_cost_usd` aggregate in
  `src/modules/pulls/routes.ts`).

- [2026-07-31] `pnpm arch:check` (dependency-cruiser) crashes with a missing
  `styleText` export under old Node — it needs Node ≥ 22. If it fails right
  after a shell start, check `node -v` before suspecting the config.

- [2026-07-31] dependency-cruiser supports `$1` back-references from a capture
  group in `from.path` inside `to.pathNot` — that is what makes the
  "module A must not import module B" rule expressible in one rule
  (`no-cross-module-imports`). Unknown keys on a rule fail with an unhelpful
  "must NOT have additional properties"; `dependencyTypesNot: ['type-only']`
  IS valid and is how cross-module `import type` stays allowed.

- [2026-07-31] reviewer-core is an **npm** package (`package-lock.json`, CI runs
  `npm ci`) while server/client use pnpm. Running `pnpm install` there creates a
  stray `pnpm-lock.yaml` and a pnpm-shaped `node_modules` that break `npm ci` —
  always use `npm` in `reviewer-core/`.

- [2026-08-02] `drizzle-kit generate` turns INTERACTIVE ("is X created or renamed
  from another column?") whenever one table both gains and drops columns in the
  same diff, and it hangs forever with a piped stdin (`yes '' | pnpm db:generate`
  never returns). Split the schema edit into two passes — keep the doomed columns
  while adding the new ones (`generate` → additions only, non-interactive), then
  delete them (`generate` → deletions only, non-interactive). Two migrations, no
  TTY needed, and it works in CI. See `0013_yielding_johnny_blaze` +
  `0014_square_agent_zero`.
- [2026-08-02] `MockGitClient.readFile` resolves a MISSING path to `''` instead of
  rejecting (`src/adapters/mocks.ts`), so any "read these optional files" sampler
  must treat blank content as absent or it fills its budget with empty slices.
  Guard with `raw && raw.trim().length > 0`, not `raw !== null`.

## Recurring Errors & Fixes

- [2026-08-02] `pnpm exec vitest run .it.test` failing en masse with
  `No space left on device` / `Health check failed: unhealthy` is the DOCKER VM
  disk, not the code — each `*.it.test.ts` file starts its own Postgres via
  testcontainers and 8 at once exhausts it. Re-run with
  `--no-file-parallelism` (one container at a time) before debugging anything.
  Check with `docker run --rm alpine df -h /`. NOTE: `docker volume prune -f`
  only frees the anonymous testcontainers volumes and leaves `devdigest_pgdata`
  alone WHILE the dev Postgres container is running — if the dev stack is
  stopped, that volume is dangling and prune deletes it with every imported repo
  and review. Verify with `docker volume ls --filter name=devdigest` first.

## Session Notes

## Open Questions
