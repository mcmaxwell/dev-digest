# Plan: L06 Onboarding Tour - one generated, grounded, five-section tour per imported repository

Spec: `docs/specs/L06-onboarding-tour.md` (Spec ID L06, 70 EARS criteria, AC-1 … AC-70).

## Understanding

Build the feature `docs/specs/L06-onboarding-tour.md` specifies: a repository-scoped page that turns facts DevDigest already holds (`repo-intel` rank and dependency chains, the clone's manifests and task files, `TODO`/`FIXME` markers, `good first issue` issues) plus **exactly one** structured model call into five fixed sections, verifies every path the model emitted against the clone at the generation commit, persists the result with its provenance and its cost, and never renders an error page.

The seam is half-built and unfed: the system prompt, the `Onboarding` contracts, the `onboarding` table, the `onboarding` `FEATURE_MODELS` entry, `client/messages/en/onboarding.json`, the `onboarding-tour` nav label and the `repo-intel` T3 reads (`getTopFilesByRank`, `getCriticalPaths`, zero callers) all exist.
There is no module, no route, no page, and both the prompt and the client copy describe a **different** five sections from the five this spec fixes.

Out of scope, per the spec's non-goals: feeding tour text into any prompt, an in-product code viewer, model-chosen sections, per-section regeneration, writing into `server/clones/**`, sharing URLs, git churn in the ranking, a sixth MCP tool, localisation, consuming L05's attachment set, and any automatic generation or regeneration.

## Verification of the requirements

Three things the spec leaves to this plan, decided here with defaults so nothing blocks:

1. **The `/onboarding` nav collision (AC-3, spec design review: "which of the two surfaces is renamed is the planner's decision").**
   Decided: the **add-repository screen moves to `/repos/new`** and the tour takes `/repos/:repoId/onboarding`.
   Rationale in the rationale half.
2. **Server-side Mermaid validation (AC-21).**
   Decided: a deterministic structural guard on the server (keyword prefix, no fences, no newline inside a quoted label, size cap) plus the existing client parse gate in `client/src/components/mermaid-diagram/MermaidDiagram.tsx`, which already renders `null` on an unparseable diagram.
   No `mermaid` + `jsdom` dependency is added to the server.
3. **"N commits behind" on a shallow clone (AC-47).**
   Decided: count the tour's `head_sha` back through `container.git.log(ref)`; when the sha is not reachable (a depth-1 clone that has never been resynced, or drift beyond `RESYNC_FETCH_DEPTH = 50`), the header states the head has moved and names both shas, without a number.
   No GitHub API call on a read path.

The spec's open question 3 ("should route and endpoint facts reach the architecture section") is answered **no** for L06: the facade would need a new repository-wide endpoints read, and the spec marks the facts optional.
That is a decision inside the spec's stated latitude, not a change to what it requires.

## Architectural constraints

- Routes are transport only: zod schemas + one service call, no `drizzle-orm`, no `src/db` - rule
  `routes-are-transport-only`, `server/.dependency-cruiser.cjs:9-17`; skill `onion-architecture`.
- Only `repository.ts` imports the drizzle query builder - rule `queries-live-in-repositories`,
  `server/.dependency-cruiser.cjs:19-31`.
- Cross-module reads go through a Container getter (`container.reposRepo`, `container.repoIntel`,
  `container.git`, `container.codeIndex`, `container.github()`) or by constructing another
  module's `service.ts`; `no-cross-module-imports` exempts only another module's
  `service.ts` / `types.ts` / `constants.ts` (`server/.dependency-cruiser.cjs:33-57`).
  **`isJunkPath` lives in `repo-intel/service.ts` and is NOT importable** - the junk filter is
  obtained by consuming `getTopFilesByRank`, which already applied it
  (`server/src/modules/repo-intel/service.ts:687-708`).
- A service MUST build its own repository from `container.db`, not from a container getter -
  services are constructed as `new XService({ db } as unknown as Container)` in tests
  (`server/INSIGHTS.md:200-210`; precedent `project-context/service.ts`). Methods needing git,
  LLM, jobs or GitHub therefore need a real Container and are tested through `buildApp`.
- Modules reach I/O only through port interfaces - rule `modules-use-ports-not-clients`,
  `server/.dependency-cruiser.cjs:59-68`. A new external capability is a **full port change,
  atomically**: interface + real adapter + mock in one step (skill `onion-architecture`, rule 4).
- `reviewer-core` is NOT modified and learns nothing about the tour. The only thing borrowed is
  `wrapUntrusted`, imported from `@devdigest/reviewer-core` exactly as
  `server/src/modules/reviews/run-executor.ts:4` already does.
- Do **not** append `INJECTION_GUARD` next to the tour's untrusted blocks. The onboarding system
  prompt already carries the one canonical rule (`server/src/prompts/onboarding.system.md:11-12`);
  a second, weaker phrasing is what `reviewer-core/INSIGHTS.md` warns against.
- Contract changes land in BOTH `server/src/vendor/shared` (canonical) and
  `client/src/vendor/shared` in ONE step. Verify with `diff -q` on the touched files **only** -
  a whole-tree diff is always red. The genuinely pre-drifted files are `adapters.ts`,
  `contracts/eval-ci.ts` and `contracts/productionize.ts` (`.claude/repo-facts.md:76`);
  `contracts/knowledge.ts` is **currently clean between the two copies**, so step 1 verifies with
  `diff -q` and must leave it clean. Root `INSIGHTS.md:43-50` says "four files" including
  `knowledge.ts` and is stale on that point.
  Only `adapters.ts` (step 2) needs the weaker targeted-`grep` verification.
- Migration must be strictly ADDITIVE (two new columns, no drops). `pnpm db:generate` turns
  interactive and hangs on piped stdin when one table both gains and drops columns - never pipe
  stdin into it (`server/INSIGHTS.md:272-279`). Never hand-edit `server/src/db/migrations/**`.
- No table in this feature carries a `running` status. Any table with one needs a boot reaper
  (`server/INSIGHTS.md:51-61`); the one-generation-per-repository guard is an in-memory
  single-flight map on the single service instance created in the plugin body.
- `jobs.register(kind, handler, { timeoutMs })` must be budgeted from the module's own constants
  and set ABOVE the honest worst case (`server/INSIGHTS.md:51-61`).
- `MockGitClient.readFile` resolves a MISSING path to `''` instead of rejecting
  (`server/src/adapters/mocks.ts`; `server/INSIGHTS.md:280-283`). Every "file absent" branch must
  treat blank/whitespace-only content as absent, not only a thrown error.
- The structured-output schema the model sees must stay a FLAT `z.object` with fixed keys - a
  `z.discriminatedUnion` emits `oneOf`, which models handle far worse (`INSIGHTS.md:93-99`).
  The persisted contract, which no model sees, may use a discriminated union.
- Client: data access only through `src/lib/hooks/*` then `src/lib/api.ts`; query keys live in the
  hook file; every user string through next-intl; `@/` alias across folders, relative inside
  `src/app`; one feature must not import a sibling feature's `_components` (`client/AGENTS.md`,
  enforced by `pnpm lint`).
- `client/src/vendor/ui/**` is frozen with ONE sanctioned exception: `nav.ts` data edits
  (`client/INSIGHTS.md:88-99`). This plan takes that exception and touches nothing else there.
- Do-not-touch bordering this work: `server/clones/**` (read-only here, and `GitClient` has no
  write method), `server/src/db/migrations/**` (generated), `client/src/vendor/ui/**` except
  `nav.ts`, `.env` files.
- Environment: the default shell node is v17 and breaks `pnpm`/`vitest` - prefix every command
  with `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` (`INSIGHTS.md:122-126`).

## Skills for the implementer

| Step | Skill | Why |
| --- | --- | --- |
| 1 | `zod` | The onboarding contract block is rewritten: a discriminated union, nullable usage fields, five fixed section kinds |
| 2 | `onion-architecture` | A port gains a method: interface + adapter + mock atomically, in both contract copies |
| 3 | `postgresql-table-design`, `drizzle-orm-patterns` | Two additive columns on an existing table; column-vs-jsonb split |
| 4 | `onion-architecture`, `zod`, `security` | Layer placement of the pure files; the model draft schema; untrusted wrapping and `.env` handling |
| 5 | `drizzle-orm-patterns`, `onion-architecture` | The repository is the only drizzle importer |
| 6, 7 | `onion-architecture`, `security` | Service layer, ports over clients, workspace scoping, secret scrubbing |
| 8 | `fastify-best-practices`, `onion-architecture` | Schema-first routes, plugin-scoped job registration |
| 9 | (none - use `TESTING.md`) | Integration lane conventions |
| 10 | `next-best-practices`, `frontend-ui-architecture` | Route segment move and its call sites |
| 11 | `frontend-ui-architecture` | Hook placement, query keys, i18n namespaces |
| 12 | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `security` | Page layout, `use client` island, collapsible cards, focus management, markdown sanitisation |
| 13 | (none - `e2e/README.md`) | Deterministic JSON flows |
| 14 | `engineering-insights` | Mandated wrap-up (`CLAUDE.md`) |

`security` and `pr-self-review` are NOT routed as review skills here - `/security-review` and the `architecture-reviewer` agent run after implementation.

## Steps

### Step 1 - Contracts, in both `vendor/shared` copies

**Satisfies: AC-17, AC-52, AC-54, AC-58, AC-59; enables AC-5..AC-11, AC-22..AC-31, AC-40..AC-47, AC-53, AC-56..AC-63.**

- Files: `server/src/vendor/shared/contracts/knowledge.ts:28-47`,
  `client/src/vendor/shared/contracts/knowledge.ts` (same block),
  `client/src/lib/types.ts:11-32`
- Does: replace the three-type `// ---- Onboarding ----` block with the L06 shape. `OnboardingLink`
  is kept as-is.

  ```
  OnboardingSectionKind   = z.enum(['architecture','critical_paths','run_locally','reading_path','first_tasks'])
  OnboardingSectionStatus = z.enum(['ok','empty','no_graph'])
  OnboardingDegradedReason= z.enum(['no_index','partial_index','repo_too_large','model_failed','issues_unavailable'])

  OnboardingCriticalPath  = { path, reason, rank_percentile: z.number().nullable() }
  OnboardingRunStep       = { step: int().positive(), command, source }
  OnboardingReadingEntry  = { order: int().positive(), path, reason }
  OnboardingFirstTask     = { title, origin: z.enum(['todo','issue']),
                              path: nullish, line: int().positive().nullish(),
                              issue_number: int().positive().nullish() }

  OnboardingSectionBase   = { title, body, status: OnboardingSectionStatus,
                              links: z.array(OnboardingLink) }
  OnboardingSection       = z.discriminatedUnion('kind', [
                              Base.extend({ kind: z.literal('architecture'),   diagram: z.string().nullish() }),
                              Base.extend({ kind: z.literal('critical_paths'), items: z.array(OnboardingCriticalPath) }),
                              Base.extend({ kind: z.literal('run_locally'),    items: z.array(OnboardingRunStep) }),
                              Base.extend({ kind: z.literal('reading_path'),   items: z.array(OnboardingReadingEntry) }),
                              Base.extend({ kind: z.literal('first_tasks'),    items: z.array(OnboardingFirstTask) }),
                            ])

  OnboardingUsage         = { calls: int(), provider, model,
                              tokens_in: int().nullable(), tokens_out: int().nullable(),
                              cost_usd: z.number().nullable(), attempts: int(), duration_ms: int() }

  Onboarding              = { repo_id, status: z.enum(['ready','degraded']),
                              degraded_reasons: z.array(OnboardingDegradedReason),
                              head_sha, index_sha: z.string().nullable(),
                              files_indexed: int(), files_skipped: int(),
                              excerpts_used: int(), dropped_rows: int(), dropped_steps: int(),
                              generated_at: z.string(),
                              sections: z.array(OnboardingSection),
                              usage: OnboardingUsage.nullable() }

  OnboardingGeneration    = { status: z.enum(['idle','running']),
                              phase: z.enum(['facts','graph','markers','issues','model','verifying']).nullable(),
                              started_at: z.string().nullable() }

  OnboardingPage          = { repo_id, clone: z.enum(['ready','absent']),
                              tour: Onboarding.nullable(),
                              generation: OnboardingGeneration,
                              current_head_sha: z.string().nullable(),
                              stale: z.boolean(),
                              commits_behind: z.number().int().nullable() }
  ```

  `client/src/lib/types.ts` re-exports `Onboarding`, `OnboardingPage`, `OnboardingSection`,
  `OnboardingUsage`, `OnboardingGeneration`, `OnboardingDegradedReason` and the four row types
  alongside the existing block.
- Does not: constrain `sections` to `.length(5)` in the contract. Five sections are guaranteed by
  the assembler (step 4); a length constraint on the READ path would turn a malformed stored
  document into a thrown response, which AC-63 forbids. Does not touch `Conformance`, `Eval`,
  `Memory`, `Skills`, `Conventions` or `Agents` in the same file. Does not add a `links` field to
  any row type - rows carry their own path, and `links` stays section-level as the spec states.
- Skills: `zod`
- Verify: `diff -q server/src/vendor/shared/contracts/knowledge.ts
  client/src/vendor/shared/contracts/knowledge.ts` - the two copies are clean today and must stay
  clean after the edit (this is a stronger check than a symbol grep, and the plan's earlier claim
  that this file is pre-drifted was wrong - see the Architectural constraints note). Then
  `cd server && pnpm typecheck` and `cd client && pnpm typecheck`.

### Step 2 - Port changes: `GitHubClient.listIssues`, `GitClient.listFiles`, `GitClient.log` bound

**Satisfies: AC-29, AC-31, AC-57 (the no-graph fallback's data source), AC-47.**

- Files: `server/src/vendor/shared/adapters.ts:143-167,205-228`,
  `client/src/vendor/shared/adapters.ts:122-136`,
  `server/src/adapters/github/octokit.ts:351` (beside `getIssue`),
  `server/src/adapters/git/simple-git.ts`,
  `server/src/adapters/mocks.ts:137` (`MockGitHubClient`, `MockGitClient`)
- Does: three port additions, each as a COMPLETE port change (interface in both copies + real
  adapter + mock), because a method without all three is a partial port.

  ```ts
  /** Open issues carrying every label in `labels`, newest first, capped at `limit`. */
  listIssues(repo: RepoRef, opts: { labels: string[]; limit: number }): Promise<IssueMeta[]>;

  /** Repo-relative paths tracked at HEAD, capped at `limit`. Backed by `git ls-files`. */
  listFiles(repo: RepoRef, opts?: { limit?: number }): Promise<string[]>;
  ```

  `listFiles` exists because **the no-graph fallback had no data source**: step 4's
  `heuristicCandidates(fileTree)` needs a file listing, and neither `GitClient` (which has
  `clone/fetchPullHead/sync/currentHead/diff/diffNameOnly/blame/log/readFile/clonePathFor` and
  nothing else) nor `CodeIndex` (`grep/symbols/references`) could supply one, while
  `repo-intel.getRepoMap` degrades to `{ text: '', degraded: true }` under exactly the unindexed
  condition the fallback exists for. Without it AC-57 and AC-58 are unimplementable and step 9's
  no-graph test cannot pass. The `simple-git` adapter implements it with `raw(['ls-files'])`;
  `MockGitClient` gains a `files?: string[]` option defaulting to `[]`.

  `GitClient.log` additionally gains an optional `{ maxCount }` so AC-47's commit count cannot
  become unbounded work on the 300 ms read path. It is bounded in practice today
  (`CLONE_DEPTH = 1`, `RESYNC_FETCH_DEPTH = 50` mean `log()` can never return more than 50
  commits), so this is a bound made explicit rather than a bug fixed; the service passes
  `{ maxCount: RESYNC_FETCH_DEPTH }`.

  `OctokitGitHubClient` implements it with `octokit.rest.issues.listForRepo({ owner, repo, state:
  'open', labels: labels.join(','), per_page: limit })`, wrapped in the same `withRetry(() =>
  withTimeout(..., TIMEOUT))` shape the neighbouring methods use, filtering out results carrying
  `pull_request` (GitHub's issues endpoint returns PRs too), and mapping to `IssueMeta`
  (`number`, `title`, `body`, `state` - `server/src/vendor/shared/contracts/platform.ts:213-219`).
  `MockGitHubClient` gains a `issues?: IssueMeta[]` option on `MockGitHubOptions` and returns it,
  defaulting to `[]`, so an integration test can drive both the "issues present" and the
  "issues absent" branch without a network.
- Does not: add a field to `ContainerOverrides` or a getter to `Container` - the `github` and `git`
  ports and their overrides already exist (`server/src/platform/container.ts:44,159-166`), so these
  port changes are interface + adapter + mock and nothing else. Does not add pagination to
  `listIssues`; `limit` is the cap and one page is the contract. Does not make `listFiles` walk the
  working tree - `git ls-files` reports tracked paths only, which is what keeps ignored and
  generated files out of the heuristic.
- Skills: `onion-architecture`
- Verify: `grep -n "listIssues\|listFiles" server/src/vendor/shared/adapters.ts
  client/src/vendor/shared/adapters.ts server/src/adapters/github/octokit.ts
  server/src/adapters/git/simple-git.ts server/src/adapters/mocks.ts` shows every method in
  interface, adapter and mock, then `cd server && pnpm typecheck && pnpm arch:check`
  and `cd client && pnpm typecheck`. `adapters.ts` IS pre-drifted between the copies
  (`.claude/repo-facts.md:76`), so this step uses the grep rather than `diff -q`.

### Step 3 - DB: two additive columns on `onboarding`, and the generated migration

**Satisfies: AC-1 (already provided), AC-51 (already provided), AC-5, AC-59, AC-61.**

- Files: `server/src/db/schema/context.ts:120-126`, the generated migration under
  `server/src/db/migrations/`
- Does: add to the existing `onboarding` table, keeping `repoId` (PK, `onDelete: 'cascade'`),
  `json` and `generatedAt` exactly as they are:
  - `headSha: text('head_sha')` - nullable, with a doc comment stating it is a **projection** of
    `json.head_sha` written in the same upsert, nullable only because the column was added to an
    existing table (the same convention `ConventionEvidence.sha` uses at
    `server/src/vendor/shared/contracts/knowledge.ts:230-235`).
  - `status: text('status', { enum: ['ready','degraded'] }).notNull().default('ready')` - the
    second projection, defaulted so the migration cannot fail on an existing row.
  A doc comment above the table records that the tour DOCUMENT lives in `json` and these two
  columns exist so "which repositories have a stale or degraded tour" is answerable without a
  jsonb scan, and that both are written from the same object in one statement.
- Does not: add a `running`/`generating` status column - a table with one needs a boot reaper
  (`server/INSIGHTS.md:51-61`), and the in-flight guard is in-memory instead. Does not store the
  usage record, the degraded reasons or the section content in columns - those are document-shaped
  and belong in `json` (skill `postgresql-table-design`: core relations in tables, variable
  attributes in JSONB). Does not add a GIN index on `json`: the only access path is by primary key.
- Skills: `postgresql-table-design`, `drizzle-orm-patterns`
- Verify: `cd server && pnpm db:generate` (**never** with piped stdin), read the generated SQL - it
  must contain only `ALTER TABLE "onboarding" ADD COLUMN`, no `DROP` and no other table - then
  `pnpm db:migrate`.

### Step 4 - `modules/onboarding` pure core, the model draft schema, and the retargeted prompt

**Satisfies: AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-24, AC-25, AC-27, AC-28, AC-30, AC-32, AC-33, AC-34, AC-57, AC-58, AC-60, AC-64, AC-65.**

- Files (all new unless noted): `server/src/modules/onboarding/constants.ts`, `types.ts`,
  `facts.ts`, `candidates.ts`, `schemas.ts`, `prompt.ts`, `verify.ts`, `skeleton.ts`,
  plus `facts.test.ts`, `candidates.test.ts`, `prompt.test.ts`, `verify.test.ts`,
  `skeleton.test.ts`; and a rewrite of the existing
  `server/src/prompts/onboarding.system.md`
- Does:
  - `constants.ts`: `SECTION_KINDS` (the five, in order), `GENERATE_JOB_KIND =
    'onboarding-generate'`, `JOB_TIMEOUT_MS = 150_000`, `MODEL_TIMEOUT_MS = 90_000`,
    `MAX_SCHEMA_REPAIRS = 2`, `PROMPT_TOKEN_CEILING = 30_000`, `MAX_EXCERPT_FILES = 15`,
    `MAX_EXCERPT_LINES = 120`, `EXCERPT_CUTOFF_INDEXED_FILES = 50_000`,
    `MAX_CRITICAL_PATHS = 8`, `MAX_RUN_STEPS = 12`, `MAX_READING_ENTRIES = 10`,
    `MAX_FIRST_TASKS = 5`, `MAX_ISSUES = 20`, `MAX_RANKED_FILES = 200`,
    `MAX_HEURISTIC_FILES = 2_000`, `MARKER_PATTERN = 'TODO|FIXME'`,
    `GOOD_FIRST_ISSUE_LABEL = 'good first issue'`, `REPO_MAP_BUDGETS = [8_000, 4_000, 2_000, 0]`,
    and `FACT_FILES` - the fixed, client-independent read list: manifests (`package.json`,
    `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`,
    `composer.json`), task runners (`Makefile`, `Justfile`, `Taskfile.yml`), compose
    (`docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`, `Dockerfile`),
    `.env.example`, `.env.sample`, `README.md`, `CONTRIBUTING.md`.
  - `facts.ts` (pure, no I/O, no Container): given `{ path, content }` records, produce the
    deterministic fact set - `envKeys(content)` returning **left-hand sides only**, never a value
    (AC-7); `packageScripts`, `makeTargets`, `composeServices`, `declaredStack`; and
    `readmeExcerpt` capped by line count. Every function treats blank/whitespace-only content as
    an absent file (`server/INSIGHTS.md:280-283`).
  - `candidates.ts` (pure): builds the candidate sets the prompt carries and the assembler
    replays - `readingCandidates(topFilesByRank)` preserving `getTopFilesByRank` order verbatim
    (AC-8), `criticalCandidates(chains, rankRows)` flattening `getCriticalPaths` chains and
    keeping rank order (AC-23), `firstTaskCandidates(markers, issues)` (AC-29), and
    `heuristicCandidates(files)` - the no-graph fallback that ranks by directory prominence
    (files per top-level directory) and entry-point names (`main`, `index`, `app`, `server`,
    `cli`) (AC-57). Its input is the `string[]` returned by step 2's new `GitClient.listFiles`;
    it is a pure function over that array, and supplying it is the ONLY reason that port method
    exists. Nothing else in the codebase can list a clone's files.
  - `schemas.ts`: the model's structured-output schema. A **flat `z.object` with five fixed keys**
    (`architecture`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks`), each a plain
    object of `{ title, body, ... }`. No union anywhere (`INSIGHTS.md:93-99`). `architecture`
    carries `diagram: z.string().nullable()` and no other key does, so AC-20 holds by construction
    and a model that returns four or six sections is repaired against fixed keys rather than
    counted (spec edge case). Rows: `critical_paths.items[{path, reason}].max(8)`,
    `run_locally.items[{command, source}].max(12)`,
    `reading_path.items[{path, reason}].max(10)`,
    `first_tasks.items[{title, origin, path, line, issue_number}].max(5)`.
    Each of the five keys ALSO carries `links: [{label, path}].max(4)`, matching the existing
    `OnboardingLink` shape - the model may cite up to four supporting files per section. This is
    stated explicitly because `verify.ts` drops unverifiable links and step 12 renders them, so
    leaving the field implicit would have made both operate on something the schema never asked
    for.
    A doc comment records why this is a module-local schema rather than the shared contract: what
    the model returns is not what is persisted (rows are verified and dropped, `rank_percentile`
    and `step` ordinals come from us, provenance and usage are ours), which is the exact carve-out
    `server/INSIGHTS.md:233-239` states for conventions.
  - `prompt.ts` (pure): `assemblePrompt(facts, budget)` returning `{ user, sections, excerptsUsed,
    tokens }`. Every fact block goes through `wrapUntrusted(label, content)` imported from
    `@devdigest/reviewer-core` (AC-64; the helper already neutralises a `</untrusted>` inside the
    content by `replaceAll` before wrapping - `reviewer-core/src/prompt.ts:30-34` - so AC-65 needs
    no new code and no second guard sentence). Budget reduction is ordered exactly as AC-11
    requires: drop excerpts (last-ranked first) until they are gone, then walk `REPO_MAP_BUDGETS`
    down, re-measuring with the injected token counter after each step. Excerpts are capped at
    `MAX_EXCERPT_FILES` files and `MAX_EXCERPT_LINES` lines each before the loop starts (AC-9), and
    the caller passes zero excerpts above `EXCERPT_CUTOFF_INDEXED_FILES` (AC-10).
    **The repo-map rung is a re-fetch, not a truncation, and that is what keeps `prompt.ts` pure.**
    `getRepoMap(repoId, budget)` is an I/O call, so `assemblePrompt` never makes it: the caller
    (step 6) fetches the map at each rung and re-invokes `assemblePrompt`, which stays a pure
    function of the facts it is handed. The ladder therefore lives in the service as a loop over
    `REPO_MAP_BUDGETS` whose body is one facade read plus one pure assembly, and
    `prompt.test.ts` drives that loop with a fake fetcher. Truncating an already-fetched map
    string would be simpler and is explicitly NOT what AC-11 asks for.
  - `verify.ts` (pure over an injected `exists(path) => boolean`): `verifyDraft(draft, ctx)`
    returning `{ sections, droppedRows, droppedSteps }`. Drops any `critical_paths` or
    `reading_path` row whose path is absent from the clone OR absent from its candidate set
    (AC-32, AC-33, AC-23, AC-8); drops any `run_locally` step whose cited `source` does not exist
    (AC-25) and numbers the survivors `1..n` (AC-24); drops any `first_tasks` row that resolves to
    neither a known marker (path+line) nor a known issue number (AC-28, AC-29); drops
    section-level `links` whose path is absent. `linkProsePaths(body, ctx)` rewrites inline-code
    spans that look like repo-relative paths: existing ones become a Markdown link to
    `https://github.com/<full_name>/blob/<head_sha>/<path>` (AC-35), non-existing ones
    are left as inline code and never linked (AC-34). `guardDiagram(src)` returns the diagram or
    `null` using the structural rules from
    `client/src/components/mermaid-diagram/MermaidDiagram.tsx:9-15` (known graph keyword prefix),
    plus: no triple-backtick fence, no newline inside a double-quoted label, size at most 8 KB (AC-21).
    `sectionStatus(section, usedGraph)` yields `ok` / `empty` / `no_graph` (AC-19, AC-58).
  - `skeleton.ts` (pure): `deterministicTour(facts, candidates, reasons)` - the five sections built
    from facts alone, used when the model call fails, times out, or cannot be repaired (AC-60),
    and as the base every successful generation is merged into so **all five sections always
    exist** (AC-18) with their own empty line naming what was looked for (AC-19, AC-30 names both
    `TODO`/`FIXME` markers and `good first issue` issues).
  - `server/src/prompts/onboarding.system.md`: retargeted to the five sections this spec fixes.
    Remove every mention of `routes_and_apis` (lines 8, 23-26) and the "produce EXACTLY these
    sections / {{sections}}" list is replaced by the five fixed keys; keep the SECURITY paragraph
    (lines 11-12) **verbatim** - it is the one canonical injection guard this feature relies on;
    keep the grounding rules, the mermaid rules and the `{{language}}` line, filled with
    `English`. Add: rows must cite a path or a source file from the provided candidate lists,
    and a command must name the file it was read from.
  - Tests: table-driven and hermetic. `facts.test.ts` covers `.env.example` yielding names and
    never values, blank content treated as absent, scripts/targets/services extraction.
    `prompt.test.ts` covers the excerpt caps, the budget ladder order, and that a fact containing
    `</untrusted>` cannot close its block. `verify.test.ts` covers every drop branch, the prose
    linker on both paths, and each diagram rejection. `skeleton.test.ts` covers five sections
    always present with their statuses. No DB, so **no** `.it` suffix.
- Does not: put any of this in `service.ts`; import `Container` in any of these files; call
  `node:fs`; append `INJECTION_GUARD`; add `mermaid` or `jsdom` to `server/package.json`; or
  import anything from `repo-intel/` other than its `types.ts` (`import type`).
- Skills: `onion-architecture`, `zod`, `security`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`

### Step 5 - `modules/onboarding/repository.ts`

**Satisfies: AC-1, AC-49, AC-61, AC-62.**

- Files: `server/src/modules/onboarding/repository.ts` (new)
- Does: a class taking `Db`, modelled on `server/src/modules/project-context/repository.ts`.
  Methods: `get(repoId)` and `upsert(repoId, { document, headSha, status })` - one
  `insert().onConflictDoUpdate({ target: onboarding.repoId })` writing `json`, `head_sha`,
  `status` and `generatedAt` together, which is what makes AC-49 and AC-62 a single statement and
  AC-1 a primary-key property rather than application logic. A doc comment states that
  `onboarding` carries no `workspace_id` and gets its tenancy from the service, which resolves the
  repository through `container.reposRepo.getById(workspaceId, repoId)` first - the pattern
  `server/INSIGHTS.md:226-232` requires be written down.
- Does not: delete on read, keep history, or expose a list method - one row per repository is the
  whole model.
- Skills: `drizzle-orm-patterns`, `onion-architecture`
- Verify: `cd server && pnpm typecheck && pnpm arch:check`

### Step 6 - Service part A: fact collection, phases, degraded reasons, the read path

**Satisfies: AC-5, AC-6, AC-7, AC-8, AC-10, AC-23, AC-29, AC-31, AC-37, AC-39, AC-40, AC-41, AC-47, AC-56, AC-57, AC-63, AC-67, AC-68, AC-69.**

- Files: `server/src/modules/onboarding/service.ts` (new)
- Does: `class OnboardingService { constructor(private container: Container) { this.repo = new
  OnboardingRepository(container.db); } }`
  - `read(workspaceId, repoId): Promise<OnboardingPage>` - resolve the repository through
    `container.reposRepo.getById(workspaceId, repoId)`, 404 if absent (AC-69). `clone` is
    `absent` when `repo.clonePath` is null or `container.git.currentHead(ref)` throws (AC-37).
    Load the stored row, `safeParse` the document against `Onboarding`, and on a parse failure
    return a minimal degraded tour rather than throwing - a stored document must never produce an
    error page (AC-63). Staleness: `stale = currentHead !== tour.head_sha`; only when stale, call
    `container.git.log(ref)` and set `commits_behind` to the index of `tour.head_sha` in that list,
    or `null` when it is not reachable (AC-47).
  - `collectFacts(repo, ref, onPhase)` - the deterministic pass, in this order, each step setting
    a phase for AC-39:
    `facts` - `container.git.currentHead(ref)` recorded as `head_sha` **first** (AC-5), then the
    `FACT_FILES` list read through `container.git.readFile`, each failure or blank result dropping
    that one fact and nothing else; `.env` is not in the list and `.env.example` yields names only
    (AC-6, AC-7).
    `graph` - `container.repoIntel.getIndexState(repoId)` for `files_indexed`, `files_skipped`,
    `index_sha`, then `getRepoMap(repoId, budget)` (re-read once per `REPO_MAP_BUDGETS` rung, see
    step 4), `getTopFilesByRank(repoId, MAX_RANKED_FILES)`, `getCriticalPaths(repoId)` and
    `getFileRank(repoId, paths)` over the union of the ranked and critical-path files - the last
    one is what populates `rank_percentile` on every critical-path row
    (`server/src/modules/repo-intel/types.ts:118-122,149`); without it the field would silently
    persist `null` forever. Array reads return `[]` when degraded by the facade's own contract
    (`server/src/modules/repo-intel/types.ts:14-21`), which is the trigger for
    `heuristicCandidates` over `container.git.listFiles(ref, { limit: MAX_HEURISTIC_FILES })` and
    the per-section `no_graph` status (AC-57, AC-58).
    `markers` - `container.codeIndex.grep(ref, MARKER_PATTERN)`, filtered to the candidate file
    set: the `getTopFilesByRank` result when the graph exists, the `listFiles` result when it does
    not. Filtering is what applies the junk-path filter without importing `isJunkPath` (AC-29, and
    the vendored-dependency edge case). `MAX_RANKED_FILES` is therefore a real ceiling on where a
    first task can be found - a valid `TODO` in a file ranked below it is invisible - so it is set
    to 200 rather than 30, and the limitation is stated in Risks rather than left implicit.
    `issues` - `(await container.github()).listIssues(ref, { labels: [GOOD_FIRST_ISSUE_LABEL],
    limit: MAX_ISSUES })` inside a try/catch; any throw (including the `ConfigError` a missing
    `GITHUB_TOKEN` raises at `server/src/platform/container.ts:162-163`) records
    `issues_unavailable` and continues (AC-31).
    Degraded reasons are derived here: `no_index` when `filesIndexed === 0` or status `failed`;
    `partial_index` when status `partial` or `degraded`; `repo_too_large` when
    `filesIndexed > EXCERPT_CUTOFF_INDEXED_FILES`, which also forces zero excerpts (AC-10, AC-56).
    Excerpts are read for the top `MAX_EXCERPT_FILES` ranked paths, first `MAX_EXCERPT_LINES`
    lines each, through `container.git.readFile`.
- Does not: accept any path, glob or filename from the caller - the read list is a module constant
  and the ranked paths come from `repo-intel` (AC-67). Does not call `node:fs`. Does not write
  anything to the clone; `GitClient` (`server/src/vendor/shared/adapters.ts:205-228`) has no write
  method at all (AC-68). Does not re-index or touch the `repo-intel` pipeline - only the facade.
  Does not read any `.env` file.
- Skills: `onion-architecture`, `security`
- Verify: `cd server && pnpm typecheck && pnpm arch:check`

### Step 7 - Service part B: the one model call, verification, persistence, single-flight, job

**Satisfies: AC-12, AC-13, AC-14, AC-15, AC-16, AC-20, AC-21, AC-22, AC-24, AC-25, AC-27, AC-28, AC-32, AC-33, AC-34, AC-35, AC-49, AC-50, AC-52, AC-55, AC-59, AC-60, AC-61, AC-62, AC-63, AC-70.**

- Files: `server/src/modules/onboarding/service.ts` (continued),
  `server/src/platform/prompt-log.ts:77,99` (widen the `call` union),
  `server/src/platform/jobs.ts:47-108` (per-kind `retries` override)
- Does:
  - `generate(workspaceId, repoId)` - resolve the repository workspace-scoped, refuse when the
    clone is absent, then take the single-flight slot. The guard is a private
    `Map<repoId, { promise, phase, startedAt }>` on the service INSTANCE; a second call while one
    is in flight throws a `ConflictError` naming the running generation rather than starting a
    second (AC-16). No `running` row is persisted, so no boot reaper is needed
    (`server/INSIGHTS.md:51-61`).
  - Model resolution: `new SettingsService(this.container).resolveFeatureModel(workspaceId,
    'onboarding')` then `container.llm(provider)`, exactly as
    `server/src/modules/intent/service.ts:108-112` does. The registry default is
    `openrouter` / `deepseek/…` from `FEATURE_MODELS`
    (`server/src/vendor/shared/contracts/platform.ts:46-48`) (AC-14).
  - `logPromptAssembly(logger, container.config.promptLog, { correlationId, call: 'onboarding',
    provider, model }, sections, text => container.tokenizer.count(text))` emitted BEFORE the call,
    with one row per assembled fact block plus one per section name. The function takes text and
    returns only measurements, so no file content and no model output can reach a log by
    construction (`server/src/platform/prompt-log.ts:172-183`) (AC-55).
    **`PromptLogMeta.call` and `PromptLogRecord.call` are typed `'intent' | 'review'`
    (`server/src/platform/prompt-log.ts:77,99`), so passing `'onboarding'` does not compile today.**
    This step widens both unions to `'intent' | 'review' | 'onboarding'` - purely additive, no
    behaviour change - and `server/src/platform/prompt-log.ts` joins this step's file list.
  - **Exactly one** `llm.completeStructured({ model, schema: OnboardingDraft, schemaName,
    messages, maxRetries: MAX_SCHEMA_REPAIRS })` wrapped in `withTimeout(..., MODEL_TIMEOUT_MS)`
    and **NOT** in `withRetry` - `withRetry` would re-issue the whole call and break AC-12. The
    providers' own repair loop runs `maxRetries + 1` attempts
    (`server/src/adapters/llm/openai.ts:90-124`), so `MAX_SCHEMA_REPAIRS = 2` gives
    `attempts` at most 3 (AC-13), and `res.attempts` is recorded verbatim.
  - Verification pass over the returned draft using `verify.ts` with `exists` backed by the same
    fact collection, then the merge into `skeleton.ts`'s five sections, then `repo.upsert` -
    **the write happens once, at the end**, which is what keeps the previous tour readable
    throughout a regeneration (AC-50) and replaces it atomically when the new one lands
    (AC-49, AC-62).
  - Failure handling: any throw, `TimeoutError`, or unrepairable output is caught, `model_failed`
    is appended to the reasons, and the deterministic skeleton is persisted with
    `status: 'degraded'` and a usage record carrying `calls: 1`, the provider, the model, the
    attempt count, the duration and `tokens_in/tokens_out/cost_usd` as `null` (AC-15, AC-52,
    AC-54, AC-60, AC-61). Reasons are de-duplicated so each appears once (AC-59). **No path
    resolves to a bare error** (AC-63).
  - **The async execution model, stated explicitly - this is where AC-12 is actually won or lost.**
    `register()` only stores a handler in a map (`server/src/platform/jobs.ts:53`); nothing runs
    until something enqueues. The route (step 8) calls
    `container.jobs.enqueue(GENERATE_JOB_KIND, { workspaceId, repoId })` and returns the page with
    `generation.status = 'running'`; the handler calls `service.generate(...)`.
    **`JobRunner.enqueue` wraps every handler in
    `withRetry(() => withTimeout(handler(...), timeoutMs), { retries: this.retries })`
    (`server/src/platform/jobs.ts:69-108`), and `this.retries` defaults to 2
    (`container.ts:88` constructs `new JobRunner(db)` with no override).** Left alone, any throw
    AFTER a successful model call - a `repo.upsert` blip, any unanticipated bug - re-runs the whole
    handler, including a fresh `completeStructured`, up to three times per click. That is precisely
    the anti-pattern this plan bans one layer down, recreated by the queue.
    So step 7 ALSO widens `JobRunner.register` (and the options it stores) to accept an optional
    `retries`, defaulting to the runner's own value, and registers onboarding with
    **`{ timeoutMs: JOB_TIMEOUT_MS, retries: 0 }`**. `server/src/platform/jobs.ts` joins this
    step's file list. A generation is never retried by the queue; a failed one persists a degraded
    tour and the user retries deliberately (AC-60).
    The single-flight slot is taken **inside** the handler, not at enqueue time, and the route
    checks it before enqueuing, so a second POST while one is queued or running is refused rather
    than queued behind the first (AC-16).
  - `registerGenerateJobHandler()` - `container.jobs.register(GENERATE_JOB_KIND, handler,
    { timeoutMs: JOB_TIMEOUT_MS, retries: 0 })`, the per-kind budget `server/INSIGHTS.md:51-61`
    requires, sized above the honest worst case (90 s model + fact collection + verification).
  - One structured log line per generation, carrying the correlation id, the five section names
    and their token counts, the provider and model, the attempts, the reasons and the dropped
    counts - and every free-text value (a provider error message) passed through
    `scrubSecrets` from `server/src/platform/prompt-log.ts:56-60` (AC-55, AC-70).
- Does not: call `withRetry` around the structured call; make a second model call for any reason;
  enqueue a generation from any other module (AC-48 holds by placement); persist anything from a
  half-finished stream; or store any file body from the clone.
- Skills: `onion-architecture`, `security`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`

### Step 8 - Routes and module registration

**Satisfies: AC-16, AC-67, AC-69.**

- Files: `server/src/modules/onboarding/routes.ts` (new), `server/src/modules/index.ts:1-42`
- Does: a plugin modelled on `server/src/modules/project-context/routes.ts:28-52` - one
  `const service = new OnboardingService(container)` in the plugin body (the single instance whose
  in-memory single-flight map is the AC-16 guard), `service.registerGenerateJobHandler()` before
  the routes, then two routes, each opening with `await getContext(container, req)`
  (`server/src/modules/_shared/context.ts:14-23`) and each declaring its schema with zod through
  `fastify-type-provider-zod`:

  | Route | Params | Body | Returns |
  | --- | --- | --- | --- |
  | `GET /repos/:id/onboarding` | `IdParams` | none | `OnboardingPage` |
  | `POST /repos/:id/onboarding/generate` | `IdParams` | **none** | `OnboardingPage` with `generation.status = 'running'` |

  The POST handler resolves the workspace, asks the service to claim the single-flight slot
  (409 `ConflictError` when one is already held, AC-16), calls
  `container.jobs.enqueue(GENERATE_JOB_KIND, { workspaceId, repoId })` and returns the page
  immediately. **The generation is not awaited in the request** - it runs on the job runner, which
  is why AC-39's phase is polled rather than streamed, and why step 7 had to disable the runner's
  ambient retry.
  Neither schema carries anything path-shaped, which is what removes the path-traversal class by
  construction (AC-67). One import plus one entry in `modules/index.ts`, placed after
  `projectContext`.
- Does not: hand-parse `req.body`; accept a `path`, `file` or `glob` query parameter; expose a
  delete route (AC-51 is the FK's job); widen any depcruise rule or add an allowlist entry.
- Skills: `fastify-best-practices`, `onion-architecture`
- Verify: `cd server && pnpm arch:check && pnpm typecheck` - zero new violations.

### Step 9 - Server integration tests

**Satisfies: AC-4, AC-12, AC-13, AC-14, AC-15, AC-16, AC-29, AC-31, AC-48, AC-49, AC-51, AC-52, AC-56, AC-61, AC-62, AC-63, AC-68, AC-69.**

- Files: `server/src/modules/onboarding/onboarding.it.test.ts` (new)
- Does: drive `buildApp` + `app.inject`. Cases:
  - a repository outside the workspace 404s on both routes (AC-69);
  - one generation makes exactly ONE `completeStructured` call - asserted on a counting stub
    (AC-12) - and records `attempts`, provider, model, tokens and cost (AC-13, AC-14, AC-52);
  - a stub that never resolves produces `status: 'degraded'`, reason `model_failed`, five
    sections and a readable page after a reload (AC-15, AC-61, AC-63);
  - a second `POST .../generate` while one is in flight is refused and the stub's call count stays
    at one (AC-16);
  - **a handler that throws AFTER the model call succeeds still results in exactly ONE
    `completeStructured` call** - the regression test for the job runner's ambient retry, which
    would otherwise re-run the whole handler twice more (AC-12);
  - a retry that succeeds replaces the degraded tour (AC-62), and a regenerate replaces the
    ready one (AC-49);
  - a `MockGitHubClient` whose `listIssues` throws records `issues_unavailable` and still produces
    first tasks from markers (AC-31); one with issues produces issue-origin rows (AC-29);
  - a `repoIntel` override returning `[]` from both T3 reads produces populated critical-path and
    reading-path sections marked `no_graph` (AC-56, AC-57, AC-58);
  - deleting the repository removes the row (AC-51);
  - a resync plus an index refresh leaves `generated_at` unchanged (AC-48);
  - `git status --porcelain` over the fixture clone directory is empty after generating,
    regenerating and reading (AC-68);
  - a full review run on a repository that HAS a tour produces a trace whose
    `prompt_assembly` carries no onboarding segment and whose sections list is unchanged (AC-4).
  Overrides: `git` as a stub whose `clonePathFor` returns a `mkdtemp` fixture directory,
  `repoIntel`, `github`, `codeIndex`, `llm` for every provider the path resolves, **and**
  `secrets: new MockSecretsProvider({})` - omitting the last one makes the test read
  `~/.devdigest/secrets.json` and spend real money (`server/INSIGHTS.md:103-114`).
- Does not: assert on `agent_runs.status` before reading a trace (`server/INSIGHTS.md:116-120`);
  use `vitest -t` to prove a deliberate failure - run the whole file
  (`server/INSIGHTS.md:141-150`); rely on `MockGitClient.readFile` rejecting for a missing file -
  it returns `''` (`server/INSIGHTS.md:280-283`), so the "file absent" cases assert the
  blank-is-absent branch AND a stub that throws.
- Skills: none routed; conventions from `TESTING.md:104-112`
- Verify: `cd server && pnpm exec vitest run .it.test --no-file-parallelism`, then re-run this
  file alone and read the per-file line - a green lane is not evidence the file ran
  (`server/INSIGHTS.md:131-139`).

### Step 10 - Free the `/onboarding` route: the add-repository screen moves to `/repos/new`

**Satisfies: AC-3.**

- Files: `client/src/app/onboarding/page.tsx` to `client/src/app/repos/new/page.tsx` (moved),
  `client/src/app/onboarding/_components/AddRepoView/**` to
  `client/src/app/repos/new/_components/AddRepoView/**` (moved),
  `client/src/app/_components/HomeView/HomeView.tsx:38`,
  `client/src/components/repo-not-found/RepoNotFound.tsx:20`,
  `client/src/components/app-shell/hooks/useShellContext.ts:39,52`,
  `e2e/specs/06-onboarding.flow.json`,
  and the docs that describe `/onboarding` as the add-repository screen and would otherwise become
  actively wrong: `client/AGENTS.md` (route mini-map), `client/INSIGHTS.md` (its note that
  `/onboarding` is deliberately NOT under `ShellLayout` stops being the whole truth once the tour
  route IS), `client/README.md` (route diagram), `e2e/README.md`
- Does: move the segment and update the four `router.push("/onboarding")` call sites to
  `"/repos/new"` (four pushes, plus the `activeKeyFor` line that is deliberately left alone - not
  a fifth edit). `e2e/specs/06-onboarding.flow.json` gets its `open` and `wait --url` steps and
  its `name`/`description` retargeted to `/repos/new`; the two text assertions are unchanged.
  `activeKeyFor` at `client/src/components/app-shell/helpers.ts:29` is left **exactly as it is** -
  after the move, `pathname.includes("/onboarding")` matches only the tour, and `/repos/new`
  matches nothing, so the sidebar highlights one item on the tour and none on the
  add-repository screen (AC-3).
- Does not: rename the nav key, the `shell.json` label
  (`client/messages/en/shell.json:19` already reads `"onboarding-tour": "Onboarding Tour"`), or
  any other `activeKeyFor` branch. Does not add a `layout.tsx` for `/repos/new` - the screen is a
  sibling of `/` today and stays outside `ShellLayout` (`client/INSIGHTS.md:16-27`).
- Skills: `next-best-practices`, `frontend-ui-architecture`
- Verify: `cd client && pnpm typecheck && pnpm lint && pnpm test`, then
  `grep -rn 'push("/onboarding")' client/src` returns nothing, then `./scripts/e2e.sh`.
  **Corrected after verification:** the earlier wording asked for
  `grep -rn '"/onboarding"' client/src` to return nothing, which this step can never satisfy -
  `client/src/components/app-shell/helpers.ts:29` still contains `pathname.includes("/onboarding")`
  and this same step says to leave that line exactly as it is, because it is what highlights the
  tour. Only the `router.push` call sites move.

### Step 11 - Client hooks and i18n

**Satisfies: AC-19, AC-30, AC-39, AC-54; enables every client-side AC.**

- Files: `client/src/lib/hooks/onboarding.ts` (new), `client/src/lib/hooks/index.ts`,
  `client/messages/en/onboarding.json` (rewrite)
- Does: `onboardingKeys.page(repoId)` plus `useOnboarding(repoId)` and
  `useGenerateOnboarding()`, modelled on `client/src/lib/hooks/project-context.ts:14-58`.
  `useOnboarding` sets `refetchInterval: data => data?.generation.status === 'running' ? 1500 :
  false` so the generating state advances without SSE; the mutation writes the returned page into
  the cache with `qc.setQueryData`. One `export *` line appended to the hooks barrel.
  `onboarding.json` is rewritten: the current `generate.body` promises "overview, architecture,
  key modules, getting started, and conventions & gotchas" - five sections this feature does not
  ship - so it is replaced with the five fixed titles, and keys are added for the prerequisite
  state, each section's empty line (First tasks naming BOTH `TODO`/`FIXME` markers and
  `good first issue` issues, AC-30), the per-section "computed without the import graph" marker,
  each degraded reason, the header's index-file count and commit line, the cost line and its
  "cost unavailable" variant (AC-54), the generating phases (AC-39), Regenerate, Retry, Copy
  command, Copy as Markdown, and the on-page navigation label.
- Does not: keep any key describing a section this feature does not ship; add a second data path;
  hand-write a query key in a component.
- Skills: `frontend-ui-architecture`
- Verify: `cd client && pnpm typecheck && pnpm lint`

### Step 12 - Client: the Onboarding Tour page and the nav entry

**Satisfies: AC-2, AC-3, AC-10, AC-17, AC-18, AC-19, AC-20, AC-21, AC-26, AC-30, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47, AC-53, AC-54, AC-58, AC-59, AC-60, AC-63, AC-66.**

- Files: `client/src/app/repos/[repoId]/onboarding/layout.tsx` (new),
  `client/src/app/repos/[repoId]/onboarding/page.tsx` (new),
  `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/**` (new),
  `client/src/vendor/ui/nav.ts:21-27,58-68`
- Does:
  - `layout.tsx` renders `ShellLayout` exactly as
    `client/src/app/repos/[repoId]/context/layout.tsx` does; `page.tsx` is thin - `useParams`,
    `useSetCrumb`, and `<OnboardingTourView repoId={repoId} />`.
  - States, each an early return rather than a stacked ternary: **no clone** - prerequisite copy
    naming the clone, and NO generate control (AC-37); **clone, no tour** - the generate call to
    action stating what will be produced (AC-38); **generating** - the current phase plus the five
    section headings already visible, over the previous tour when one exists (AC-39, AC-50);
    **ready/degraded** - the tour.
  - Header: "Generated from index of N files" plus `files_skipped` when non-zero (AC-40); "generated
    at `abc1234`" with the generation time (AC-41); "· N commits behind" when
    `commits_behind != null`, and the head-has-moved wording with both shas when it is null
    (AC-47); one line per degraded reason, each stated once (AC-59); a line reading
    "1 call · 24,110 in / 1,830 out · $0.0041" from `usage`, falling back to token counts plus
    "cost unavailable" when `cost_usd` is null - never a zero (AC-53, AC-54); the excerpt-free
    note when `excerpts_used === 0` and `repo_too_large` is present (AC-10). Controls: Regenerate
    (or Retry when degraded, AC-60) and Copy as Markdown (AC-45) and **nothing else** - no share
    control (AC-46).
  - Body: five independently collapsible cards, all expanded by default, state not persisted
    (AC-42); every section rendered even when empty, showing its own empty line (AC-18, AC-19);
    the `no_graph` marker on Critical paths and Guided reading path (AC-58); prose through
    `DocMarkdown` from `client/src/components/doc-markdown` - reused, not reinvented - which
    escapes raw HTML and narrows the URL allowlist to `http`/`https` (AC-66, AC-34's plain-text
    half is already server-side); the diagram through
    `client/src/components/mermaid-diagram`, which returns `null` on an unparseable source so the
    prose stands alone with no blank card (AC-20, AC-21).
  - Rows: every verified path is an `Open` link built with `githubBlobUrl(repo.full_name,
    tour.head_sha, path, line?)` from `client/src/lib/github-urls.ts:23-37`, pinned to the
    generation commit (AC-35), opening on github.com - there is no in-product viewer (AC-36).
    Long paths keep the filename whole, middle-truncate the directory part, and carry the full
    path in `title` and `aria-label`.
  - Run steps: each carries a copy control that is a real `<button>`, keyboard-operable, copying
    the whole multi-line command, confirming visibly and through an `aria-live="polite"` region
    (AC-26).
  - "ON THIS PAGE": five entries that call `.focus()` on the target section heading
    (`tabIndex={-1}`), not just `scrollIntoView` - AC-43 asks for focus. Below 900 px it collapses
    to a single jump control above the content (AC-44), driven by a CSS media query plus a
    `matchMedia` hook, never by a JS-only width read that breaks SSR.
  - `nav.ts`: one `NavItemDef` inserted in the `WORKSPACE` group **above** the `context` entry
    (AC-2) - `{ key: "onboarding-tour", label: "Onboarding Tour", icon: <an existing IconName>,
    href: "/repos/:repoId/onboarding", gKey: "o" }` - plus one `SHORTCUTS` row
    `{ keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" }`. `o` is unused today
    (`p`, `x`, `s`, `a`, `c` are taken). Nothing else in the file changes: `activeKeyFor` already
    maps `/onboarding` to `onboarding-tour` and `shell.json` already carries
    `nav.onboarding-tour`, so the command palette and the g-shortcut derive automatically
    (`client/INSIGHTS.md:88-99`).
  - Tests: `OnboardingTourView.test.tsx` covering each state, the collapse of one card leaving the
    other four expanded, the on-page navigation moving focus, keyboard-only copy with its
    announcement, the cost line in both variants, the degraded header, the absence of any share
    control, and a section body containing `<script>` and a `javascript:` link rendering inert.
- Does not: touch any file under `client/src/vendor/ui/` other than `nav.ts`; add a `VALID_TABS`
  entry anywhere (this is a route, not an editor tab, so the three-edit tab trap at
  `client/INSIGHTS.md:58-66` does not apply); import the `@devdigest/ui` barrel from anything the
  root layout reaches without a `"use client"` boundary (`client/INSIGHTS.md:38-47` - `pnpm build`
  does not catch that, only e2e does); render any control that would produce a shareable URL;
  fetch anything outside `src/lib/hooks/*`.
- Skills: `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `security`
- Verify: `cd client && pnpm test && pnpm lint && pnpm typecheck`

### Step 13 - E2E flow

**Satisfies: AC-2, AC-3, AC-37.**

- Files: `e2e/specs/12-onboarding-tour.flow.json` (new)
- Does: a deterministic flow with no LLM. **The seeded stack has no clone** -
  `server/src/db/seed.ts` inserts `acme/payments-api` with `clonePath: null` and `scripts/e2e.sh`
  uses an ephemeral Postgres - so the flow asserts what a clone-less stack actually produces: the
  sidebar carries "Onboarding Tour" above "Project Context" and navigates to
  `/repos/:repoId/onboarding` (AC-2); the page renders the prerequisite state naming the clone and
  offers no Generate control (AC-37); the sidebar highlights the Onboarding Tour item there and no
  item on `/repos/new` (AC-3).
- Does not: attempt a generation, a regeneration or a copy - none is reachable without a real
  clone, and faking one would mean writing into `server/clones/**`.
- Skills: none; conventions from `e2e/README.md` and `TESTING.md:114-116`
- Verify: `./scripts/e2e.sh`

### Step 14 - Documentation and wrap-up

- Files: `server/src/modules/onboarding/README.md` (new), `server/README.md`, `client/README.md`,
  `AGENTS.md` (root - the "Read when…" block; `CLAUDE.md` is a SYMLINK to it, so this is **one**
  edit, not two - `INSIGHTS.md:56-64`), `.claude/repo-facts.md` (regenerate via
  `bash scripts/repo-facts.sh` - a module and a port method were added), `INSIGHTS.md` of the
  touched modules
- Does: document the module - the one-call property, the candidate-set grounding, the degraded
  matrix and the untrusted boundary - then run the `engineering-insights` wrap-up check.
- Skills: `engineering-insights`
- Verify: `bash scripts/repo-facts.sh` regenerates cleanly and `onboarding` appears in the
  "Server modules" row.

## Test strategy

- **New hermetic server unit tests (step 4):** `facts.test.ts`, `candidates.test.ts`,
  `prompt.test.ts`, `verify.test.ts`, `skeleton.test.ts`. No DB, so no `.it` suffix. These carry
  the grounding, budget and degradation logic, which is where the feature's correctness lives.
- **New DB-backed test (step 9):** `server/src/modules/onboarding/onboarding.it.test.ts` - named
  `*.it.test.ts` because it imports `test/helpers/pg.ts`. Run it with
  `--no-file-parallelism` and then re-run it alone; a green lane is not evidence a file ran
  (`server/INSIGHTS.md:131-139`).
- **New client tests (steps 11, 12):** `OnboardingTourView.test.tsx` plus its sub-components.
- **New e2e flow (step 13)** and an amended `e2e/specs/06-onboarding.flow.json` (step 10).
- **Existing suites that must stay green:** the whole server unit and integration lanes, the whole
  client suite, and `./scripts/e2e.sh`. `reviewer-core` is **not modified** by this plan - only
  `wrapUntrusted` is imported - so `cd reviewer-core && npm test` should be unchanged; run it once
  as a control. Note `e2e/specs/04-pr-findings.flow.json` asserts a literal substring in a
  component header, so any header text touched must be appended to, never replaced
  (`client/INSIGHTS.md:112-115`).

## Non-functional requirements

- **Exactly one model call per generation, plus at most two schema repairs** - step 7: no
  `withRetry` around `completeStructured`, `maxRetries: 2`, `attempts` recorded (AC-12, AC-13).
- **30,000-token input ceiling** - step 4's budget ladder, measured with
  `container.tokenizer.count` on the assembled text; excerpts drop first, then the repo-map budget
  walks down `REPO_MAP_BUDGETS` (AC-11).
- **At most 15 excerpt files by at most 120 lines; 0 excerpts above 50,000 indexed files** - steps 4, 6
  (AC-9, AC-10).
- **90,000 ms generation ceiling** - step 7's `withTimeout`; the job's own budget is
  `JOB_TIMEOUT_MS = 150_000`, set above the honest worst case because `withTimeout` cannot cancel
  the work it abandons (`server/INSIGHTS.md:51-61`).
- **Deterministic fact collection within 5,000 ms at 50,000 indexed files** - step 6 reads a fixed
  ~18-file list plus at most 15 excerpts and three facade reads; no filesystem walk of the clone.
  This is a designed number, not a measured one (see Risks).
- **Stored-tour read within 300 ms** - step 6's `read` is one primary-key select plus one
  `revparse`; `git.log` runs only when the sha has moved.
- **Row caps: 8 critical paths, 12 run steps, 10 reading entries, 5 first tasks** - enforced twice,
  in the model's schema (step 4 `schemas.ts`) and in the assembler (step 4 `verify.ts`), because a
  schema cap is a request and the assembler cap is the guarantee.
- **One generation in flight per repository** - step 7's in-memory single-flight map (AC-16).
- **Accessibility** - every copy control is a keyboard-operable button with an `aria-live`
  confirmation; every section status is conveyed by text as well as colour; the on-page navigation
  moves focus rather than scroll position (step 12; AC-26, AC-43, AC-58).
- **Viewport** - below 900 px the on-page navigation collapses to a jump control (step 12; AC-44).
- **i18n** - English only, every user string through next-intl; identifiers, paths, scripts,
  env-var names and route patterns are never translated (step 11).
- **Storage** - the tour document, its provenance and its usage record are stored; **no file body
  from the clone is persisted** (steps 3, 7).
- **Cost visibility** - provider, model, tokens in/out, cost and attempts on the page for every
  generation (steps 1, 7, 12; AC-52, AC-53).
- Security suspicions for `/security-review`, not judged here: the untrusted-wrapping of README,
  excerpts and issue text before assembly (step 4); the prose-path linker's URL construction
  (step 4); the `listIssues` label parameter reaching the GitHub API (step 2); and whether the
  fixed `FACT_FILES` list can be influenced by repository content (it cannot by construction, but
  that is the claim worth checking).

## Stop conditions

- If `pnpm db:generate` in step 3 asks an interactive question, stop and do not answer it - the
  migration was not additive. Re-check the schema edit.
- If `pnpm arch:check` reports a new violation in any of steps 4-8, stop and fix the placement.
  Never widen a rule or add an allowlist entry.
- If the model's structured schema in step 4 cannot be expressed without a union or a
  `z.discriminatedUnion`, stop - a `oneOf` JSON Schema degrades model output badly
  (`INSIGHTS.md:93-99`), and the fixed-five-keys design exists to avoid it.
- If satisfying any acceptance criterion turns out to need an `Onboarding` or `OnboardingSection`
  field this plan did not add, stop - a contract change must go back through step 1 and land in
  both `vendor/shared` copies at once.
- If `container.git.log(ref)` in step 6 turns out to be unbounded and slow on a real clone, stop
  and report the measurement rather than adding a GitHub API call to the read path - AC-47 has a
  documented no-number fallback.
- If step 10's route move breaks any e2e flow other than `06-onboarding.flow.json`, stop: another
  surface depends on `/onboarding` that this plan did not find.
- If a client test needs the real `mermaid` renderer to pass, stop - jsdom has no layout and the
  component is designed to render `null` on failure; assert the fallback, not the SVG.

## Acceptance criteria

- [ ] Both `vendor/shared` copies carry the same onboarding contract block and the same
      `listIssues` signature - verify: `grep -c "OnboardingSectionKind\|listIssues"` on the four
      files, equal non-zero counts (NOT `diff -q`: both files are pre-drifted,
      `.claude/repo-facts.md:76`)
- [ ] The generated migration contains only `ALTER TABLE "onboarding" ADD COLUMN` - verify: read
      the generated file, then `cd server && pnpm db:migrate`
- [ ] Fact collection reads `.env.example` names and no `.env` value; the budget ladder drops
      excerpts before the repo map; every drop branch in the verifier fires; a fact containing
      `</untrusted>` cannot close its block - verify:
      `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- [ ] One generation makes exactly one structured call, records attempts at most 3, provider, model,
      tokens and cost; a second concurrent generate is refused; a failed call persists a readable
      degraded tour with five sections; a retry replaces it - verify:
      `cd server && pnpm exec vitest run .it.test --no-file-parallelism` (then re-run the file
      alone and read its per-file line)
- [ ] A review run on a repository that has a tour produces a trace with no onboarding segment -
      verify: the AC-4 case in `onboarding.it.test.ts`
- [ ] The clone is untouched after generating, regenerating and reading - verify: the
      `git status --porcelain` assertion in `onboarding.it.test.ts`
- [ ] No new boundary violation - verify: `cd server && pnpm arch:check`
- [ ] `reviewer-core` is unchanged - verify: `git diff --stat -- reviewer-core` is empty, and
      `cd reviewer-core && npm test` is green
- [ ] The sidebar highlights Onboarding Tour on the tour page and nothing on `/repos/new`;
      `grep -rn 'push("/onboarding")' client/src` returns nothing (the `activeKeyFor` match at
      `helpers.ts:29` stays, by design) - verify:
      `cd client && pnpm test && pnpm lint` and `./scripts/e2e.sh`
- [ ] All five cards render for a tour with empty sections, collapse independently, the on-page
      navigation moves focus, a run step copies from the keyboard with an announcement, the cost
      line degrades to "cost unavailable", and no share control exists - verify:
      `cd client && pnpm test`
- [ ] A section body containing `<script>` and a `javascript:` link renders inert, and an
      unparseable diagram leaves the prose standing with no blank card - verify:
      `cd client && pnpm test`
- [ ] Whole-repo green - verify: `cd server && pnpm test`, `cd client && pnpm typecheck && pnpm lint
      && pnpm test`, `cd reviewer-core && npm test`, `./scripts/e2e.sh`

## Deliberately out of scope

- The dead `sync_to_folder` setting in `contracts/platform.ts`, whose UI copy promises this feature
  writes tours into the repository folder. The spec's open question 6 leaves it dead and
  unreferenced; the copy is now demonstrably wrong and removing it is its own change.
- A repository-wide route/endpoint read on the `repo-intel` facade (spec open question 3).
- Deepening `CLONE_DEPTH` to recover git churn for the ranking (spec non-goal).
- A sixth MCP tool, tour sharing, per-section regeneration, auto-generation, tour text in any
  prompt, and an in-product code viewer - all spec non-goals.
- Sorting/filtering the capped lists, a "start a review from this first task" action, an
  assembled-prompt inspector, and per-section confidence markers - all marked `open` in the spec's
  design review.
- Security judgement on the untrusted-wrapping chain and the prose-path linker - that is
  `/security-review`. Layering judgement on the new module - that is `architecture-reviewer`.

---

# Rationale

## Affected modules

| Package / module | What changes | Why |
| --- | --- | --- |
| `server/src/vendor/shared` + `client/src/vendor/shared` | `contracts/knowledge.ts` onboarding block rewritten; `adapters.ts` gains `listIssues` | Today a section is `{body, diagram, links}` with no rows, no status, no provenance and no usage; and no port can list issues by label |
| `server/src/db/schema/context.ts` | `head_sha` + `status` columns on the existing `onboarding` table | Staleness and degradation are the two cross-repository questions; the tour document stays in `json` |
| `server/src/modules/onboarding` (new) | The whole module: pure core, repository, service, routes, job | There is no module, no route and no page today |
| `server/src/adapters/github/octokit.ts`, `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts` | `listIssues`, `listFiles` and `log({maxCount})` implementations and mocks | A port method without both is a partial port; `listFiles` is the no-graph fallback's only possible data source |
| `server/src/platform/jobs.ts` | `register`/`enqueue` accept a per-kind `retries`; onboarding registers at `retries: 0` | The runner retries every handler twice by default, which would re-issue the model call and break AC-12 |
| `server/src/platform/prompt-log.ts` | `call` union gains `'onboarding'` | It is typed `'intent' \| 'review'` and would not compile |
| `server/src/prompts/onboarding.system.md` | Retargeted from `routes_and_apis` + a free section list to the five fixed sections | Shipping it unchanged asks the model for a section the page cannot render |
| `server/src/modules/index.ts` | One import, one entry | Static module registry |
| `client/src/app/repos/[repoId]/onboarding` (new), `client/src/lib/hooks/onboarding.ts` (new), `client/messages/en/onboarding.json` | The page, its hooks, its copy | AC-2, AC-17..AC-63 |
| `client/src/app/onboarding` to `client/src/app/repos/new` | Route move plus five call sites | AC-3 |
| `client/src/vendor/ui/nav.ts` | Two data lines | The one sanctioned exception to the vendored-UI freeze |
| `e2e/specs` | One amended flow, one new flow | The clone-less states are the only deterministic ones |
| `reviewer-core` | **Nothing** | It is not involved; only `wrapUntrusted` is imported |

## Verified facts this plan rests on

| Fact | Evidence |
| --- | --- |
| The `onboarding` table today is `repoId` (PK, cascade), `json`, `generatedAt` - nothing else | `server/src/db/schema/context.ts:120-126` |
| `OnboardingSection` today is `{kind, title, body, diagram, links}` with `kind: z.string()` | `server/src/vendor/shared/contracts/knowledge.ts:35-47` |
| The pre-drifted contract copies are `adapters.ts`, `contracts/eval-ci.ts` and `contracts/productionize.ts` - THREE files, not four. `contracts/knowledge.ts` is currently identical between the copies, so step 1 can and does verify with `diff -q`. Root `INSIGHTS.md:43-50` is stale on this point | `.claude/repo-facts.md:76`; `diff` of the two `knowledge.ts` copies is empty (corrected by cross-model review) |
| `GitHubClient` has `getIssue(repo, n)` and **no** list-by-label method | `server/src/vendor/shared/adapters.ts:143-167` |
| The client copy also declares `GitHubClient` and `IssueMeta`, so the port change lands in both | `client/src/vendor/shared/adapters.ts:5,122,135` |
| `ContainerOverrides.github` and `Container.github()` already exist; the port change needs no container edit | `server/src/platform/container.ts:44,159-166` |
| A missing `GITHUB_TOKEN` makes `container.github()` throw `ConfigError`, so `issues_unavailable` is a catch, not a null check | `server/src/platform/container.ts:162-163` |
| `IssueMeta` is `{number, title, body, state}` | `server/src/vendor/shared/contracts/platform.ts:213-219` |
| `getTopFilesByRank` already applies `isJunkPath` and an `exclude` list, and returns `[]` when repo-intel is off | `server/src/modules/repo-intel/service.ts:687-708` |
| `getCriticalPaths` returns dependency chains from the top-ranked roots, `[]` when there are no edges | `server/src/modules/repo-intel/service.ts:712-753` |
| `isJunkPath` is a module-local helper in `repo-intel/service.ts`, and `no-cross-module-imports` exempts only `service.ts`/`types.ts`/`constants.ts` | `server/src/modules/repo-intel/service.ts:762-767`; `server/.dependency-cruiser.cjs:33-57` |
| Array-returning facade reads return `[]` when degraded; status is always observable via `getIndexState` | `server/src/modules/repo-intel/types.ts:14-21` |
| `IndexState` carries `status`, `filesIndexed`, `filesSkipped`, `lastIndexedSha` | `server/src/modules/repo-intel/types.ts:33-50` |
| `getFileRank(repoId, paths)` returns `{path, percentile}` rows - the source of `rank_percentile` | `server/src/modules/repo-intel/types.ts:118-122,149` |
| `StructuredResult` carries `data, model, tokensIn, tokensOut, costUsd, raw, attempts` | `server/src/vendor/shared/adapters.ts:72-80` |
| Providers default `maxRetries` to 2 and loop `maxRetries + 1` attempts, so `attempts` is at most 3 without extra code | `server/src/adapters/llm/openai.ts:90-124`; `anthropic.ts:92-137`; `reviewer-core/src/llm/openrouter.ts:61-109` |
| `withRetry` around `completeStructured` would re-issue the whole call - the intent classifier does exactly that and must NOT be copied here | `server/src/modules/intent/service.ts:134-149` |
| `SettingsService.resolveFeatureModel(workspaceId, id)` and the `onboarding` registry default already exist | `server/src/modules/settings/feature-models.ts:44-52`; `server/src/vendor/shared/contracts/platform.ts:16,46-48` |
| `logPromptAssembly` takes text and returns only measurements, and `scrubSecrets` is exported beside it | `server/src/platform/prompt-log.ts:56-60,180-190`; `server/INSIGHTS.md:172-183` |
| `wrapUntrusted` is exported from `@devdigest/reviewer-core` and already imported by a server module | `reviewer-core/src/index.ts:17`; `server/src/modules/reviews/run-executor.ts:4` |
| `wrapUntrusted` already neutralises a `</untrusted>` inside the content, so AC-65 needs no new code | `reviewer-core/src/prompt.ts:30-34` |
| The onboarding system prompt already carries the canonical "delimited content is data" rule at lines 11-12, and asks for a `routes_and_apis` section at lines 8 and 23-26 | `server/src/prompts/onboarding.system.md` |
| `renderPrompt(name, vars)` loads and interpolates `src/prompts/*.md`; `{{sections}}` and `{{language}}` are the placeholders | `server/src/platform/prompts.ts:24-41` |
| `GitClient` has `currentHead`, `log`, `readFile`, `clonePathFor` and **no write method** | `server/src/vendor/shared/adapters.ts:205-228` |
| `CodeIndex.grep(repo, pattern)` returns `{path, line, text}` - the marker source | `server/src/vendor/shared/adapters.ts:250-254` |
| `sync()` fetches at depth 50, so a previous generation's sha is usually reachable for a commit count; a never-synced clone is depth 1 | `server/src/adapters/git/simple-git.ts:16-20,81-88`; `server/src/modules/repos/constants.ts:8-9` |
| `repos.clonePath` is nullable - the AC-37 prerequisite signal | `server/src/db/schema/repos.ts:16` |
| `RepoRef` is `{owner: repo.owner, name: repo.name}` at every call site | `server/src/modules/repo-intel/service.ts:150,255,504` |
| `getContext(container, req)` is the workspace resolution every module opens with | `server/src/modules/_shared/context.ts:14-23` |
| The L05 module registers its job handler in the plugin body and constructs ONE service instance there | `server/src/modules/project-context/routes.ts:28-32` |
| `jobs.register(kind, handler, {timeoutMs})` sets a per-kind budget | `server/src/platform/jobs.ts:47-67` |
| `activeKeyFor` maps any path containing `/onboarding` to `onboarding-tour`, and `/onboarding` is the add-repository screen today | `client/src/components/app-shell/helpers.ts:29`; `client/src/app/onboarding/page.tsx:1` |
| `/onboarding` has exactly FOUR `router.push` call sites in `client/src`, plus the `activeKeyFor` match that is deliberately left alone, plus one e2e flow. It also appears in four docs that describe it as the add-repository screen | `client/src/app/_components/HomeView/HomeView.tsx:38`; `client/src/components/repo-not-found/RepoNotFound.tsx:20`; `client/src/components/app-shell/hooks/useShellContext.ts:39,52`; `e2e/specs/06-onboarding.flow.json`; `client/AGENTS.md`, `client/INSIGHTS.md`, `client/README.md`, `e2e/README.md` (docs found by cross-model review) |
| `JobRunner.enqueue` wraps EVERY handler in `withRetry(..., { retries: this.retries })` and the container constructs it with the default of 2; `register` accepts only `timeoutMs` today | `server/src/platform/jobs.ts:53,69-108`; `server/src/platform/container.ts:88` |
| `PromptLogMeta.call` and `PromptLogRecord.call` are typed `'intent' \| 'review'`, so `'onboarding'` does not compile | `server/src/platform/prompt-log.ts:77,99` |
| No port can list a clone's files: `GitClient` has no listing method, `CodeIndex` has `grep/symbols/references`, and `getRepoMap` degrades to empty under exactly the unindexed condition the heuristic exists for | `server/src/vendor/shared/adapters.ts:205-228,250-254`; `server/src/modules/repo-intel/types.ts:14-21` |
| `import type` is exempt from `no-cross-module-imports` repo-wide via `dependencyTypesNot: ['type-only']`, and the rule's own comment sanctions constructing another module's SERVICE - the precedent is `intent/service.ts:10,108` | `server/.dependency-cruiser.cjs:33-57` |
| There is no `src/app/repos/layout.tsx` and no `[repoId]/layout.tsx`, so a static `repos/new` segment adds no layout risk | `find client/src/app -name layout.tsx` |
| `shell.json` already carries `"onboarding-tour": "Onboarding Tour"`; `nav.ts` WORKSPACE has `pulls` then `context`; `g o` is unused | `client/messages/en/shell.json:19`; `client/src/vendor/ui/nav.ts:21-27,58-68` |
| `client/messages/en/onboarding.json` promises "overview, architecture, key modules, getting started, and conventions & gotchas" - a different five | `client/messages/en/onboarding.json` |
| `MermaidDiagram` validates with `mermaid.parse({suppressErrors})` and renders `null` on failure | `client/src/components/mermaid-diagram/MermaidDiagram.tsx:9-15,55-60` |
| `mermaid` is a client dependency only; neither `server` nor `reviewer-core` has it | `grep mermaid */package.json` |
| `DocMarkdown` escapes raw HTML and narrows the URL allowlist to `http`/`https` | `client/src/components/doc-markdown/DocMarkdown.tsx:1-45` |
| `githubBlobUrl(fullName, sha, file, start?, end?)` is the existing permalink builder | `client/src/lib/github-urls.ts:23-37` |
| Hooks live in `src/lib/hooks/*` with their keys, barrelled in `index.ts` | `client/src/lib/hooks/project-context.ts:14-58`; `client/src/lib/hooks/index.ts` |
| The seeded repo has `clonePath: null` and `scripts/e2e.sh` uses an ephemeral Postgres | `server/src/db/seed.ts`; L05's plan and flow 11 rest on the same fact |
| `MockGitClient.readFile` returns `''` for a missing path instead of rejecting | `server/src/adapters/mocks.ts`; `server/INSIGHTS.md:280-283` |

## Traceability

Every one of the spec's 70 criteria, cited verbatim by id.

| Requirement | Step(s) | Acceptance criterion |
| --- | --- | --- |
| AC-1 | 3 (already provided: `onboarding.repoId` PK, `server/src/db/schema/context.ts:121-123`), 5 | One row per repository; upsert asserted in `onboarding.it.test.ts` |
| AC-2 | 12 | Sidebar order asserted in `./scripts/e2e.sh` flow 12 |
| AC-3 | 10, 12 | `grep -rn '"/onboarding"' client/src` empty + nav highlight asserted in flow 12 |
| AC-4 | constructive (nothing imports `modules/onboarding`), 9 | Review trace lists no onboarding segment (integration) |
| AC-5 | 6 | `head_sha` recorded first (integration) |
| AC-6 | 4, 6 | Fact extraction unit tests |
| AC-7 | 4, 6 | `.env.example` names-only unit test; no `.env` in `FACT_FILES` |
| AC-8 | 4, 6 | Reading-path order equals `getTopFilesByRank` order (unit + integration) |
| AC-9 | 4, 6 | Excerpt cap unit test |
| AC-10 | 4, 6, 12 | `excerpts_used === 0` above 50,000 (integration) + header (client test) |
| AC-11 | 4 | Budget-ladder unit test |
| AC-12 | 7, 8, 9 | Counting LLM stub asserts exactly one call, including after a post-call throw (the job runner must not retry) |
| AC-13 | 7, 9 | `attempts` at most 3 in the usage record (integration) |
| AC-14 | 7, 9 | Usage names the model chosen in Settings (integration) |
| AC-15 | 7, 9 | Non-resolving stub produces degraded `model_failed` (integration) |
| AC-16 | 7, 8, 12 | Second generate refused, call count still 1 (integration) |
| AC-17 | 1, 4, 7, 12 | Fixed-five-key draft schema (unit) + page order (client test) |
| AC-18 | 4, 12 | Skeleton always five sections (unit) + client test |
| AC-19 | 4, 11, 12 | Empty-line copy per section (unit + client test) |
| AC-20 | 4, 7 | Only `architecture` carries `diagram` in the draft schema (unit) |
| AC-21 | 4, 12 | `guardDiagram` rejection table (unit) + `MermaidDiagram` null fallback (client test) |
| AC-22 | 4, 7 | 8-row cap (unit) |
| AC-23 | 6, 7 | Rows restricted to the `getCriticalPaths` candidate set (unit + integration) |
| AC-24 | 4, 7 | 12-step cap and re-numbering (unit) |
| AC-25 | 4, 7 | Step dropped when its source is absent (unit) |
| AC-26 | 12 | Keyboard-only copy with announcement (client test) |
| AC-27 | 4, 7 | 10-entry cap (unit) |
| AC-28 | 4, 7 | 5-task cap, path+line or issue number (unit) |
| AC-29 | 2, 6, 7, 9 | Markers from `codeIndex.grep` + `listIssues` only (unit + integration) |
| AC-30 | 4, 11, 12 | Empty First tasks names both sources (unit + client test) |
| AC-31 | 6, 7, 9 | Throwing `listIssues` produces `issues_unavailable` (integration) |
| AC-32 | 4, 7 | Verification before persist (unit + integration) |
| AC-33 | 4, 7 | `dropped_rows` counted (unit) |
| AC-34 | 4, 12 | Prose linker leaves absent paths unlinked (unit) |
| AC-35 | 4, 12 | `githubBlobUrl` pinned to `head_sha` (client test) |
| AC-36 | constructive (no viewer route exists), 12 | Every file link targets github.com (client test) |
| AC-37 | 6, 12, 13 | Prerequisite state, no Generate control (`./scripts/e2e.sh`) |
| AC-38 | 12 | Generate call to action (client test) |
| AC-39 | 6, 7, 11, 12 | Phase + five headings during a generation (client test) |
| AC-40 | 6, 12 | "Generated from index of N files" (client test) |
| AC-41 | 6, 12 | "generated at `abc1234`" (client test) |
| AC-42 | 12 | Collapsing one card leaves four expanded (client test) |
| AC-43 | 12 | On-page navigation moves focus (client test) |
| AC-44 | 12 | Jump control below 900 px (client test) |
| AC-45 | 12 | Copy as Markdown (client test) |
| AC-46 | 12 | Header carries no share control (client test) |
| AC-47 | 6, 12 | `commits_behind` from `git.log`, with the no-number fallback (integration + client test) |
| AC-48 | constructive (no module enqueues a generation), 9 | `generated_at` unchanged after resync + reindex (integration) |
| AC-49 | 5, 7, 9 | Regenerate replaces the row (integration) |
| AC-50 | 7, 12 | Write only on completion; old sections still rendered (client test) |
| AC-51 | 3 (already provided: `onDelete: 'cascade'`, `server/src/db/schema/context.ts:121-123`), 9 | Row gone after repo delete (integration) |
| AC-52 | 1, 7, 9 | Usage record complete (integration) |
| AC-53 | 12 | "1 call · N in / N out · $X" (client test) |
| AC-54 | 1, 11, 12 | Null cost produces "cost unavailable", never zero (client test) |
| AC-55 | 7 | One structured log line, metadata only (structural: `logPromptAssembly` takes text, returns measurements) |
| AC-56 | 6, 7, 9 | Reasons recorded for absent/partial/failed index (integration) |
| AC-57 | 2, 4, 6, 9 | Heuristic candidates over `GitClient.listFiles` populate both sections without a graph (unit + integration) |
| AC-58 | 1, 4, 12 | `no_graph` status per section (unit + client test) |
| AC-59 | 7, 12 | Each reason once in the header (client test) |
| AC-60 | 4, 7, 12 | Skeleton + Retry after a failed call (integration + client test) |
| AC-61 | 7, 9 | Degraded tour survives a reload (integration) |
| AC-62 | 5, 7, 9 | Successful retry replaces the degraded tour (integration) |
| AC-63 | 6, 7, 12 | No error page for no-index + no-issues + failed model (integration + client test) |
| AC-64 | 4 | Every fact block `wrapUntrusted`-wrapped (unit) |
| AC-65 | 4 (already provided: `reviewer-core/src/prompt.ts:30-34`) | A fact containing `</untrusted>` cannot close its block (unit) |
| AC-66 | 12 (already provided: `client/src/components/doc-markdown/DocMarkdown.tsx:1-45`) | `<script>` inert, `javascript:` stripped (client test) |
| AC-67 | 8 | Route schemas carry `IdParams` and nothing path-shaped (code + `pnpm arch:check`) |
| AC-68 | constructive (`GitClient` has no write method, `server/src/vendor/shared/adapters.ts:205-228`), 9 | `git status --porcelain` empty (integration) |
| AC-69 | 6, 7, 8, 9 | Cross-workspace repo id 404s on both routes (integration) |
| AC-70 | 7 | Provider error text passed through `scrubSecrets` (code + unit) |
| Default: add-repository screen renamed, not the tour | 10 | `grep -rn '"/onboarding"' client/src` empty; `./scripts/e2e.sh` |
| Default: structural mermaid guard server-side, parse gate client-side | 4, 12 | `guardDiagram` table test + `MermaidDiagram` null fallback |
| Default: `commits_behind` is null when the sha is unreachable | 6, 12 | Head-has-moved wording (client test) |
| Default: no repository-wide route/endpoint facade read (spec open question 3) | - | Nothing added to `RepoIntel` |

## Lessons from INSIGHTS.md applied

- **Grep for the lesson's nouns across all three packages before planning** - `INSIGHTS.md:10-29`.
  Done: the prompt, contracts, table, `FEATURE_MODELS` entry, nav label, i18n file and the two
  facade reads all already exist, and two of them (`onboarding.system.md`,
  `onboarding.json`) describe a **different** feature and are corrected by steps 4 and 11.
- **"The DB schema already contains EVERY table" is not a reason to skip checking** -
  `server/INSIGHTS.md:92-101`. Checked: the `onboarding` table exists but carries no provenance,
  hence step 3.
- **Any table with a `running` status needs a boot reaper; budget the job timeout per kind above
  the honest worst case** - `server/INSIGHTS.md:51-61`. Shapes step 7's in-memory single-flight
  guard and `JOB_TIMEOUT_MS = 150_000` against a 90 s model ceiling.
- **A service must build its own repository from `container.db`** - `server/INSIGHTS.md:200-210`.
  Shapes step 6's constructor and forces every pure rule into `facts/candidates/verify/skeleton`.
- **A table without `workspace_id` gets tenancy from the layer above, and the repository doc
  comment must say so** - `server/INSIGHTS.md:226-232`. Step 5 says it.
- **When a feature's output is fed to a model AND rendered to a user, prefer the shared contract as
  the LLM schema - unless what the model returns is not what is persisted** -
  `server/INSIGHTS.md:233-239`. Here it is not (rows are verified, ordinals and percentiles are
  ours, provenance and usage are ours), so step 4 takes the documented conventions carve-out and
  keeps a module-local draft schema, saying why in the file.
- **Keep an LLM schema flat; a `discriminatedUnion` emits `oneOf`, which models handle badly** -
  `INSIGHTS.md:93-99`. The draft is five fixed keys; the union lives only in the persisted
  contract, which no model sees.
- **`MockGitClient.readFile` returns `''` for a missing path** - `server/INSIGHTS.md:280-283`.
  Every "file absent" branch in steps 4, 6 and 9 treats blank as absent.
- **An integration test that omits `secrets: new MockSecretsProvider({})` spends real money** -
  `server/INSIGHTS.md:103-114`. Step 9 passes it.
- **A green integration lane is not evidence a file ran; and never use `-t` to prove a deliberate
  failure** - `server/INSIGHTS.md:131-150`. Step 9's verify says re-run the file alone.
- **`drizzle-kit generate` goes interactive and hangs on piped stdin** - `server/INSIGHTS.md:272-279`.
  Step 3 is additive-only and forbids the pipe.
- **Prompt observability splits by destination: logs get metadata, the DB gets content** -
  `server/INSIGHTS.md:172-183`. Step 7 uses `logPromptAssembly` and stores nothing but the tour.
- **Do not add a second injection-guard restatement beside a new untrusted slot** -
  `reviewer-core/INSIGHTS.md:31-35`. Step 4 keeps the prompt's existing SECURITY paragraph
  verbatim and adds none.
- **Adding a top-level page to the sidebar requires editing vendored `nav.ts` - the one sanctioned,
  data-only exception; everything else derives from the entry** - `client/INSIGHTS.md:88-99`.
  Step 12 takes exactly that exception, and confirms `activeKeyFor` and `shell.json` are already
  pre-wired for the `onboarding-tour` key.
- **Anything the root layout reaches without a `"use client"` boundary is SSR'd for every route,
  and `pnpm build` does not catch a bad import - only e2e does** - `client/INSIGHTS.md:38-47`.
  Step 12's "does not" names it.
- **Split by state with early returns, not stacked ternaries** - skill `frontend-ui-architecture`,
  reinforced by `client/INSIGHTS.md:126-134` on holding content steady during a refetch, which is
  why step 12 keeps the previous tour rendered during a regeneration.
- **`e2e/specs/04-pr-findings.flow.json` asserts a literal substring - append, never replace** -
  `client/INSIGHTS.md:112-115`.
- **The contract copies already drift in four files; scope `diff -q` to touched files** -
  `INSIGHTS.md:43-50`. Both files this plan touches are on that list, so steps 1 and 2 verify with
  a targeted grep instead.
- **`CLAUDE.md` is a symlink to `AGENTS.md` - one edit, not two** - `INSIGHTS.md:56-64`. Step 14.
- **Default shell node is v17** - `INSIGHTS.md:122-126`. Prefix every command.

## Skills applied while planning

| Skill | How it was loaded | What it constrained in this plan |
| --- | --- | --- |
| `onion-architecture` | preloaded | Placed the tour's prompt assembly in `modules/onboarding/prompt.ts` rather than `reviewer-core`; forced `listIssues` to land as interface + adapter + mock in one step (rule 4); kept `service.ts` free of `node:fs` and of concrete clients; kept the drizzle query builder inside `repository.ts`; forced the junk-path filter to be obtained by consuming `getTopFilesByRank` because `isJunkPath` is not an exempt cross-module import |
| `frontend-ui-architecture` | preloaded | Page logic in a colocated `_components/OnboardingTourView/`, not in `page.tsx`; data only through `src/lib/hooks/onboarding.ts` with its keys in the hook file; states as early returns rather than stacked ternaries; the tour's Markdown renderer reused from `src/components/doc-markdown` rather than forked into the feature |
| `next-best-practices` | preloaded | `layout.tsx` mounts `ShellLayout` once for the segment instead of the page rendering its own shell; the page is a `"use client"` island reading `useParams`; the route move to `/repos/new` uses a static segment, which takes precedence over the sibling `[repoId]` dynamic segment |
| `postgresql-table-design` | preloaded | Kept the tour document in `jsonb` and promoted only the two scalar values with a real access path (`head_sha`, `status`) to columns; defaulted `status` so the additive migration cannot fail on an existing row; declined a GIN index because the only access path is the primary key |
| `zod` (routed, not invoked) | routed to steps 1 and 4 | Two schemas: a flat fixed-key draft for the model, a discriminated union for persistence; `sections` deliberately NOT length-constrained on the read path so a malformed stored document cannot become an error page |

No skill was invoked with the Skill tool: the four preloaded ones plus the routing table in `.claude/skills/README.md` settled every placement decision this plan makes.

## Recommendations

These are proposals, not decisions - the plan above builds what the spec asks.

- **Delete `sync_to_folder` from `contracts/platform.ts` rather than leaving it dead.**
  Its UI copy promises that "onboarding tours and digests are written to the repo folder".
  After L06 ships, that sentence is demonstrably false in the product, and a setting that promises a behaviour the code refuses is worse than no setting.
  The spec's open question 6 leaves it dead; a one-line removal in both contract copies plus its Settings row would close it.
- **Consider surfacing `dropped_rows` / `dropped_steps` in the header, not only in the document.**
  The plan stores both.
  A user who sees "3 rows dropped because the model named files that do not exist" learns something true about the model they are paying for, and it makes the grounding gate visible rather than silent.
  Not required by any AC.
- ~~Consider capping `container.git.log` with a `maxCount` option on the port.~~
  **Accepted after cross-model review and folded into step 2** - it touches the same port the step
  already changes, so deferring it was arbitrary.
- **Consider making the five section titles server-side constants rather than model output.**
  The draft schema lets the model write each `title`.
  Since the kinds and their order are fixed and the page nav is written against them, a model-authored title can only ever differ from the navigation label.
  Taking `title` out of the draft would remove one hallucination surface and shrink the schema.

## Risks and forks

- **The `/onboarding` rename is the larger of the two fixes for AC-3.**
  The one-line alternative - tightening `activeKeyFor` to `/^\/repos\/[^/]+\/onboarding/` and leaving the add-repository screen where it is - also satisfies AC-3 and touches one file instead of seven.
  It was rejected because it leaves two unrelated features sharing the word "onboarding" in the URL space forever, and makes `onboarding` the only entry in `activeKeyFor`'s substring table that needs a special qualifier - the next repo-scoped route under `/onboarding/*` would re-break it.
  The cost is five call sites and one e2e flow, all mechanical.
  **If the reviewer prefers the cheap fix, step 10 is replaced by a two-line edit to `helpers.ts` and everything else in this plan is unchanged.**
- **Server-side Mermaid validation is structural, not a real parse.**
  AC-21's flowchart says "parses?" before persisting.
  A true parse needs `mermaid` plus a DOM, i.e. `jsdom` in the server process for one boolean.
  The plan uses the same keyword/shape guard the client already applies as its first gate, and relies on the client's real `mermaid.parse` as the second.
  The observable in AC-21 ("renders text and no empty diagram frame") holds either way; what does not hold is "the persisted document contains only parseable diagrams".
  Worth an explicit accept/reject.
- **"N commits behind" is not always computable.**
  A depth-1 clone that has never been resynced has one commit of history, so the tour's `head_sha` is unreachable and no number exists.
  The plan degrades to naming both shas.
  The alternative - a GitHub `compare` call - puts a network round trip on a read path with a 300 ms budget and fails without a token.
- **The model selects rows from candidate sets, which bounds what a tour can say.**
  Critical-path and reading-path rows are restricted to `getCriticalPaths` / `getTopFilesByRank` output, which is what makes AC-8 and AC-23 hold by construction.
  The consequence is that a genuinely important file the graph missed cannot appear.
  Run steps are deliberately NOT restricted this way - the model may quote a command from a README excerpt as long as it cites an existing source file - because AC-25 defines the check as "the cited source exists", not "the command came from a candidate list".
- **The 30,000-token ceiling and the 90-second wall clock were chosen, not measured** (the spec says so in its open question 2).
  The first very large repository will show whether the 50,000-indexed-file excerpt cutoff is the right boundary.
  The plan makes all of them constants in one file so a measurement can move them without touching logic.
- **The 5,000 ms fact-collection budget is unmeasured.**
  It covers ~18 small file reads, one ripgrep pass, one GitHub call and three facade reads.
  The ripgrep pass over a very large clone is the one that could blow it; if it does, the fix is a `--max-count` on the marker grep, not a narrower fact set.
- **A first task can only be found in the top `MAX_RANKED_FILES` files.**
  The marker grep is filtered to the candidate set so junk paths and vendored dependencies cannot
  produce tasks, and the price is that a genuine `TODO` in a file ranked below 200 is invisible.
  Raising the constant is free; removing the filter is not, because it would put `node_modules`
  markers in front of a newcomer.
- **`repo_too_large` marks an otherwise perfect tour "degraded".**
  The spec's enum and lifecycle diagram both put it there, so the plan follows.
  A user with a healthy 60,000-file repository will see a degraded badge on a good tour, which reads as a defect and is not one.
- **The single-flight guard is per process.**
  Two API processes would each allow a generation.
  There is one process today (`JobRunner` is in-process, `server/src/platform/jobs.ts:30-56`), and a DB-level guard would need a `running` row, which needs a boot reaper.
  Named so the tradeoff is visible rather than assumed.
- **`contracts/knowledge.ts` already drifts between the two copies.**
  Step 1 rewrites the same block in both, but the file as a whole will still not be `diff`-clean, so the verification is a targeted grep.
  A reviewer looking for a clean `diff -q` will find red and it will not be this change's fault.

## Alternatives rejected

- **Putting the tour's prompt assembly in `reviewer-core`.**
  `reviewer-core` is the PR-review domain, consumed by both the server and the CI agent-runner; the CI runner has no use for a tour.
  Adding a second, unrelated domain to a package whose purity rules exist to protect the review engine buys nothing and costs a permanent coupling.
  The spec's own layering constraint says the same.
  Borrowing `wrapUntrusted` is a one-symbol import with an existing precedent at `run-executor.ts:4`.
- **Storing the whole tour in `json` with no new columns.**
  Defensible - nothing filters on those fields today - but the table already treats provenance as a column (`generated_at`), so following that shape is consistency rather than addition, and "which repositories have a stale or degraded tour" stops being a jsonb scan.
- **A `generating` status column on `onboarding`.**
  Any table with a `running` status needs a boot reaper, and a crashed generation would leave a row that permanently blocks the feature (`server/INSIGHTS.md:51-61`).
  An in-memory map dies with the process, which is the correct behaviour for an in-flight guard.
- **SSE for the generating state.**
  The run bus exists for review runs and carries a whole subscription surface.
  AC-39 needs a phase name and five headings; a 1.5 s poll on an already cached query is the smaller mechanism.
- **Letting the model author the persisted rows verbatim and verifying afterwards only.**
  Post-hoc verification alone cannot satisfy AC-8 ("order matches `getTopFilesByRank`") or AC-23 ("entries all appear in `getCriticalPaths` output") - both are membership and ordering properties, not existence properties.
  Building rows from our candidate sets makes them true by construction; the verification pass then only has to catch prose paths, links and run-step sources.
- **A `z.discriminatedUnion` in the model's structured schema.**
  It emits a `oneOf` JSON Schema, which models handle far worse (`INSIGHTS.md:93-99`).
  Five fixed keys also make "the model returned four sections, or six" a repair against a known shape rather than a counting problem.
- **Two model calls - one to draft, one to repair the grounding.**
  Directly contradicts AC-12 and the lesson this feature exists to demonstrate.
- **A new `RepoIntel` facade read for repository-wide routes and endpoints** (spec open question 3).
  `getBlastRadius` is diff-scoped, so a repository-wide read means new indexing work in `repo-intel` for a section the spec marks optional.
- **Adding `mermaid` + `jsdom` to the server to parse diagrams authoritatively.**
  A DOM emulator in the API process for one boolean, when the client already parses authoritatively and degrades correctly.
- **A separate `onboarding_generations` history table.**
  The spec holds one tour per repository and shows one usage record; history is a feature nobody asked for and a second table to cascade.

## Cross-model review

This plan was reviewed before implementation by an independent agent on a different model, tasked
with attacking it: verify every row of the Verified-facts table against the code, adjudicate the
declared `/onboarding` fork, test the four "constructive" AC arguments, and check the placements
against `server/.dependency-cruiser.cjs`.

Three blocking defects were found, and all three are folded into the plan above.

| Finding | Severity | Where it landed |
| --- | --- | --- |
| `jobs.enqueue` was never called by any step, so the job machinery was dead weight; and once enqueued, `JobRunner` wraps every handler in `withRetry` at `retries: 2` by default, which would re-issue the model call and break AC-12 | blocking | Step 7's explicit async-execution paragraph, the per-kind `retries` override on `server/src/platform/jobs.ts`, `retries: 0` at registration, step 8's enqueue, and a new step 9 regression test for a post-call throw |
| `heuristicCandidates` - the whole AC-57/AC-58 no-graph fallback - had no data source: no port can list a clone's files | blocking | Step 2 gains `GitClient.listFiles` as a complete port change; step 4 and step 6 consume it |
| `logPromptAssembly`'s `call` field is typed `'intent' \| 'review'`, so step 7 would not have compiled | blocking | Step 7 widens both unions and takes `prompt-log.ts` into its file list |
| "`contracts/knowledge.ts` is pre-drifted" was false - the two copies are identical today, and the weaker grep verification it justified was a downgrade | should-fix | Step 1 verifies with `diff -q`; the constraint and the fact row are corrected; only `adapters.ts` keeps the grep |
| `getFileRank` was cited as the source of `rank_percentile` but never called, so the field would have persisted `null` forever | should-fix | Step 6's graph phase calls it |
| `prompt.ts` was declared pure while AC-11's budget ladder needs a per-rung `getRepoMap` re-fetch | should-fix | Step 4 states the ladder lives in the service and `assemblePrompt` stays pure over what it is handed |
| The marker grep was silently capped to the top 30 ranked files, hiding valid first tasks | should-fix | `MAX_RANKED_FILES = 200`, the limitation stated in step 6 and in Risks |
| `container.git.log` had no bound, on a 300 ms read path | should-fix | Folded from a Recommendation into step 2's port change |
| Four docs describe `/onboarding` as the add-repository screen and would go stale on the move | should-fix | Added to step 10's file list |
| "five call sites" was four pushes plus the deliberately unchanged `activeKeyFor` line | nit | Corrected in step 10 and in the fact table |
| The `links` field was dropped by `verify.ts` and rendered by step 12 without the draft schema ever asking for it | nit | Step 4's `schemas.ts` declares it |

The review confirmed as sound: `wrapUntrusted` genuinely neutralises a nested closing delimiter by
`replaceAll`, so AC-65 needs no new code; all three providers bound `attempts` at
`maxRetries + 1`, so AC-13 needs none either; `getTopFilesByRank` genuinely applies `isJunkPath`
and degrades to `[]`; `container.github()` genuinely throws `ConfigError` without a token;
`MockGitClient.readFile` genuinely returns `''`; all four constructive AC arguments rest on true
premises; and no placement in the plan violates any depcruise rule - the `SettingsService`
construction is explicitly sanctioned by the rule's own comment, `import type` is exempt
repo-wide, and the `reviewer-core` import is unconstrained.

On the fork, the reviewer agreed with moving the add-repository screen to `/repos/new`, but for a
different reason than the plan gave: not that a future `/onboarding/*` route would re-break a
regex, but that once "Onboarding Tour" is a prominent nav item, `/onboarding` means something
different to a user than the screen currently living there. The plan's own reason is speculative;
this one is not. The move stands, with the doc drift above folded in as its real cost.
