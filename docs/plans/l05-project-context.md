# Plan: L05 Project Context - browse repo docs, attach them to agents and skills, inject them into review prompts

Spec: `docs/specs/L05-project-context.md` (status: approved, 51 EARS criteria).

## Understanding

Build the feature `docs/specs/L05-project-context.md` specifies: discover Markdown under four
roots in a repository's clone, browse and read it in the product, attach documents to an agent
and to a skill in an explicit order, account for their token cost, inject their bodies into the
review prompt's existing `## Project context` slot, and record what was read in the run trace.
The engine seam already exists and is unfed - `run-executor.ts:389` hardcodes `specs_read: []`
and never passes `specs`.

Out of scope, per the spec's non-goals: editing/creating/uploading/deleting documents, any git
write, embeddings or chunking, per-repo configurable globs, a coverage score, versioning
attachments, a new MCP tool, and injecting documents into non-review LLM calls.

## Architectural constraints

- Routes are transport only: zod schemas + one service call, no drizzle, no `src/db` - rule
  `routes-are-transport-only`, `server/.dependency-cruiser.cjs:9-17`; skill `onion-architecture`.
- Only `repository.ts` imports the drizzle query builder - rule `queries-live-in-repositories`,
  `.dependency-cruiser.cjs:19-31`.
- Cross-module reads go through a Container getter (`container.reposRepo`, `container.agentsRepo`)
  or by constructing another module's `service.ts` - the documented composition seam, exempted at
  `.dependency-cruiser.cjs:48-52`; precedent `run-executor.ts:19` (`IntentService`). Importing
  another module's `constants.ts` is also exempt.
- A service MUST build its own repository from `container.db`, not from a container getter -
  services are constructed as `new XService({ db } as unknown as Container)` in tests
  (`server/INSIGHTS.md:170-180`; precedent `skills/service.ts:42-47`). Methods that DO need a real
  Container (git, tokenizer, jobs) must be kept isolated from the module's own CRUD.
- `reviewer-core` stays pure: it keeps taking `specs: string[]`. No path, repo id or descriptor
  reaches it - rules `core-has-no-io`, `core-has-no-db-or-server`.
- Do NOT add a second injection-guard sentence next to the specs slot -
  `reviewer-core/INSIGHTS.md:31-35`: one canonical rule is harder to talk around than two.
- Direct `node:fs` is allowed in a module's non-service pipeline file, never in `service.ts` -
  precedent `repo-intel/pipeline/walk.ts:23-31,55-122`; no depcruise rule covers `node:fs`.
  The spec's own participants table assigns the port `clonePathFor` for the scan and `readFile`
  for a body.
- Contract changes land in BOTH `server/src/vendor/shared` (canonical) and
  `client/src/vendor/shared` in ONE step. Verify with `diff -q` on the touched files only - a
  whole-tree diff is always red (`INSIGHTS.md:46-50`).
- The shared barrel is extended with new files, never edited in place
  (`server/src/vendor/shared/index.ts:14-15`); one `export *` line is the exception.
- Migration must be strictly ADDITIVE (new tables only). `pnpm db:generate` turns interactive and
  hangs on piped stdin when a table both gains and drops columns - never pipe stdin into it
  (`server/INSIGHTS.md:242-249`). Never hand-edit `server/src/db/migrations/**`.
- No table in this feature carries a `running` status. Any table with one needs a boot reaper
  (`server/INSIGHTS.md:51-61`); the scan's single-flight guard is an in-memory promise map instead.
- `MockGitClient.readFile` resolves a MISSING path to `''` instead of rejecting
  (`server/src/adapters/mocks.ts:305-307`; `server/INSIGHTS.md:250-253`). Every "document
  unreadable" branch must therefore treat blank content as absent, not only a thrown error.
- Client: data access only through `src/lib/hooks/*` then `src/lib/api.ts`; query keys live in the
  hook file; user strings go through next-intl; `@/` alias across folders, relative inside
  `src/app`; one feature must not import a sibling feature's `_components` (`client/AGENTS.md`,
  enforced by `pnpm lint`).
- `client/src/vendor/ui/**` is frozen with ONE sanctioned exception: `nav.ts` data edits
  (`client/INSIGHTS.md`, entry [2026-08-02]). This plan takes that exception and touches nothing
  else under `vendor/ui`.
- Do-not-touch, bordering this work: `server/clones/**` (read-only here),
  `server/src/db/migrations/**` (generated), `client/src/vendor/ui/**` except `nav.ts`, `.env` files.

## Skills for the implementer

| Step | Skill | Why |
| --- | --- | --- |
| 1 | `zod` | New contract file + a union added to `RunTrace.specs_read` |
| 2 | `postgresql-table-design`, `drizzle-orm-patterns` | Four new tables, composite PKs, FK indexes |
| 3 | (none - engine edit is 3 lines) | Guarded by `reviewer-core/AGENTS.md` purity rules |
| 4, 5 | `onion-architecture`, `drizzle-orm-patterns` | Layer placement of walk/pure helpers; repository queries |
| 6, 7 | `onion-architecture`, `security` | Service layer; path-traversal and allowlist validation |
| 8 | `fastify-best-practices`, `onion-architecture` | Schema-first routes, plugin-scoped job registration |
| 9 | `onion-architecture` | Cross-module composition seam in the run executor |
| 10 | (none - use `TESTING.md`) | Integration lane conventions |
| 11 | `frontend-ui-architecture`, `next-best-practices` | Hook placement, query keys, RSC boundary |
| 12 | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `security` | Page layout, `use client` island, markdown sanitisation |
| 13, 14 | `react-best-practices`, `frontend-ui-architecture` | Tab components, keyboard reorder, state |
| 15 | `react-best-practices` | Trace drawer rendering + the specs_read normaliser |
| 16 | (none - JSON flow spec) | `e2e/README.md` |
| 17 | `engineering-insights` | Mandated wrap-up (`CLAUDE.md`) |

## Steps

### Step 1 - Contracts, in both `vendor/shared` copies

- Files: `server/src/vendor/shared/contracts/project-context.ts` (new),
  `client/src/vendor/shared/contracts/project-context.ts` (new),
  `server/src/vendor/shared/contracts/trace.ts:40-60,110`,
  `client/src/vendor/shared/contracts/trace.ts` (same lines),
  `server/src/vendor/shared/index.ts:18-30`, `client/src/vendor/shared/index.ts` (same block),
  `client/src/lib/types.ts:11-32`
- Does:
  - New file exporting `ProjectDocCategory` (`z.enum(['.devdigest','docs','specs','insights'])`),
    `ProjectDoc` (`path`, `category`, `size_bytes`, `tokens`, `used_by_agents`),
    `ProjectDocScan` (`status: z.enum(['ok','not_cloned','error','never'])`, `scanned_at` nullable,
    `doc_count`, `tokens_total`, `skipped_too_large`, `bounded`, `error` nullable),
    `ProjectDocList`, `ProjectDocBody` (= `ProjectDoc.extend({ content: z.string() })`),
    `ContextAttachment` (`repo_id`, `repo_full_name`, `path`, `tokens`,
    `status: z.enum(['ok','missing'])`, `origin: z.enum(['direct','skill'])`,
    `skill_name` nullable), `AgentContext` (`active_repo_id` nullable, `direct[]`, `inherited[]`,
    `available_count`, `tokens_total`), `SkillContext` (`docs[]`, `tokens_total`),
    `SetContextDocsBody` (`docs: [{ repo_id: z.string().uuid(), path: z.string().min(1) }]`).
  - `PromptAssembly` gains `specs_tokens: z.number().int().nullish()`, placed next to
    `intent_tokens` (`trace.ts:57`) with the same "counted server-side" comment.
  - New `SpecsReadEntry` (`path`, `status: z.enum(['ok','missing','truncated'])`, `tokens`,
    `origin: z.string()` - `agent` or `skill:<name>`, matching the spec's table verbatim).
  - `RunTrace.specs_read` becomes `z.array(z.union([z.string(), SpecsReadEntry]))`.
  - One `export * from './contracts/project-context.js'` line appended to each barrel.
  - `client/src/lib/types.ts` re-exports the new types alongside the existing block.
- Does not: touch `SpecFile`/`IndexStatus` in `contracts/platform.ts:262-277` - they are unused
  starter scaffolding and removing them is a separate concern; does not rename or reorder any
  existing contract field.
- Skills: `zod`
- Verify: `diff -q server/src/vendor/shared/contracts/project-context.ts client/src/vendor/shared/contracts/project-context.ts`
  and the same for `contracts/trace.ts` and `index.ts` - all silent. Then
  `cd server && pnpm typecheck` and `cd client && pnpm typecheck`.

### Step 2 - DB schema and the additive migration

- Files: `server/src/db/schema/project-context.ts` (new), `server/src/db/schema.ts:15-93`
  (barrel `export *` AND the assembled `schema` object), the generated migration under
  `server/src/db/migrations/`
- Does: four tables, all `uuid` FKs with `onDelete: 'cascade'`, matching the repo's conventions
  (`schema/agents.ts:38-63`):
  - `project_docs` - `repoId`, `path`, `category`, `sizeBytes`, `tokens`;
    `primaryKey({ columns: [repoId, path] })`.
  - `project_doc_scans` - `repoId` primary key,
    `status: text(..., { enum: ['ok','not_cloned','error'] })`,
    `scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow()`,
    `docCount`, `tokensTotal`, `skippedTooLarge`, `bounded` (all `integer().notNull().default(0)`),
    `error: text()`. The absence of a row is what the contract renders as status `never`.
  - `agent_context_docs` - `agentId`, `repoId`, `path`, `order: integer().notNull().default(0)`;
    `primaryKey({ columns: [agentId, repoId, path] })`;
    `index('agent_context_docs_agent_idx').on(agentId, order)`;
    `index('agent_context_docs_repo_idx').on(repoId)`.
  - `skill_context_docs` - identical with `skillId`, and the two mirrored indexes.
- Does not: use the `now()` helper from `schema/_shared.ts:9` for `scanned_at` - that helper
  hardcodes the column name `created_at` and would silently create the wrong column. Does not add
  a `running` status anywhere. Does not add a FK from an attachment to `project_docs`: an
  attachment points at a path that may vanish and reappear, which is exactly what AC-24 and AC-34
  describe.
- Skills: `postgresql-table-design`, `drizzle-orm-patterns`
- Verify: `cd server && pnpm db:generate` (no stdin pipe), then `pnpm db:migrate`. The generated
  SQL must contain only `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT` - no `ALTER ... DROP`.

### Step 3 - reviewer-core: move the section, add the `specs_tokens` slot

- Files: `reviewer-core/src/prompt.ts:48-53,131-134,149-162`,
  `reviewer-core/test/prompt.test.ts`
- Does:
  - Move the `if (specsBlock) userSections.push('## Project context\n' + specsBlock)` push
    (`prompt.ts:134`) to sit immediately after the `## Relevant memory` push (`prompt.ts:130`) and
    before the `## Repo skeleton` push (`prompt.ts:131-133`).
  - Rewrite the `repoMap` doc comment at `prompt.ts:48-53`, which currently states the opposite
    rationale ("Rendered before `## Project context` so the model sees structure first"). Leaving
    it makes the file contradict its own code.
  - Add `specs_tokens: null` to the `PromptAssembly` literal beside `intent_tokens: null`
    (`prompt.ts:158-160`), with the same "counted server-side at trace-build time" comment.
  - Tests: section order with all slots populated; a `specs` entry containing `</untrusted>` does
    not close its own block (asserts the existing `prompt.ts:32` behaviour);
    absent/empty `specs` produces a user message byte-identical to the same call without the key.
- Does not: change the type or name of `PromptParts.specs`; does not add a second injection rule;
  does not add any tokenizer to the engine.
- Skills: none routed - the package's rules live in `reviewer-core/AGENTS.md`
- Verify: `cd reviewer-core && npm test && npm run arch:check` (this package uses **npm**, not pnpm)

### Step 4 - `project-context` module: constants, types, and the three pure files

- Files (all new): `server/src/modules/project-context/constants.ts`, `types.ts`, `walk.ts`,
  `paths.ts`, `assemble.ts`, plus `walk.test.ts`, `paths.test.ts`, `assemble.test.ts`
- Does:
  - `constants.ts`: `DOC_ROOTS = ['.devdigest','docs','specs','insights'] as const`,
    `DOC_EXT = '.md'`, `MAX_DOC_BYTES = 256*1024`, `MAX_DOCS = 500`, `MAX_DOC_TOKENS = 8_000`,
    `MAX_RUN_TOKENS = 20_000`, `SCAN_JOB_KIND = 'project-context-scan'`, `SCAN_TIMEOUT_MS`.
  - `walk.ts`: direct `node:fs/promises`, modelled on `repo-intel/pipeline/walk.ts:55-122`.
    Descends only the four `DOC_ROOTS` beneath the clone root (not the whole clone), skips
    `entry.isSymbolicLink()`, skips directories named in `EXCLUDED_DIRS` (imported from
    `../repo-intel/constants.js:17-26` - the `constants.ts` exemption of `no-cross-module-imports`),
    keeps `.md` only, `stat`s each file and drops those over `MAX_DOC_BYTES` into a
    `skippedTooLarge` counter, sorts by path, keeps the first `MAX_DOCS` and reports
    `bounded = matched - MAX_DOCS`, reads each kept file and sets `tokens = approxTokens(content)`
    (see Non-functional requirements), and sets `category` to the path's first segment.
  - `paths.ts`: pure `normalizeDocPath(raw): string | null` - rejects absolute paths, any `..`
    segment, backslashes, NUL bytes, a first segment outside `DOC_ROOTS`, and any name not ending
    `.md`; and `isInsideRoot(root, rel): boolean` built on `resolve` + `startsWith(root + sep)`.
  - `assemble.ts`: pure, Container-free, I/O-free functions over
    `{ path, origin, tokens, body }` records - `orderAttachments` (direct in stored order, then
    skill-inherited in link order), `dedupeByPath` (first position wins), `truncateAtHeading`
    (cut at the last `/^#{1,6} /m` boundary that fits `MAX_DOC_TOKENS`, hard-cut when the document
    has no heading, append `[truncated: N of M tokens]` inside the block), `applyRunBudget`
    (include in order until `MAX_RUN_TOKENS` is exhausted, return the dropped tail).
  - Tests are hermetic: `walk.test.ts` builds a fixture tree with `mkdtemp`; `paths` and
    `assemble` are table tests. No DB, so **no** `.it` suffix.
- Does not: put any of this in `service.ts`; does not import `container` anywhere in these files;
  does not touch `repo-intel`'s own walk.
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` and `pnpm arch:check`

### Step 5 - `project-context/repository.ts`

- Files: `server/src/modules/project-context/repository.ts` (new)
- Does: a class taking `Db`, modelled on `skills/repository.ts:39-88` - a `transaction(fn)`
  method, and every write method taking an optional `DbOrTx = this.db`. Methods:
  `replaceDocs(repoId, docs, tx)` (delete + insert in ONE transaction, so a concurrent list never
  sees a half-written set), `upsertScan(repoId, row, tx)`, `listDocs(repoId)`, `getScan(repoId)`,
  `hasDoc(repoId, path)`, `usageCounts(repoId)`, `agentDocs(agentId)`, `skillDocsFor(skillIds[])`,
  `replaceAgentDocs(agentId, rows, tx)`, `replaceSkillDocs(skillId, rows, tx)`.
  `usageCounts` is one grouped query: `count(distinct agent_id)` per path over
  `agent_context_docs` UNION (`skill_context_docs` joined `agent_skills` joined `skills` where
  `skills.enabled`), joined to `agents` where `agents.enabled`, filtered to the repo.
  A doc comment states that these queries carry no `workspace_id` and get their tenancy from the
  service, which resolves the repo through `container.reposRepo.getById(workspaceId, id)` first -
  the pattern `server/INSIGHTS.md:196-202` requires be written down.
- Does not: reach into another module's folder - the cross-table join uses `db/schema` table
  symbols, which is what `reviews/repository/run.repo.ts::statsForAgents` already does
  (`server/INSIGHTS.md:187-194`).
- Skills: `drizzle-orm-patterns`, `onion-architecture`
- Verify: `cd server && pnpm typecheck && pnpm arch:check`

### Step 6 - Service: scan, list, read a body

- Files: `server/src/modules/project-context/service.ts` (new)
- Does: `class ProjectContextService { constructor(private container: Container) { this.repo = new ProjectContextRepository(container.db); } }`
  - `scan(repoId)`: resolve the repo, take the clone root from `container.git.clonePathFor(ref)`;
    if the directory does not exist, write a scan row with status `not_cloned` and an empty
    document set (AC-11) and return. Otherwise `walkDocs(root)` then `replaceDocs` + `upsertScan`
    inside one transaction. A thrown error writes status `error` with the message.
    Single-flight: an in-memory `Map<repoId, Promise>` so a second caller awaits the first.
  - `list(workspaceId, repoId)`: repo resolved workspace-scoped through
    `container.reposRepo.getById`, 404 otherwise; returns `{ docs, scan }` with `used_by_agents`
    merged in from `usageCounts`. When no scan row exists, run one lazily first (repos cloned
    before L05) and return status `never` only when the lazy scan itself found nothing to do.
  - `readDoc(workspaceId, repoId, rawPath)`, in this exact order, with **no filesystem access
    before all three checks pass**: `normalizeDocPath` then 422 `ValidationError` (AC-47);
    `repo.hasDoc(repoId, rel)` then 404 `NotFoundError` (AC-48);
    `isInsideRoot(clonePathFor(ref), rel)` then 422 (AC-47, second belt, needed because
    `SimpleGitClient.readFile` at `server/src/adapters/git/simple-git.ts:129-131` does a bare
    `join` with no guard). Only then `container.git.readFile(ref, rel)`. A read failure surfaces
    as a per-document error, never a page-level one (AC-13).
- Does not: call `node:fs` from this file; does not bump any version; does not write to the clone -
  `GitClient` (`server/src/vendor/shared/adapters.ts:205-228`) has no write method at all (AC-50).
- Skills: `onion-architecture`, `security`
- Verify: `cd server && pnpm typecheck && pnpm arch:check`

### Step 7 - Service: agent and skill attachments

- Files: `server/src/modules/project-context/service.ts` (continued)
- Does:
  - `getAgentContext(workspaceId, agentId, activeRepoId)`: ownership through
    `new AgentsService(this.container).get(workspaceId, agentId)` (the composition seam);
    direct attachments in stored `order`; inherited ones from
    `container.agentsRepo.linkedSkills(agentId)` filtered to `skill.enabled` in link order
    (mirrors `run-executor.ts:458-478`) (AC-20, AC-29); each row marked `missing` when its path is
    absent from the latest scan of its repo (AC-24); rows whose `repo_id` differs from
    `activeRepoId` carry their `repo_full_name` so the client can group them (AC-23);
    `available_count` = document count of the active repo (AC-19); `tokens_total` = sum over direct
    + inherited (AC-21).
  - `setAgentDocs(workspaceId, agentId, docs)`: **validate every incoming row before writing** -
    each `repo_id` must resolve through `container.reposRepo.getById(workspaceId, repoId)`, and
    each `path` must pass `normalizeDocPath` AND `repo.hasDoc`. Then a full replace with `order`
    reindexed 0..n-1 in one transaction. Last write wins, no locking (spec edge case).
  - Mirrored `getSkillContext` / `setSkillDocs` through `new SkillsService(this.container)`.
- Does not: bump `agents.version` or `skills.version` - the spec's non-goals forbid it, and the
  L02 skill-link path that does bump must not be reused here. Does not modify `modules/agents` or
  `modules/skills` at all.
- Skills: `onion-architecture`, `security`
- Verify: `cd server && pnpm typecheck && pnpm arch:check`

### Step 8 - Routes, module registration, scan triggers

- Files: `server/src/modules/project-context/routes.ts` (new), `server/src/modules/index.ts:1-41`,
  `server/src/modules/repos/service.ts:70-79`, `server/src/modules/repo-intel/service.ts:143-162`
- Does:
  - Seven routes, every one opening with `await getContext(container, req)`
    (`modules/_shared/context.ts:4-23`) and every schema declared with zod
    (`fastify-type-provider-zod`), never `Schema.parse(req.body)`:

    | Route | Returns |
    | --- | --- |
    | `GET /repos/:id/context` | `ProjectDocList` |
    | `GET /repos/:id/context/doc?path=` | `ProjectDocBody` |
    | `POST /repos/:id/context/refresh` | `ProjectDocList` after a fresh scan (AC-10) |
    | `GET /agents/:id/context?repo_id=` | `AgentContext` |
    | `PUT /agents/:id/context` | `AgentContext` |
    | `GET /skills/:id/context?repo_id=` | `SkillContext` |
    | `PUT /skills/:id/context` | `SkillContext` |

    None of these paths collide with existing routes (checked: `agents/routes.ts` and
    `skills/routes.ts` declare no `:id/context`).
  - In the plugin body, before the routes, register the scan job handler exactly as
    `repo-intel/routes.ts:21-28` does: `service.registerScanJobHandler()` calling
    `container.jobs.register(SCAN_JOB_KIND, handler, { timeoutMs: SCAN_TIMEOUT_MS })` - the
    per-kind budget `server/INSIGHTS.md:51-61` requires.
  - One import + one entry in `modules/index.ts`, placed after `repos`.
  - Two best-effort enqueues, each in its own `try/catch` like the neighbours:
    `repos/service.ts` right beside the existing `INDEX_JOB_KIND` enqueue in `runCloneJob`
    (line 70-79), and `repo-intel/service.ts` at the end of `resyncRepo` after `runIncremental`
    returns. Both import only `../project-context/constants.js`.
- Does not: widen any depcruise rule or add an allowlist entry.
- Skills: `fastify-best-practices`, `onion-architecture`
- Verify: `cd server && pnpm arch:check && pnpm typecheck` - zero new violations.

### Step 9 - Run assembly and the run-executor wiring

- Files: `server/src/modules/project-context/service.ts` (method `assembleForRun`),
  `server/src/modules/reviews/run-executor.ts:240,246-275,381-395,389`
- Does:
  - `assembleForRun({ agentId, repo, onLog })` returning `{ bodies: string[], specsRead: SpecsReadEntry[] }`:
    collect direct + enabled-skill-inherited attachments with `origin` (`agent` or `skill:<name>`)
    (AC-31); drop every attachment whose `repo_id` is not this PR's repository (AC-33);
    `dedupeByPath` (AC-32); for each, run the SAME validation chain as `readDoc` before touching
    the port, then `container.git.readFile`; **a throw OR a blank/whitespace-only body counts as
    `missing`** - `MockGitClient.readFile` returns `''` rather than rejecting
    (`server/INSIGHTS.md:250-253`) - emitting one Live Log line and a `missing` entry, and the run
    continues (AC-34); `truncateAtHeading` above `MAX_DOC_TOKENS` producing status `truncated`
    (AC-35); `applyRunBudget` over the whole set, one Live Log line per dropped document (AC-36).
    Run-time assembly reads the clone directly and does NOT consult `project_docs`, so it never
    waits on, or half-reads, an in-flight scan (spec edge case).
  - In `runOneAgent`, next to `buildSkillBlocks` (`run-executor.ts:240`), add a private
    `buildProjectContext(agent, repo, runLog)` wrapping `new ProjectContextService(this.container)`
    in try/catch, degrading to `{ bodies: [], specsRead: [] }` on any failure - the same
    best-effort shape as skills and intent.
  - Pass `...(ctx.bodies.length > 0 ? { specs: ctx.bodies } : {})` into `reviewPullRequest`
    (AC-30, AC-38).
  - In the trace literal (`run-executor.ts:381-395`), add
    `specs_tokens: outcome.assembly.specs != null ? this.container.tokenizer.count(outcome.assembly.specs) : null`
    beside `skills_tokens`/`intent_tokens` (AC-41), and replace `specs_read: []` at line 389 with
    `ctx.specsRead` (AC-40). `traceFromBuffer`'s `specs_read: []` at line 641 stays as it is - a
    failed run assembled nothing.
- Does not: add anything to `logPromptAssembly`. The section list at `run-executor.ts:294-304`
  already carries `'specs'` and `prompt-log.ts:203` already carries its source label, and
  `logPromptAssembly` takes text and returns only measurements of it (AC-51). Does not add a
  CI-specific path: `reviews/service.ts:133` `executor.executeRuns` is the only run entry point
  today, so assembly living in the executor is what makes AC-37 hold by construction.
- Skills: `onion-architecture`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`

### Step 10 - Server integration tests

- Files: `server/src/modules/project-context/context.it.test.ts` (new),
  `server/src/modules/project-context/assembly.it.test.ts` (new)
- Does: drive `buildApp` + `app.inject`. Cover: attachment set and order surviving a reload;
  a repository outside the workspace 404ing on both the list and the attachment write; cascade
  deletes for repo, agent and skill; `used_by_agents` counting an agent once when it holds the
  document both directly and through an enabled skill; a document reachable directly and via a
  skill appearing exactly once in `prompt_assembly.specs`; a full run producing
  `prompt_assembly.specs`, a non-null `specs_tokens`, and `specs_read` entries with statuses; a
  `git status` assertion over the fixture clone directory showing it unchanged (AC-50).
  Both files pass `overrides.git` as a stub whose `clonePathFor` returns a `mkdtemp` fixture
  directory, `overrides.llm` for every provider the path resolves, AND
  `secrets: new MockSecretsProvider({})` - omitting the last one makes the test read
  `~/.devdigest/secrets.json` and spend real money (`server/INSIGHTS.md:94-105`).
  Poll for the trace document itself, never for `agent_runs.status === 'done'`
  (`server/INSIGHTS.md:107-111`).
- Does not: use `MockGitClient` unmodified for the "unreadable document" case - it returns `''`,
  not a rejection, so the test must assert the blank-is-missing branch explicitly and also cover a
  stub that throws.
- Skills: none routed; conventions from `TESTING.md:104-112`
- Verify: `cd server && pnpm exec vitest run .it.test --no-file-parallelism`

### Step 11 - Client: hooks and i18n

- Files: `client/src/lib/hooks/project-context.ts` (new), `client/src/lib/hooks/index.ts`,
  `client/src/lib/hooks/core.ts:138-153`, `client/messages/en/context.json` (rewrite),
  `client/messages/en/agents.json`, `client/messages/en/skills.json`,
  `client/messages/en/runs.json`
- Does: `projectContextKeys.{list,doc,agent,skill}` plus `useProjectDocs`, `useProjectDoc`,
  `useRefreshProjectDocs`, `useAgentContext`, `useSetAgentContextDocs`, `useSkillContext`,
  `useSetSkillContextDocs`, modelled on `client/src/lib/hooks/skills.ts`; mutations invalidate the
  matching list key. Delete the dead `useContextFiles` / `useReindexContext` from `core.ts` (zero
  importers). Rewrite `context.json`: drop `chunks`, `mode.*`, `editor.*`, `reindex`, `indexing`
  (all describe features the spec cut); add `notCloned`, `empty.title`, `empty.globs`, `readError`,
  `retry`, `usedBy`, `footer`, `refresh`, `reloadBanner`. Add the new keys used by steps 13-15.
- Does not: touch `SpecFile`/`IndexStatus` in the contracts; does not add a second data path.
- Skills: `frontend-ui-architecture`
- Verify: `cd client && pnpm typecheck && pnpm lint`

### Step 12 - Client: the Project Context page, the nav entry, `DocMarkdown`

- Files: `client/src/app/repos/[repoId]/context/page.tsx` (new),
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/**` (new),
  `client/src/components/doc-markdown/DocMarkdown.tsx` (new),
  `client/src/vendor/ui/nav.ts:20-32,58-68`, `client/package.json:13-25`
- Does:
  - Two panes - a document tree and a read-only viewer. Tree footer reads
    "12 documents · ≈14,300 tokens · scanned 5m ago" from `ProjectDocScan` (AC-15). The toolbar
    carries exactly one action, `refresh` (AC-9, AC-10).
  - States: not-yet-cloned naming the clone as the missing prerequisite (AC-11); empty listing the
    four globs (AC-12); per-document read failure showing the path plus a retry control, leaving
    the tree selection untouched (AC-13); a reload banner when a refetch returns different content
    for the open document - the rendered body is held in a ref and the banner's button is what
    adopts the new data, so the text never swaps under the reader (spec edge case).
  - "Used by N agents" in the viewer header from `ProjectDoc.used_by_agents` (AC-14).
  - Tree is one tab stop with roving `tabIndex` and arrow-key movement; above 100 rows it renders
    through `useVirtualizer` from `@tanstack/react-virtual@^3.14.9` (React 19 in its peer range),
    and in that path it MUST call `virtualizer.scrollToIndex(next, { align: 'auto' })` before
    moving DOM focus (the row may not be mounted yet) and MUST set `aria-setsize`/`aria-posinset`
    by hand, since the DOM no longer holds every row. Below 100 rows the plain list renders - this
    is also what keeps the component testable in jsdom, which has no layout and would make the
    virtualiser render zero rows.
  - Long paths: filename whole, directory part middle-truncated, full path in `title` and
    `aria-label`. Below 900 px the two panes collapse to tree-then-viewer with a back control.
  - `DocMarkdown`: a new app-level component over `react-markdown@9.1.0`, NOT an edit to the
    vendored `client/src/vendor/ui/primitives/Markdown.tsx`. No `rehype-raw` (the installed
    library already escapes raw HTML without it), and an explicit `urlTransform` that narrows the
    library's `defaultUrlTransform` allowlist `^(https?|ircs?|mailto|xmpp)$` down to `http`/`https`
    only, returning `''` otherwise (AC-49). `javascript:` is already neutered by the default; the
    narrowing is what removes `mailto:`/`ircs:`/`xmpp:`.
  - `nav.ts`: one `NavItemDef` in the `WORKSPACE` section -
    `{ key: "context", label: "Project Context", icon: <an existing IconName>, href: "/repos/:repoId/context", gKey: "x" }` -
    plus one `SHORTCUTS` row `{ keys: "g x", label: "Go to Project Context", group: "Navigation" }`.
    Nothing else in the file changes. `activeKeyFor` already maps `/context` to `context`
    (`client/src/components/app-shell/helpers.ts:30`) and `shell.json` already carries
    `nav.context`, so no other wiring is needed; the command palette and `g`-shortcuts derive from
    `NAV` automatically.
- Does not: add any create/edit/upload/rename/delete control (AC-9); does not touch any other file
  under `client/src/vendor/ui/`; does not import `@devdigest/ui`'s barrel from anything the root
  layout reaches without a `"use client"` boundary (`client/INSIGHTS.md` - `pnpm build` does not
  catch that, only e2e does).
- Skills: `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `security`
- Verify: `cd client && pnpm test && pnpm lint && pnpm typecheck`

### Step 13 - Client: the agent's Context tab

- Files: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
  `.../AgentEditor/AgentEditor.tsx:26-30`,
  `.../AgentEditor/_components/ContextTab/**` (new)
- Does: one entry appended to the `TABS` array plus one branch in the conditional render - the
  editor's established pattern. The tab shows attached rows pinned above available ones, an
  always-visible filter, the "N of M attached" badge (AC-19), up/down buttons with `aria-label` on
  every attached row so reorder works from the keyboard with no pointer (AC-17, AC-18), an
  inherited group with neither reorder nor detach (AC-20), an other-repository group headed by the
  repo's full name with a "not used on this repo" chip (AC-23), a `missing` chip whose row keeps a
  working detach (AC-24), a no-match row with a clear-filter control (AC-25), a "0 of 0 attached"
  empty state linking to the Project Context page, and a footer reading "≈ N tokens" that switches
  to a warning state above 16,000 while naming the 20,000-token run budget (AC-21, AC-22).
  Above 100 rows the available list virtualises, same threshold and same library as step 12.
- Does not: import anything from the skill editor's `_components` - if a row component is shared
  between the two tabs it is promoted to `client/src/components/`, which `pnpm lint` enforces.
- Skills: `react-best-practices`, `frontend-ui-architecture`
- Verify: `cd client && pnpm test && pnpm lint`

### Step 14 - Client: the skill's Context tab

- Files: `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`,
  `.../SkillEditor/SkillEditor.tsx:35-41`, `.../SkillEditor/_components/ContextTab/**` (new)
- Does: a fourth tab by the same pattern; the same attachment list (AC-26), plus a `CONTRIBUTES`
  manifest block whose rows read `- specs/public-api.md · ≈184 tok` (AC-27).
- Does not: render a reorder control the skill has no ordering semantics for beyond storage order;
  does not duplicate the agent tab's row component by copy-paste (promote instead).
- Skills: `react-best-practices`, `frontend-ui-architecture`
- Verify: `cd client && pnpm test && pnpm lint`

### Step 15 - Client: the run-trace drawer

- Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39-51,74-113`,
  `.../RunTraceDrawer/helpers.ts`, `client/messages/en/runs.json`
- Does:
  - Move the `specs` `<PromptBlock>` above the `repo_map` block so the drawer's order matches the
    engine's new order (AC-42); relabel it to name it untrusted; give it the
    `meta={t("trace.prompt.tokens", { count: specs_tokens })}` badge the way `intent` and `skills`
    already have one (AC-41). The block already expands to the full stored text including its
    delimiters (AC-43) and `PROMPT_COLORS` already carries a `specs` entry - no new colour needed.
  - Add `toSpecsReadEntry(item)` to `helpers.ts`: a `string` becomes `{ path, status: null }` and
    renders as a bare path exactly as today; an object renders with path, status, token and origin
    chips (AC-40, AC-44). Rendering the union directly would throw
    "Objects are not valid as a React child" on every post-L05 trace, and the drawer parses
    nothing at runtime - `GET /runs/:id/trace` returns the stored document uncast
    (`reviews/routes.ts:140-145`) - so this normaliser is the only thing standing between an old
    trace and a new one.
- Does not: add a `pr_description` block (a known, separate gap noted in `client/INSIGHTS.md`).
- Skills: `react-best-practices`
- Verify: `cd client && pnpm test`

### Step 16 - E2E flow

- Files: `e2e/specs/11-project-context.flow.json` (new)
- Does: a deterministic flow with no LLM. **The seeded stack has no clone** -
  `server/src/db/seed.ts:93` inserts `acme/payments-api` with `clonePath: null` and
  `scripts/e2e.sh` uses an ephemeral Postgres - so the flow asserts the states that a clone-less
  stack actually produces: the sidebar entry navigates to `/repos/:repoId/context`; the page
  renders the not-yet-cloned state (AC-11); the agent editor's Context tab renders "0 of 0
  attached" with its link back to the page. Attachment persistence is covered by step 10 instead.
- Does not: attempt to open a document, refresh a scan, or attach anything - none of those are
  reachable without a real clone, and faking one would mean writing into `server/clones/**`.
- Skills: none; conventions from `e2e/README.md` and `TESTING.md:114-116`
- Verify: `./scripts/e2e.sh`

### Step 17 - Documentation and wrap-up

- Files: `server/src/modules/project-context/README.md` (new), `server/README.md`,
  `AGENTS.md` (root - the "Read when…" block; note `CLAUDE.md` is a symlink to it, so this is ONE
  edit, not two), `.claude/repo-facts.md` (regenerate via `scripts/repo-facts.sh` - a module and a
  contract file were added), `INSIGHTS.md` of the touched modules
- Does: document the module, then run the `engineering-insights` wrap-up check.
- Skills: `engineering-insights`
- Verify: `bash scripts/repo-facts.sh` regenerates cleanly and the new module appears in the
  "Server modules" row.

## Test strategy

- New hermetic server unit tests, step 4: `walk.test.ts` (four roots only, `EXCLUDED_DIRS`,
  256 KB then skipped, 500 then bounded, category = first segment, symlinks not followed),
  `paths.test.ts` (`../`, absolute, backslash, `.env`, a path outside the globs),
  `assemble.test.ts` (heading-boundary truncation and its marker, the no-heading hard cut, the
  20k budget dropping the tail, dedup first-position-wins, direct-then-inherited ordering,
  a disabled skill contributing nothing). No DB, so no `.it` suffix.
- New DB-backed tests, step 10: `context.it.test.ts` and `assembly.it.test.ts`. Both are
  `*.it.test.ts` because they import `test/helpers/pg.ts`.
- New reviewer-core tests, step 3, in the existing `reviewer-core/test/prompt.test.ts`.
- New client tests: `ProjectContextView.test.tsx`, `ContextTab.test.tsx` (agent and skill),
  and additions to the existing `RunTraceDrawer.test.tsx` - including one asserting that a trace
  whose `specs_read` is `string[]` still renders.
- Existing suites that must stay green: server unit and integration in full, `reviewer-core`
  (prompt assembly is edited), the whole client suite, and `./scripts/e2e.sh` - note that
  `e2e/specs/04-pr-findings.flow.json` asserts a literal substring in a component header, so any
  header text touched must be appended to, not replaced (`client/INSIGHTS.md`).

## Non-functional requirements

- Discovery scan within 5,000 ms for 500 documents - step 4 walks only the four roots, not the
  whole clone, and sizes tokens with `approxTokens` rather than the tiktoken encoder.
- **Token estimates.** The scan, the Context-tab aggregate, the 8,000-token per-document ceiling
  and the 20,000-token run budget all use `approxTokens` (`ceil(chars/4)`) from
  `server/src/adapters/tokenizer/index.ts:23-25`. Only the trace's `specs_tokens` uses
  `container.tokenizer.count`, on the single assembled block - exactly how `skills_tokens` and
  `intent_tokens` are already computed. Rationale: `TiktokenTokenizer` is a synchronous pure-JS
  encoder; running it over up to 500 documents inside a request would block the event loop of the
  process that also serves the SSE run stream, and the per-document truncation search calls the
  counter repeatedly. This keeps the number the user is shown and the number the budget enforces
  identical. The spec's NFR row names "the existing tokenizer adapter, with the `ceil(chars/4)`
  fallback"; `approxTokens` is that adapter's exported fallback.
- Document list within 200 ms for 500 documents - step 5's list is two indexed reads plus one
  grouped count; no filesystem access on the list path (steps 5, 6).
- Single body within 300 ms for 256 KB - one `readFile` after three in-memory checks (step 6).
- Added run setup within 500 ms for 10 attached documents - 10 sequential `readFile` calls plus
  arithmetic; no tokenizer encode (step 9).
- List virtualisation above 100 rows in the tree and in both Context tabs (steps 12, 13, 14).
- Viewport: below 900 px the panes collapse to tree-then-viewer with a back control (step 12).
- Accessibility: every reorder action keyboard-reachable (step 13); every row status conveyed by
  text as well as colour (steps 12, 13, 14); the tree is one tab stop with arrow-key navigation
  and, in the virtualised path, hand-set `aria-setsize`/`aria-posinset` (step 12).
- i18n: every user-facing string through next-intl namespaces (step 11).
- Storage: no document body is persisted by DevDigest. `project_docs` holds metadata only; the
  only persisted text is the assembled prompt inside the run trace (steps 2, 9).
- Security suspicions for `/security-review`, not judged here: the path-validation chain in
  step 6/7/9 and whether the write path can store a path the read path would later trust; and the
  `urlTransform` narrowing in step 12.

## Stop conditions

- If the `## Project context` move in step 3 turns any existing `reviewer-core` or server test red
  in a way that is NOT just an expected-string order change, stop - it means something depends on
  the section order that this plan did not find.
- If `pnpm db:generate` in step 2 asks an interactive question, stop and do not answer it: the
  migration was not additive. Re-check the schema edit.
- If `pnpm arch:check` reports a new violation in step 8 or 9, stop and fix the placement. Never
  widen a rule or add an allowlist entry.
- If the step 4 walk over a real 500-document repository exceeds 5,000 ms even with
  `approxTokens`, stop and report the measurement rather than silently narrowing the glob set.
- If any Context-tab or trace acceptance criterion turns out to need a `PromptAssembly` or
  `RunTrace` field this plan did not add, stop - a contract change must go back through step 1 and
  land in both copies at once.

## Acceptance criteria

- [ ] Both `vendor/shared` copies agree on the three touched files - verify:
      `diff -q` on `contracts/project-context.ts`, `contracts/trace.ts`, `index.ts`
- [ ] The generated migration contains only `CREATE`/`ADD`, no `DROP` - verify: read the generated
      file, then `cd server && pnpm db:migrate`
- [ ] Prompt sections order as Skills, Memory, Project context, Repo skeleton, and an
      attachment-free run's user message is byte-identical to before - verify:
      `cd reviewer-core && npm test`
- [ ] Discovery honours the four globs, `EXCLUDED_DIRS`, the 256 KB skip and the 500 cap; path
      validation rejects `../`, absolute paths and `.env` - verify:
      `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- [ ] Attachments persist with order across a reload, cascade on repo/agent/skill delete, are
      workspace-scoped, and a run's trace carries `prompt_assembly.specs`, a non-null
      `specs_tokens` and statused `specs_read` entries - verify:
      `cd server && pnpm exec vitest run .it.test --no-file-parallelism`
- [ ] No new boundary violation - verify: `cd server && pnpm arch:check` and
      `cd reviewer-core && npm run arch:check`
- [ ] The clone is untouched after browsing, attaching and running - verify: the `git status`
      assertion in `assembly.it.test.ts`
- [ ] The Context tab reorders from the keyboard alone, warns above 16,000 tokens naming the
      20,000 budget, and shows `missing` / `not used on this repo` / no-match states - verify:
      `cd client && pnpm test`
- [ ] A trace whose `specs_read` is `string[]` opens and renders bare paths - verify:
      `cd client && pnpm test` (`RunTraceDrawer.test.tsx`)
- [ ] `DocMarkdown` renders a `<script>` tag as text and emits no `javascript:` or `mailto:` href -
      verify: `cd client && pnpm test`
- [ ] The sidebar entry navigates to the page and the clone-less states render - verify:
      `./scripts/e2e.sh`
- [ ] Whole-repo green - verify: `cd client && pnpm typecheck && pnpm lint && pnpm test`

## Deliberately out of scope

- Removing the dead `SpecFile` / `IndexStatus` contracts from `contracts/platform.ts:262-277`.
  They have no importers after step 11 but sit in a barrel documented as append-only; deleting
  them is a separate change.
- A CI review entry point. `platform/trace-builder.ts` still has zero callers and `ci_runs` is
  still an empty table; AC-37 is satisfied by placement, not by new code.
- Attaching a document directly from the Project Context page, sorting the tree by attachment
  state, and per-repository configurable globs - all marked `open` in the spec's design review.
- Security judgement on the path-validation chain and the markdown sanitiser - that is
  `/security-review`. Layering judgement on the new module - that is `architecture-reviewer`.

---

# Rationale

## Affected modules

| Package / module | What changes | Why |
| --- | --- | --- |
| `server/src/vendor/shared` + `client/src/vendor/shared` | New `contracts/project-context.ts`; `PromptAssembly.specs_tokens`; `RunTrace.specs_read` widened to a union | The list, the attachment surfaces and the statused specs-read entries need a wire shape; AC-44 requires old traces to keep typing |
| `server/src/db/schema` | `project_docs`, `project_doc_scans`, `agent_context_docs`, `skill_context_docs` | No L05 table exists - confirmed by `server/INSIGHTS.md:83-92`, which explicitly refutes `server/AGENTS.md:49-50` on this point |
| `reviewer-core/src/prompt.ts` | Section moved above `## Repo skeleton`; `specs_tokens: null` added | AC-42; the assembly literal needs the slot the server fills |
| `server/src/modules/project-context` (new) | Whole module | Owns discovery, reads, attachments and run assembly |
| `server/src/modules/reviews/run-executor.ts` | `buildProjectContext`, `specs` passed, `specs_tokens`, `specs_read` | The only unfed seam; also what makes AC-37 hold by placement |
| `server/src/modules/repos`, `.../repo-intel` | One try/catch enqueue each | AC-1's two triggers |
| `client/src/lib/hooks`, `client/messages/en` | New hook file; dead hooks removed; `context.json` rewritten | Mockup-era keys describe features the spec cut |
| `client/src/app/repos/[repoId]/context`, `.../agents/[id]`, `.../skills/[id]`, `.../RunTraceDrawer` | New page + two tabs + drawer changes | AC-8..AC-27, AC-40..AC-44 |
| `client/src/vendor/ui/nav.ts` | Two data lines | The only sanctioned exception to the vendor freeze |
| `e2e/specs` | One new flow | The clone-less states are the only deterministic ones |

## Verified facts this plan rests on

| Fact | Evidence |
| --- | --- |
| `## Project context` is pushed AFTER `## Repo skeleton` today | `reviewer-core/src/prompt.ts:131-134` |
| The engine's doc comment states the OPPOSITE rationale for that order and would contradict the change | `reviewer-core/src/prompt.ts:48-53` |
| `wrapUntrusted` already neutralises `</untrusted>`; AC-45/46 need no engine change | `reviewer-core/src/prompt.ts:30-34,109-112` |
| `intent_tokens: null` is the precedent for a server-counted slot | `reviewer-core/src/prompt.ts:158-160` |
| `specs_read: []` is hardcoded in two places, not one | `run-executor.ts:389` and `traceFromBuffer` at `run-executor.ts:641` |
| `buildSkillBlocks` is the model for best-effort, enabled-only, link-ordered assembly | `run-executor.ts:458-478` |
| `logPromptAssembly` already lists `'specs'`; `prompt-log.ts` already carries its source label; the function takes text and returns only measurements | `run-executor.ts:294-311`, `server/src/platform/prompt-log.ts:180-208` |
| Constructing another module's `service.ts` is the documented seam | `.dependency-cruiser.cjs:33-57`; `run-executor.ts:17-19` |
| `GitClient` has no write method; `clonePathFor` + `readFile` are all this feature needs | `server/src/vendor/shared/adapters.ts:205-228` |
| `SimpleGitClient.readFile` does a bare `join` with no traversal guard | `server/src/adapters/git/simple-git.ts:129-131` |
| `MockGitClient.readFile` returns `''` for a missing path instead of rejecting | `server/src/adapters/mocks.ts:305-307`; `server/INSIGHTS.md:250-253` |
| Direct `node:fs` in a module pipeline file is precedented and unblocked by depcruise | `repo-intel/pipeline/walk.ts:23-31,55-122` |
| `EXCLUDED_DIRS` is cross-module importable | `repo-intel/constants.ts:17-26`; exemption at `.dependency-cruiser.cjs:48-52` |
| `JobRunner.register(kind, handler, {timeoutMs})` / `enqueue(workspaceId, kind, payload)`; in-process p-queue, rows in `jobs`, nothing re-hydrates the queue on boot | `server/src/platform/jobs.ts:16-56,58-117` |
| Job handlers are registered inside the module plugin body | `repo-intel/routes.ts:21-28` |
| `repos/service.ts` already enqueues `INDEX_JOB_KIND` after a clone, in try/catch | `repos/service.ts:70-79` |
| `resyncRepo` IS the resync job handler body and enqueues nothing at the end | `repo-intel/service.ts:143-162,172-182` |
| `container` exposes `db`, `git`, `agentsRepo`, `reposRepo`, `tokenizer`, `jobs` - and no `skillsRepo` | `platform/container.ts:60-146` |
| `reposRepo.getById(workspaceId, id)` is workspace-scoped | `repos/repository.ts:36` |
| `agentsRepo.linkedSkills(agentId)` returns skills ordered by link order | `agents/repository.ts:201-209` |
| A service must build its own repository from `container.db` | `server/INSIGHTS.md:170-180`; `skills/service.ts:42-47` |
| A repository joining another module's tables is already done | `server/INSIGHTS.md:187-194` |
| A table with a `running` status needs a boot reaper | `server/INSIGHTS.md:51-61` |
| The `now()` helper hardcodes the column name `created_at` | `server/src/db/schema/_shared.ts:9` |
| `GET /runs/:id/trace` returns the stored document with no zod parse and no response schema | `reviews/routes.ts:140-145`; `repository/run.repo.ts:294-296` |
| `RunTraceSchema.parse` exists but its only home is the caller-less `platform/trace-builder.ts:56` | grep across `server/src`, `client/src`, `reviewer-core/src` |
| The drawer renders `specs_read` entries as bare children and enumerates prompt blocks by hand | `.../TraceBody/TraceBody.tsx:39-51,74-113` |
| `runs.json` already has `trace.prompt.specs`, `trace.prompt.tokens`, `trace.config.specsRead`; `PROMPT_COLORS` already has `specs` | `client/messages/en/runs.json`; `.../RunTraceDrawer/constants.ts` |
| NAV/SHORTCUTS have no app-level override; every consumer imports the vendored constants directly; `AppFrame` takes no `nav` prop | `client/src/vendor/ui/nav.ts:21-35,58-68`; `.../shell/Sidebar.tsx:3,45`; `.../hooks/useShellCommands.ts:6,21`; `.../shell/AppFrame.tsx:6-14` |
| `client/INSIGHTS.md` names the `nav.ts` edit "the one sanctioned exception to the vendored-UI freeze, data-only" | `client/INSIGHTS.md`, entry [2026-08-02] |
| Only `346bc7e`, `ac5edd8` (both L02) and the squashed snapshot ever touched `nav.ts` | `git log --oneline -- client/src/vendor/ui/nav.ts` |
| `activeKeyFor` already maps `/context`; `shell.json` already carries `nav.context` | `client/src/components/app-shell/helpers.ts:30`; `client/messages/en/shell.json:20` |
| `useContextFiles` / `useReindexContext` / `SpecFile` have zero UI importers | grep over `client/src`; `core.ts:139-153`; `contracts/platform.ts:262-269` |
| Tabs are declared by a local `constants.ts` `TABS` array plus a conditional branch | `.../AgentEditor/constants.ts`, `.../SkillEditor/constants.ts` |
| react-markdown installed is 9.1.0; the prop is `urlTransform`; `defaultUrlTransform` allowlists `^(https?\|ircs?\|mailto\|xmpp)$` and already returns `''` for `javascript:`; raw HTML is escaped without `rehype-raw` | `client/node_modules/react-markdown/package.json`; `lib/index.d.ts:139-147`; `lib/index.js:113,299,416-439` |
| `@tanstack/react-virtual` is absent; latest stable is 3.14.9 with React 19 in peerDependencies; API is `useVirtualizer` then `getVirtualItems()` / `scrollToIndex(index, { align })` | npm registry manifest; TanStack Virtual API reference |
| `TiktokenTokenizer` is a synchronous pure-JS `cl100k_base` encoder with an `approxTokens` fallback exported from the same file | `server/src/adapters/tokenizer/index.ts:15-45` |
| The seeded repo has `clonePath: null`, and `scripts/e2e.sh` uses an ephemeral Postgres | `server/src/db/seed.ts:87-96`; `scripts/e2e.sh:9-11` |
| The shared barrel is extended with new files, not edited | `server/src/vendor/shared/index.ts:14-15` |
| The prompt test lives at `reviewer-core/test/prompt.test.ts`, not at the package root | `ls reviewer-core/test/` |

## Traceability

| Requirement | Step(s) | Acceptance criterion |
| --- | --- | --- |
| AC-1 | 6, 8 | Discovery honours the globs (unit) + list after a scan (integration) |
| AC-2 | 4 | Discovery unit test |
| AC-3 | 4 | Discovery unit test |
| AC-4 | 4 | Discovery unit test |
| AC-5 | 4 | Discovery unit test |
| AC-6 | 4 | Discovery unit test |
| AC-7 | 1, 4, 12, 13, 14, 15 | Contract diff + client tests |
| AC-8 | 12 | `cd client && pnpm test` |
| AC-9 | 12 | `cd client && pnpm test` |
| AC-10 | 8, 12 | `cd client && pnpm test`; route in the integration lane |
| AC-11 | 6, 12 | `./scripts/e2e.sh` + client test |
| AC-12 | 6, 12 | `cd client && pnpm test` |
| AC-13 | 6, 12 | `cd client && pnpm test` |
| AC-14 | 5, 7, 12 | `used_by_agents` counted once (integration) |
| AC-15 | 6, 12 | `cd client && pnpm test` |
| AC-16 | 2, 7, 13 | Attachments persist across reload (integration) |
| AC-17 | 2, 7, 13 | Order persists (integration) + keyboard test |
| AC-18 | 13 | Keyboard-only reorder (client test) |
| AC-19 | 7, 13 | `cd client && pnpm test` |
| AC-20 | 7, 13 | `cd client && pnpm test` |
| AC-21 | 7, 13 | `cd client && pnpm test` |
| AC-22 | 13 | 16,000-token warning (client test) |
| AC-23 | 7, 13 | `cd client && pnpm test` |
| AC-24 | 5, 7, 13 | `missing` chip with working detach (client test) |
| AC-25 | 13 | `cd client && pnpm test` |
| AC-26 | 2, 7, 14 | Skill attachment persists (integration) |
| AC-27 | 14 | `cd client && pnpm test` |
| AC-28 | 9 | Trace carries the inherited document (integration) |
| AC-29 | 7, 9 | Disabled skill contributes nothing (unit + integration) |
| AC-30 | 9 | Trace segment contains current text (integration) |
| AC-31 | 4, 9 | Ordering unit test |
| AC-32 | 4, 9 | Dedup unit test + integration |
| AC-33 | 9 | Second-repo run omits the first repo's docs (integration) |
| AC-34 | 9 | Missing document skipped + logged + recorded (integration) |
| AC-35 | 4, 9 | Truncation marker unit test |
| AC-36 | 4, 9 | Budget-drop unit test |
| AC-37 | 9 | Assembly lives in the executor - `pnpm arch:check` + code placement |
| AC-38 | 3, 9 | Byte-identical prompt without attachments (`npm test` in reviewer-core) |
| AC-39 | 9 | Trace text unchanged after the document is edited (integration) |
| AC-40 | 1, 9, 15 | Statused `specs_read` (integration + client test) |
| AC-41 | 1, 9, 15 | `≈N tok` badge (client test) |
| AC-42 | 3, 15 | Section order (`npm test`) + drawer order (client test) |
| AC-43 | 15 | `cd client && pnpm test` |
| AC-44 | 1, 15 | Old `string[]` trace opens (client test) |
| AC-45 | 3 | Existing engine behaviour, pinned by a new test |
| AC-46 | 3 | Existing engine behaviour, pinned by a new test |
| AC-47 | 4, 6, 7, 9 | Path-validation unit test |
| AC-48 | 6, 7 | Path-not-in-list unit + integration test |
| AC-49 | 12 | `<script>` and `javascript:`/`mailto:` (client test) |
| AC-50 | 6, 9, 10 | `git status` assertion in `assembly.it.test.ts` |
| AC-51 | 9 | Constructive - `logPromptAssembly` takes text and returns measurements only |
| Default: `approxTokens` for scan/budgets, tiktoken for `specs_tokens` | 4, 9 | Scan under 5,000 ms; `specs_tokens` non-null in the trace |
| Default: two panes, not three | 12 | Client test for the sub-900px collapse |
| Default: e2e covers the clone-less states only | 16 | `./scripts/e2e.sh` |

## Lessons from INSIGHTS.md applied

- "The DB schema already contains EVERY table" is FALSE for L05 - `server/INSIGHTS.md:83-92`.
- `MockGitClient.readFile` returns `''` for a missing path - `server/INSIGHTS.md:250-253`. The
  single most consequential lesson here: step 9's "unreadable" branch must catch a throw OR a
  blank body, and step 10's fixtures must cover both.
- Services build their own repository from `container.db` - `server/INSIGHTS.md:170-180`. Shapes
  step 6's constructor and forces the pure logic into `walk.ts`/`paths.ts`/`assemble.ts`.
- Any table with a `running` status needs a boot reaper - `server/INSIGHTS.md:51-61`. Removed a
  `running` column from the scan table; the guard is an in-memory single-flight map. Same entry
  drives `{ timeoutMs }` on `jobs.register`.
- `drizzle-kit generate` goes interactive and hangs on piped stdin - `server/INSIGHTS.md:242-249`.
- An integration test that omits `secrets: new MockSecretsProvider({})` spends real money -
  `server/INSIGHTS.md:94-105`.
- Poll the trace document, not `agent_runs.status` - `server/INSIGHTS.md:107-111`.
- A module that OWNS tables needs a repository - `server/INSIGHTS.md:124-133`.
- A table without `workspace_id` gets tenancy from the layer above, and the repository doc comment
  must say so - `server/INSIGHTS.md:196-202`.
- Do not add a second injection-guard restatement beside a new untrusted slot -
  `reviewer-core/INSIGHTS.md:31-35`.
- Adding a top-level page to the sidebar REQUIRES editing vendored `nav.ts`; it is the one
  sanctioned exception, data-only - `client/INSIGHTS.md` [2026-08-02].
- The drawer's prompt-assembly list is hand-enumerated - `client/INSIGHTS.md` [2026-08-07].
  `specs` already has its `PromptBlock`, colour and string; only the badge and label are missing.
- Importing the `@devdigest/ui` barrel into anything the root layout reaches without a
  `"use client"` boundary breaks SSR, and `pnpm build` does not catch it - `client/INSIGHTS.md`.
- `e2e/specs/04-pr-findings.flow.json` asserts a literal substring - append, never replace.
- Contract copies already drift in four files; scope `diff -q` to touched files -
  `INSIGHTS.md:43-50`.
- `CLAUDE.md` is a symlink to `AGENTS.md` - a plan listing both means ONE edit -
  `INSIGHTS.md:56-64`.
- reviewer-core is an **npm** package - `server/INSIGHTS.md:237-240`.
- Default shell node is v17; prefix `PATH` with the nvm v22.18.0 bin - `INSIGHTS.md:112-116`.

## Recommendations

- **Count scan tokens with `approxTokens`, not the tiktoken encoder.** The spec's NFR names "the
  existing tokenizer adapter, with the `ceil(chars/4)` fallback"; `approxTokens` is that adapter's
  exported fallback. Running the synchronous encoder over up to 500 documents inside an HTTP
  request would block the event loop of the process serving the SSE run stream, and the truncation
  search calls the counter repeatedly per oversized document. Using it uniformly also makes the
  number the user sees identical to the number the budget enforces.
- **Delete the dead client scaffolding rather than leaving a second, broken data path.**
  `useContextFiles` / `useReindexContext` point at `/repos/:id/context/reindex`, which this feature
  does not build, and `context.json` is full of keys for the cut editing mode.
- **Consider naming the 8,000 ceiling in the tab's warning copy**, not just the 20,000. A user who
  attaches one 9,000-token document gets a silent truncation at run time with no pre-run signal,
  because the tab's warning only fires on the 16,000 aggregate. Not required by the spec.
- **Consider a per-document `truncated` preview chip on the Context tab** for the same reason.

## Risks and forks

- **AC-42's observation point is the trace drawer, not the prompt.** It can be read as governing
  only the drawer's segment order. This plan changes BOTH engine and drawer, because a list
  labelled "Prompt assembly" that shows a different order from the actual prompt is worse than
  either order. The cost is contradicting a written rationale at `prompt.ts:48-53`, which the plan
  therefore rewrites.
- **Two panes or three.** The NFR says "below 900 px the three panes collapse to tree-then-viewer",
  but AC-8..AC-15 define only a tree and a viewer. The plan builds two. If a third pane was meant
  (an attachment rail, presumably), step 12 grows.
- **No clone exists in any seeded stack.** `seed.ts` sets `clonePath: null` and `scripts/e2e.sh`
  starts an ephemeral Postgres, so the e2e flow cannot open a document or attach one. Faking a
  clone would mean writing into `server/clones/**`, which is do-not-touch.
- **`@tanstack/react-virtual` in jsdom.** jsdom has no layout, so `useVirtualizer` measures zero
  height and renders zero rows - a component test over a virtualised list silently asserts
  nothing. The 100-row threshold keeps every fixture on the plain path.
- **Keyboard navigation over a virtualised tree.** The focused row may not be mounted, hence
  `scrollToIndex` before focus and hand-set `aria-setsize`/`aria-posinset`. The least certain part
  of step 12; worth a targeted review.
- **Scan duration on a real 500-document repository is unmeasured.** The 5,000 ms NFR is a designed
  number, not an observed one.
- **`JobRunner` does not re-hydrate on restart** - a scan job queued when the process dies is lost.
  The lazy scan in step 6's `list` covers the consequence.
- **`agent_context_docs` has no `workspace_id`.** Tenancy comes entirely from step 7's validation
  of every incoming `repo_id`. Drop that check in a later refactor and an agent can be pointed at
  a repo in another workspace - exactly the shape `server/INSIGHTS.md:196-202` warns about.

## Alternatives rejected

- **One polymorphic `context_docs(owner_kind, owner_id, …)` table.** A polymorphic `owner_id`
  cannot carry a real FK, so deleting an agent or a skill would leave orphans that only
  application code cleans up; the repo's own shape is one link table per relation.
- **Scanning on every list request instead of persisting descriptors.** Cannot meet the 200 ms
  list NFR, cannot compute `used_by_agents` without a second pass, and would make AC-24's
  `missing` chip a filesystem probe per row.
- **A background job for `refresh` with UI polling.** The spec's only refresh feedback is the
  footer's scan time, so polling would be a surface the spec never designed. Both entry points
  call the same `service.scan()`.
- **Validating paths only at read time.** An attachment row is written by the client and read by
  the run executor months later. Validating on write too means a stored path can never be a
  traversal.
- **Consulting `project_docs` during run assembly.** The spec's edge case says a run "reads the
  clone directly, so it never waits on the scan and never sees a half-written list".
- **Hand-rolled windowing instead of `@tanstack/react-virtual`.** It would have to re-implement
  `scrollToIndex` and dynamic measurement to satisfy the arrow-key NFR.
- **Editing `client/src/vendor/ui/primitives/Markdown.tsx` to add `urlTransform`.** The vendored
  kit is frozen except `nav.ts`, and its existing consumers render content that does not want the
  narrower allowlist.
- **Finding a non-vendored way to register the sidebar entry.** Investigated and rejected as
  impossible: `Sidebar.tsx`, `useShellCommands.ts`, `useGlobalShortcuts.ts` and `ShortcutsHelp.tsx`
  all import `NAV`/`SHORTCUTS` directly from the vendored module, and `AppFrame` accepts only
  `{ctx, crumb, children}`. There is no seam.
