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

- [2026-08-05] Any API that RETURNS a promise for optional awaiting (JobRunner
  `enqueue()`'s `EnqueuedJob.done`, which rethrows so tests can await the
  failure) must mark it handled at creation — `done.catch(() => {})` before
  returning; awaiting callers still observe the rejection. Every production
  enqueue is fire-and-forget, and in Node ≥ 15 one exhausted-retries job
  failure (a 403 `git clone`) became an unhandled rejection that killed the
  whole API mid-flight. Regression: `test/jobs.test.ts` asserts zero
  `unhandledRejection` events around `onIdle()` while `done` still rejects.

- [2026-08-07] When a schema change would BOTH add and rename a column, rename
  the DRIZZLE PROPERTY and leave the SQL column name alone — `text('intent')`
  exposed as `summary` in `db/schema/reviews.ts`. `drizzle-kit generate` then
  sees a pure ADD COLUMN diff and stays non-interactive (`0015_warm_barracuda`),
  which is the only way it works in CI. The property name is what every call
  site reads, so nothing is lost; the column name only ever appears in the
  migration. Cheaper than the two-pass split noted below, and it works when the
  two-pass trick cannot (a rename is not an add-then-drop you can sequence).

<<<<<<< HEAD
- [2026-08-10] When a read must NOT fall into a facade's expensive fallback
  branch, gate it at the CALLER on a separate, honest health read - do not rely
  on the branch not being reached. `RepoIntelService.getBlastRadius` degrades to
  reading the clone and shelling out to ripgrep, which is fine as a fallback and
  unacceptable on an HTTP request path, so `BlastService.load` reads
  `getIndexHealth` first and returns an empty envelope before calling it
  (`modules/blast/service.ts`). The guarantee is then structural, and
  `blast.it.test.ts` proves it with a spy on `container.codeIndex` rather than
  by asserting a shape.
=======
- [2026-08-13] To count "distinct enabled agents that reach X, directly OR
  through an enabled linked skill" in ONE query, `union()` the two reach paths
  as `(agent_id, path)` pairs and group the result — `UNION` (not `UNION ALL`)
  dedupes the pairs, so a plain `count()` already means "count distinct agents".
  Drizzle 0.38 supports `union(a, b).as('reach')` as a subquery you can
  `.select().from()` — smoke-tested with `pnpm exec tsx` against the dev DB
  before writing the test, which is much faster than discovering it in a
  testcontainers run (`modules/project-context/repository.ts::usageCounts`).
>>>>>>> fd9de1b (feat(project-context): L05 project documents end to end)

- [2026-08-13] To prove a `jobs.register(kind, h, { retries: 0 })` is
  load-bearing without editing the code under test, register a THROWAWAY kind
  on the same runner inside the test, throw the same error from it, and assert
  it ran more than once — then assert the real kind's side effect (the model
  call) happened exactly once. Without that control the "exactly one call"
  assertion is vacuous, because `withRetry`'s default `isRetryable` only
  retries 429/5xx/network shapes: a plain `new Error('boom')` from the
  handler's persistence tail is NOT retried, so the post-call throw a
  regression test injects must carry `{ status: 503 }` (or an `ECONNRESET`
  code) or it tests nothing. Injecting the throw itself is a `Proxy` over the
  drizzle `db` that intercepts `insert` for one table
  (`modules/onboarding/onboarding.it.test.ts`, "keeps ONE model call when the
  handler throws AFTER the call succeeded").

- [2026-08-13] A mock LLM provider that HANGS to hold a single-flight slot open
  must expose a "the call has reached the gate" promise, and the test must
  await it before releasing. Releasing early is a no-op (the resolver does not
  exist yet), the generation then sits in `withTimeout(..., MODEL_TIMEOUT_MS)`
  and the test still goes green — after 90 REAL seconds, via the degraded
  `model_failed` path rather than the success path it meant to assert. The tell
  is a per-test duration of ~90,000 ms in the vitest output; read those
  durations, they are the only symptom.

## What Doesn't Work

- [2026-08-13] Do NOT trust `server/CLAUDE.md`'s claim that "the DB schema
  already contains EVERY table for all course lessons" as a reason to skip
  checking. It is false for at least L05 project context: `src/db/schema*.ts`
  has no table for project documents and none for agent→document or
  skill→document attachments. The nearest thing, `code_chunks`
  (`source: 'code' | 'docs' | 'spec'` + a 1536-dim `embedding`), is repo-intel's
  indexing table and is NOT an attachment store. ALWAYS grep `src/db/schema*.ts`
  for the lesson's nouns before planning; the "empty tables sit there by design"
  rule tells you not to DELETE unused tables, not that every table you need
  exists.
- [2026-08-10] `repo_index_state.stats` UNDER-REPORTS the T3 artifacts: the
  incremental pipeline (`pipeline/incremental.ts`) rebuilds `file_rank` and
  `file_facts` but only records `edgesWritten` in its stats blob, so anything
  deriving "is this repo ranked?" from `stats.ranked` reads 0 after every
  "Re-analyze" on a perfectly ranked repo. Count the rows instead
  (`RepoIntelRepository.countIndexArtifacts` - three indexed counts over
  ≤ MAX_INDEXED_FILES rows). Same trap applies to any future consumer of
  `stats.factsWritten`.

- [2026-08-07] An integration test that passes `llm: {}` (or omits a provider
  from `overrides.llm`) is NOT hermetic: `Container.buildLlm` falls back to
  `LocalSecretsProvider(~/.devdigest/secrets.json)`, so on any developer machine
  with a real key it builds a REAL provider and makes billable network calls.
  This is invisible until a feature resolves a provider the test did not mock —
  L03 wiring the intent classifier (`review_intent` → openrouter) into the review
  path turned `reviews.it.test.ts` and `skills.it.test.ts` red with 10s timeouts
  and no error message. ALWAYS pass `secrets: new MockSecretsProvider({})` in
  `buildApp` overrides for a test that must not spend money. Proof technique:
  `mv ~/.devdigest/secrets.json` aside and re-run — if it goes green, the test
  was reading the developer's keys. `test/conventions.it.test.ts`'s "every LLM
  call fails" case still has this bug at the time of writing.

- [2026-08-02] Don't poll `agent_runs.status == 'done'` and then immediately read
  `run_traces` in a test: the status flips INSIDE the persistence transaction in
  `run-executor.ts` while `saveRunTrace` runs just after it, so the trace read can
  race and return 404/empty. Poll for the trace document itself (see
  `test/skills.it.test.ts`).
  - [2026-08-13] This race is INVISIBLE when the file runs alone and fires in
    the full `--no-file-parallelism` lane, where the machine is busier: the new
    AC-4 case in `modules/onboarding/onboarding.it.test.ts` passed on its own
    and failed the lane with `JSON.stringify(trace.prompt_assembly)` →
    `undefined` and the unhelpful chai message "the given combination of
    arguments (undefined and string) is invalid for this assertion". So a
    single-file green run is NOT evidence the read is safe — the loop over
    `GET /runs/:id/trace` until `prompt_assembly` exists is mandatory, not
    defensive.
- [2026-07-28] Rolling up PR-list aggregates from only the LATEST review
  diverges from the detail page, which flattens findings across ALL review
  runs (multi-agent: the newest run can be clean while others hold findings)
  — users read this as "list shows 0 but inside I have several". List rollups
  must use the same population as the detail view
  (`src/modules/pulls/routes.ts` findings breakdown).
  - [2026-07-28] Same divergence existed for the SCORE ring; fixed via
    `worstLatestScoreByPr` (`src/modules/pulls/status.ts`) — worst score among
    each agent's latest review, unit-tested in `test/pulls-status.test.ts`.

- [2026-08-13] `pnpm exec vitest run .it.test --no-file-parallelism` SKIPS whole
  files at random under load: every `*.it.test.ts` opens with
  `const hasDocker = await dockerAvailable()` at module scope, and that probe
  returns false when the Docker socket is busy starting another container — the
  file then reports "N skipped" with a `[name] Docker not available` warning and
  the lane still exits 0. A green integration run is NOT evidence a file ran;
  read the per-file lines. Re-run the skipped files individually to confirm
  (this run silently skipped `context.it.test.ts`, `reviews.it.test.ts` and
  `skills-versions.it.test.ts`).

- [2026-08-13] Do NOT use `vitest -t '<name>'` to prove a new integration test
  really fails without its trigger. An `*.it.test.ts` file is ONE Postgres
  container and one fixture whose state earlier tests build up, so `-t` skips
  the siblings and the test fails for the wrong reason — removing
  `git.unreadable.add(...)` from the new read-failure test in
  `src/modules/project-context/context.it.test.ts` gave "expected 404 to be 500"
  under `-t` (no scan had ever run, so the doc row did not exist) versus the
  real "expected 200 to be 500" when the whole file ran. Always run the WHOLE
  file for a deliberate-failure check, and read the expected-vs-received values,
  not just the red.

## Codebase Patterns

- [2026-08-13] `JobRunner.enqueue` wraps EVERY handler in
  `withRetry(..., { retries: this.retries })` and `container.ts` constructs the
  runner with the default of 2 — so a handler that spends money is re-run up to
  three times per click, and the retry re-issues the LLM call even when the
  throw happened AFTER the call succeeded (a `repo.upsert` blip, any bug in the
  persistence tail). `register(kind, handler, { timeoutMs })` had no way to say
  otherwise; it now takes `retries` too, and any billable, non-idempotent kind
  must register with `retries: 0` and let the USER retry deliberately
  (`modules/onboarding/service.ts::registerGenerateJobHandler`). Banning
  `withRetry` around the model call in the service is only half the fix — the
  queue re-creates the same anti-pattern one layer up, invisibly.

- [2026-08-13] An acceptance criterion of the form "the rows are in
  `getTopFilesByRank` order" or "every entry appears in `getCriticalPaths`
  output" CANNOT be satisfied by verifying model output afterwards: those are
  membership and ORDERING properties, and a post-hoc check can only ever test
  existence. Build the rows from the candidate set instead (pass the set into
  the prompt, then drop any row outside it in verification) — then ordering is
  true by construction and the verifier only has to catch prose paths, links and
  cited sources. `modules/onboarding/{candidates,verify}.ts` is the shape.

- [2026-08-13] A "collected facts" struct must carry the PATHS of the files it
  read, not their content. `.env.example` is on every sensible fact-file list
  and routinely holds a real key someone forgot to blank, so a struct that keeps
  raw content is one careless `logger.info(facts)` or one new prompt block away
  from leaking it — and nothing downstream needs it, because every consumer
  wants a DERIVED field (`envKeys`, `scripts`, `stack`) anyway. Caught by
  asserting `JSON.stringify(facts)` contains no value from the example env file
  (`modules/onboarding/facts.ts::extractFacts`,
  `DeterministicFacts.present: string[]`).

- [2026-08-07] A module that only JOINS other modules' data needs no
  `repository.ts` at all. `modules/smart-diff` reads everything through
  `container.reviewRepo` (`getPull` / `getPrFiles` / `reviewsForPull`), so it
  never imports the drizzle query builder and both
  `queries-live-in-repositories` and `no-cross-module-imports` hold with zero
  allowlist entries. Reach for a repository when a module OWNS a table; a
  read-only composition over existing tables is a service plus a pure function.
  Keep the pure part in its own file (`classify.ts` — no I/O, no Container) so
  the rules are testable as a table without Postgres, and put every pattern and
  threshold in `constants.ts` so they can be read without reading the algorithm.
- [2026-07-28] AGGREGATING REVIEWS, RUNS AND FINDINGS — four rules with one root
  cause: a PR has many reviews, they link to runs by id rather than by ordering,
  and not every review row carries findings. Break any of them and the count
  comes out silently LOW; none of them fails as an error.
  [2026-08-11: consolidated from four separate entries, wording unchanged.]
  - [2026-07-28] Runs link to reviews only via `reviews.run_id` (no FK), and
    `reviews.kind` can be `'summary'` — any run↔findings aggregation must filter
    `kind = 'review'` and `run_id IS NOT NULL`, else summary rows skew counts.
    - [2026-07-31] The FK now EXISTS: `reviews.run_id` → `agent_runs.id`
      `ON DELETE cascade` and `reviews.agent_id` → `agents.id` `ON DELETE set null`
      (migration 0012). `deleteAgentRun` is therefore a single DELETE — do not
      re-add the manual "delete reviews first" compensation. The `kind`/`run_id`
      filtering above still applies to aggregations.
  - [2026-08-07] "The latest review of a PR" is NOT `reviewsForPull(prId)[0]`.
    Group by `run_id` instead: take the newest `kind = 'review'` row, then keep
    every review sharing its `run_id` (falling back to that single row when
    `run_id` is null — the seeded review and any pre-run-tracking row). Taking
    only the newest row silently drops all but one agent's findings the moment
    multi-agent runs land (L07), and the bug is invisible until then. See
    `modules/smart-diff/service.ts::latestReviewFindings`.
  - [2026-07-28] `rollupSeverities` is the canonical per-severity findings
    rollup — reuse it instead of re-counting severities; its `SeverityCounts`
    type lives in `@devdigest/shared` `contracts/findings.ts`, not beside it.
    - [2026-07-31] MOVED from `src/modules/pulls/status.ts` to
      `src/modules/_shared/severity.ts`. Two modules need it (pulls + reviews)
      and `no-cross-module-imports` in `.dependency-cruiser.cjs` now rejects
      reaching into another module's folder for it.
- [2026-08-07] Prompt observability splits by DESTINATION, not by verbosity:
  logs get metadata (`platform/prompt-log.ts` — section, source, chars, tokens,
  `sha8`, model, correlation id), the DB gets content (`run_traces.trace`,
  `pr_intent.trace`). A "log level" that decides whether to print a prompt is
  the wrong axis — content in a log aggregator is permanent and unscoped, and
  no level of a setting should be able to put it there. The function takes text
  and returns only measurements of it, so the guarantee is structural.
  The `sha8` fingerprint is what makes metadata actionable without content:
  matching per-section hashes across two runs prove the prompts were
  byte-identical, so a behaviour change came from the model, not from assembly.
  `PROMPT_LOG=verbose` adds structural outline only (headings and
  `<untrusted source="…">` tags) and is refused when `NODE_ENV=production`.
- [2026-07-31] Services are constructed as `new XService({ db } as unknown as
  Container)` in tests (`test/agents-versions.it.test.ts:167`), so a service
  MUST build its own repository from `container.db` rather than reading a
  container getter — switching to `container.agentsRepo` compiles fine and then
  fails at runtime with "Cannot read properties of undefined". Container
  repository getters exist for CROSS-module access only.
  - [2026-08-05] Corollary: a service method MAY use container getters for a
    cross-module read (`SkillsService.stats` → `agentsRepo`/`reviewRepo`), but
    then that METHOD needs a real Container — keep such methods isolated so
    bare-`{ db }` construction still covers the module's own CRUD, and test
    them through `buildApp` + `app.inject` (`test/skills-versions.it.test.ts`).
- [2026-08-05] Version rollback = restore-as-new-version THROUGH the normal
  update path (`SkillsService.rollback` re-saves the old snapshot's body via
  `repo.update`), never a rewrite of the versions table: the existing
  `bodyChanged` logic yields version+1 plus the snapshot for free, and
  restoring the CURRENT body is automatically a no-op. Apply the same shape to
  any future agent-version rollback.
- [2026-08-05] Per-skill usage stats cannot be attributed per run —
  `run_traces` stores the RENDERED skills prompt string + token count, not
  skill ids — so `GET /skills/:id/stats` attributes transitively:
  `agent_skills` → those agents' `agent_runs` + review findings
  (`statsForAgents` in `reviews/repository/run.repo.ts`, which must keep the
  `kind='review'` / `run_id IS NOT NULL` filter). Exact per-run attribution
  would require recording linked skill ids on the run itself
  (`agent_versions.configJson.skills` already pins them per config version).

- [2026-08-07] A table whose rows are keyed by a PR/repo id but which carries NO
  `workspace_id` column (`pr_intent`) gets its tenancy from the layer above:
  `IntentService` resolves the PR via `container.reviewRepo.getPull(workspaceId,
  prId)` and 404s BEFORE calling its own repository. Say so in the repository's
  doc comment — otherwise the next reader sees unscoped `where(eq(prId))` queries
  and either "fixes" them or copies the pattern into a table that does need
  scoping.
- [2026-08-07] When a feature's output is fed to a model AND rendered to a user,
  make the LLM structured-output schema the SHARED contract itself
  (`modules/intent/schemas.ts` re-exports `IntentClassification` from
  `vendor/shared`) rather than a module-local mirror. Conventions needed a
  separate extraction schema because what the model returns is not what is
  persisted; intent persists exactly what it receives, so a second definition
  could only drift.

## Tool & Library Notes

- [2026-08-10] For a window function, build the subquery with Drizzle's QUERY
  BUILDER and `.as('alias')`, then select from it - do NOT drop to a
  raw `sql` template. `getResolvedCallersTopN` needs
  `row_number() OVER (PARTITION BY to_symbol …)` filtered by two text arrays;
  the raw-SQL version would need `= ANY($n)` with a JS array bound through
  postgres-js, whose array inference is the risky part. With the builder,
  `inArray()` expands to `in ($1,$2,…)` exactly as everywhere else in this repo,
  and only the `row_number()` expression is raw. The `.as()` subquery's columns
  are then addressable (`ranked.rn`) for the outer `where`.

- [2026-07-28] DRIZZLE AND DRIZZLE-KIT — three quirks that each cost a debugging
  session. [2026-08-11: consolidated from three separate entries, wording
  unchanged.]
  - [2026-08-02] `text('col', { enum: [...] })` is TypeScript-only — the DB has
    no CHECK constraint, so widening the enum (e.g. adding a `skills.source`
    value) needs contract + schema edits but NO migration; `pnpm db:generate`
    confirms with "No schema changes".
  - [2026-07-28] `sum()` returns a STRING (SQL numeric), not a number — wrap in
    `Number(...)` before putting it in a JSON response, or Zod `z.number()`
    contracts reject it (see the `total_cost_usd` aggregate in
    `src/modules/pulls/routes.ts`).
  - [2026-08-02] `drizzle-kit generate` turns INTERACTIVE ("is X created or
    renamed from another column?") whenever one table both gains and drops
    columns in the same diff, and it hangs forever with a piped stdin
    (`yes '' | pnpm db:generate` never returns). Split the schema edit into two
    passes — keep the doomed columns while adding the new ones (`generate` →
    additions only, non-interactive), then delete them (`generate` → deletions
    only, non-interactive). Two migrations, no TTY needed, and it works in CI.
    See `0013_yielding_johnny_blaze` + `0014_square_agent_zero`. The cheaper
    escape when the change is a RENAME is in What Works (2026-08-07): rename the
    drizzle PROPERTY and leave the SQL column name alone.
- [2026-08-02] `@fastify/multipart` can be registered INSIDE one module's routes
  plugin (`modules/skills/routes.ts`) — encapsulation keeps every other module
  JSON-only, and the global plugins (helmet/cors/…) registered before modules
  still apply. No need to touch `app.ts` for a single upload route.
- [2026-07-31] DEPENDENCY-CRUISER — the runtime requirement and the one rule
  feature that is not obvious. [2026-08-11: consolidated from two separate
  entries, wording unchanged.]
  - [2026-07-31] `pnpm arch:check` crashes with a missing `styleText` export
    under old Node — it needs Node ≥ 22. If it fails right after a shell start,
    check `node -v` before suspecting the config.
  - [2026-07-31] It supports `$1` back-references from a capture group in
    `from.path` inside `to.pathNot` — that is what makes the "module A must not
    import module B" rule expressible in one rule (`no-cross-module-imports`).
    Unknown keys on a rule fail with an unhelpful "must NOT have additional
    properties"; `dependencyTypesNot: ['type-only']` IS valid and is how
    cross-module `import type` stays allowed.

- [2026-07-31] reviewer-core is an **npm** package (`package-lock.json`, CI runs
  `npm ci`) while server/client use pnpm. Running `pnpm install` there creates a
  stray `pnpm-lock.yaml` and a pnpm-shaped `node_modules` that break `npm ci` —
  always use `npm` in `reviewer-core/`.

- [2026-08-02] `MockGitClient.readFile` resolves a MISSING path to `''` instead of
  rejecting (`src/adapters/mocks.ts`), so any "read these optional files" sampler
  must treat blank content as absent or it fills its budget with empty slices.
  Guard with `raw && raw.trim().length > 0`, not `raw !== null`.

## Recurring Errors & Fixes

- [2026-08-13] A single `*.it.test.ts` file failing the whole SUITE (not a test)
  with testcontainers' `Error: No host port found for host IP` from
  `startPg` is a Docker port-binding race in the sequential lane, not a code
  failure — the file passes on its own and on the next full run. Re-run before
  investigating; only treat it as real if it reproduces for the same file twice.

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
  - [2026-08-07] `--no-file-parallelism` is not always enough: after enough
    runs the ORPHANED anonymous volumes alone fill the VM, and then even ONE
    container dies with `initdb: could not write to file "pg_wal/xlogtemp.NN":
    No space left on device` → testcontainers reports only
    `Health check failed: unhealthy`, and `scripts/e2e.sh` reports only
    "isolated Postgres did not become healthy in time". Read `docker logs` on
    the dead container to see the real cause. Safest cure, and better than
    `docker volume prune` because it cannot touch a named volume even if the
    dev stack is down: remove only the anonymous ones —
    `docker volume ls --format '{{.Name}}' | grep -E '^[0-9a-f]{64}$' | xargs -n1 docker volume rm`.
    Also `docker rm -f` any leftover `testcontainers-ryuk-*` container.

## Session Notes

- [2026-08-10] L04 Blast Radius shipped server-side: `modules/blast`
  (status.ts + build.ts are pure and carry the whole derivation table),
  `pr_blast_summary` (migration 0016), four new repo-intel facade methods, and
  `POST /reviews/diff` for the pre-push CLI. Two latent defects in the never-used
  blast engine surfaced and were fixed at the source: the "per symbol" caller cap
  was a global `slice(0, 20)`, and the caller query's `INNER JOIN file_rank`
  returned ZERO callers on a rank-less partial index while still reporting
  `degraded: false`.

## Open Questions
