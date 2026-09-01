## Plan: Export to CI, iteration 2 - a real CI runner, PR-opening install, installation state, and the CI Runs page

Spec: `docs/specs/L06-export-ci.md` (this iteration falsifies its AC-3 and AC-17; see Stop conditions)
Rationale: `docs/plans/l06-export-ci-next.rationale.md`

### Open decisions - answer before Step 3 starts

**Q1 - the runner: self-hosted, or a hosted GitHub Action?**
Planned against the **self-hosted** path: the generated workflow runs on
`runs-on: [self-hosted, devdigest]` and invokes the existing `mcp/bin/devdigest`
CLI, which reaches the local API. The alternative is a hosted action bundling
`reviewer-core` with a model key in repo secrets - that needs a sixth package, an
`ncc` `dist/` commit, `node24`, and it still cannot run on fork PRs (on
`pull_request` from a fork, repo secrets are withheld and `GITHUB_TOKEN` is
read-only). **Default: self-hosted.** If hosted is chosen, Steps 2 and 3 are
wrong and the plan needs redoing.

**Q2 - should the server post the GitHub review?**
Planned **yes**: `POST /ci-runs` runs the review, posts it via the existing
`container.github().postReview` port with the user's PAT, and records the run -
so `post_as` finally means something and the workflow needs only
`permissions: contents: read`. The alternative is gate-and-record only (exit code
plus artifact), leaving `post_as` inert for another iteration.
**Default: post it**, gated on the repo having a `ci_installations` row.

**Q3 - "Fail CI on" on the CI tab.**
The mockup puts it there; the field is *already* a live control on the Config tab
(`ConfigTab.tsx:121`), and L06's spec left this `open`. Planned as a **second
live control on the CI tab bound to the same `agents.ci_fail_on` field** - one
source of truth, two views. Alternative: render it read-only with a link to
Config. **Default: second live control.**

### Understanding

Move the four fences L06 deliberately put up: make the generated workflow actually
run a review, open a PR with the generated files, persist and read
`ci_installations`, and populate + display `ci_runs`. In scope: the `ci` server
module, the `mcp` CLI, the agent editor's CI tab, and a new `/ci-runs` page.
Out of scope: a GitHub-hosted (non-self-hosted) runner, fork-PR support, the
CircleCI/Jenkins/CLI targets, memory export, and any zip archive.

### Architectural constraints

- **The two contract copies.** `server/src/vendor/shared/contracts/eval-ci.ts` is
  canonical, `client/src/vendor/shared/contracts/eval-ci.ts` is the client's copy;
  both change in ONE step (Step 2), never split - source: root `AGENTS.md`,
  `.claude/repo-facts.md`. There is no sync script.
- **That file is already drifted and the drift is not yours to fix.** The client
  copy lacks `AgentManifest`; `.claude/repo-facts.md` lists `contracts/eval-ci.ts`
  as pre-existing drift. Verify your change on the symbols you added, never a
  whole-file `diff -q`.
- **No schema change, no migration.** `ci_installations` and `ci_runs` already
  exist (`server/src/db/schema/ci.ts:4-26`) and carry every column this plan
  needs. If any step reaches for `pnpm db:generate`, stop - see Stop conditions.
  Source: `server/AGENTS.md` (`server/src/db/migrations/**` is generated).
- **`queries-live-in-repositories`** - only `server/src/modules/ci/repository.ts`
  may import `drizzle-orm`. Source: `server/.dependency-cruiser.cjs:33-45`.
- **`routes-are-transport-only`** - `ci/routes.ts` declares zod schemas and calls
  ONE service method; no `drizzle-orm`, no `src/db`. Source:
  `server/.dependency-cruiser.cjs:9-17`.
- **`no-cross-module-imports`** - a module may import another module's
  `service.ts`, `types.ts` or `constants.ts` only. `ci/service.ts` therefore
  imports `reviewDiff` from `modules/reviews/service.ts` (Step 2 adds the
  re-export line beside the existing one at `reviews/service.ts:13`), NEVER from
  `modules/reviews/diff-review.ts`. Source:
  `server/.dependency-cruiser.cjs:47-71`.
- **`modules-use-ports-not-clients`** - reach GitHub only through
  `await app.container.github()` (`server/src/platform/container.ts:159-166`),
  never `new OctokitGitHubClient()`. Source:
  `server/.dependency-cruiser.cjs:73-84`.
- **Schema-first route validation** - zod via `fastify-type-provider-zod`; never
  `Schema.parse(req.body)`. Source: `server/AGENTS.md`.
- **`ci_installations` and `ci_runs` carry NO `workspace_id`** (they are the only
  domain tables without one). Tenancy comes from the layer above: resolve the
  agent with `container.agentsRepo.getById(workspaceId, agentId)` first, and scope
  every `ci_runs` read by joining `ci_installations -> agents.workspace_id`. Say
  so in the repository's doc comment - `server/INSIGHTS.md:465-471` records this
  exact trap for `pr_intent`.
- **mcp is a standalone zod-4 package.** `mcp/src/**` must not import `server/`,
  `client/` or `reviewer-core/`, must not pull in `octokit`/`drizzle`/`fastify`,
  and `src/cli/**` reaches the API only through `src/api/index.ts`. Source:
  `mcp/.dependency-cruiser.cjs` rules `mcp-is-standalone`,
  `mcp-has-no-db-or-framework`, `cli-goes-through-the-api-port`.
- **Client: `import type` only from `@devdigest/shared`.** The first RUNTIME
  value import from that barrel breaks `pnpm build` (and therefore
  `./scripts/e2e.sh`) while typecheck/lint/test stay green. Source:
  `client/INSIGHTS.md:318-329`.
- **A Next App Router `page.tsx` may export nothing but the route contract.**
  Constants go in a sibling file. Source: `client/INSIGHTS.md:74-83`.
- **Adding a nav entry means editing `client/src/vendor/ui/nav.ts`** - the one
  sanctioned, data-only exception to the vendored-UI freeze. `activeKeyFor`
  already branches on `"ci-runs"` (`client/src/components/app-shell/helpers.ts:38`)
  and `messages/en/shell.json` already has `nav.ci-runs`: do NOT re-add either.
  Source: `client/INSIGHTS.md:158-169`.
- **Do not touch:** `client/src/vendor/ui/**` except the `nav.ts` data edit;
  `server/src/db/migrations/**`; `server/clones/**`; `.env` files.
- **This iteration invalidates two shipped L06 acceptance criteria** - AC-3 ("shall
  not display any count of repositories, installation status, or past CI run")
  and AC-17 ("shall mark the workflow's review step as a placeholder"). Existing
  assertions pinning them are named per step and must be UPDATED, not deleted
  wholesale. The spec itself is not yours to edit - see Stop conditions.

### Skills for the implementer

| Step | Skill | Why |
| --- | --- | --- |
| 1 | `onion-architecture` | First `ci` repository; the module gains a data layer and a cross-module GitHub port call. |
| 1 | `drizzle-orm-patterns` | `ci_installations` insert/select, the `agents` join for tenancy. |
| 1 | `fastify-best-practices` | Two new routes on the existing `ci` plugin; per-route rate limit. |
| 2 | `zod` | Two new contracts + one additive field, in both vendor copies. |
| 2 | `onion-architecture` | `ci/service.ts` composes reviews-module service + GitHub port + own repository; transaction boundary. |
| 2 | `fastify-best-practices` | `POST /ci-runs`: body schema, `bodyLimit`, tight `rateLimit`. |
| 3 | `zod` | `mcp/src/api/schemas.ts` is **zod 4**, not zod 3 - the API differs. |
| 4 | `frontend-ui-architecture` | Where the installed-state UI and the install step live; no sibling-feature imports. |
| 4 | `react-best-practices` | New mutation/query state in `CiTab` and the wizard. |
| 5 | `next-best-practices` | New App Router segment: `page.tsx` + `layout.tsx` conventions. |
| 5 | `frontend-ui-architecture` | Colocated `_components/CiRunsView`; hook + query keys in `lib/hooks/ci.ts`. |
| 5 | `fastify-best-practices` + `drizzle-orm-patterns` | `GET /ci-runs` and its workspace-scoped join. |

### Steps

---

**Step 1 - Persist installations and open a PR with the generated files**

- Files:
  - `server/src/db/rows.ts:27` (append `CiInstallationRow`, `CiRunRow`, following
    the existing `typeof t.x.$inferSelect` convention)
  - `server/src/modules/ci/repository.ts` (new)
  - `server/src/modules/ci/constants.ts` (new)
  - `server/src/modules/ci/service.ts:19-49`
  - `server/src/modules/ci/routes.ts:20-27`
- Does:
  - `CiRepository` (constructor takes `Db`, the only file here importing
    `drizzle-orm`): `listInstallationsForAgent(agentId)`,
    `findInstallation(agentId, repo)`, `upsertInstallation({agentId, repo,
    targetType})` (insert, or return the existing row for the same
    `(agent_id, repo)` - there is no unique index, so read-then-insert inside a
    service-owned `transaction`), and `installationForRepo(workspaceId, repo)`
    joined through `agents` for tenancy.
  - `constants.ts`: `CI_BRANCH = 'devdigest/ci'`,
    `CI_PR_TITLE = 'Add DevDigest CI review'`, `CI_COMMIT_MESSAGE`,
    and `parseRepoRef(repo: string): RepoRef | null` (splits `owner/name`, rejects
    anything else - this is untrusted input reaching a GitHub API path).
  - `CiService.export(workspaceId, agentId, input: CiExportInput): Promise<CiExport>`:
    resolve the agent via `container.agentsRepo.getById` (404 if absent, as
    `bundle()` already does at `service.ts:23-24`); build the files with the
    existing `buildBundle`; when `input.action === 'open_pr'`, call
    `(await container.github()).commitFiles(ref, {branch: CI_BRANCH, base:
    input.base, message, files})` then `findOpenPr(ref, CI_BRANCH)` and, only if
    that is null, `openPullRequest(ref, {title, head: CI_BRANCH, base, body})`;
    then upsert the installation and return `{installation, files, pr_url}`.
    When `action === 'files'`, skip every GitHub call and return `pr_url: null`.
  - `routes.ts`: `POST /agents/:id/export-ci`
    (`schema: { params: IdParams, body: CiExportInput }`,
    `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`) and
    `GET /agents/:id/ci-installations` (`schema: { params: IdParams }`) returning
    `CiInstallation[]`.
- Does NOT:
  - Touch `bundle.ts` (Step 3 owns the workflow body).
  - Touch `server/src/db/schema/ci.ts` or add a migration.
  - Add methods to `GitHubClient` - `commitFiles`, `openPullRequest` and
    `findOpenPr` already exist on the port (`server/src/vendor/shared/adapters.ts:155-163`),
    in the Octokit adapter (`server/src/adapters/github/octokit.ts:245-349`) and
    in `MockGitHubClient` (`server/src/adapters/mocks.ts:236-249`).
  - Change any contract - `CiExportInput`, `CiExport` and `CiInstallation` are
    already present and identical in BOTH vendor copies.
- Skills: `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices`
- Verify:
  `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` then
  `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'`

---

**Step 2 - The ingest endpoint: `POST /ci-runs` reviews, posts and records**

- Files:
  - `server/src/vendor/shared/contracts/eval-ci.ts:238-268` and
    `client/src/vendor/shared/contracts/eval-ci.ts:209-239` (BOTH, same step)
  - `server/src/modules/reviews/service.ts:13`
  - `server/src/modules/ci/constants.ts` (from Step 1)
  - `server/src/modules/ci/repository.ts` (from Step 1)
  - `server/src/modules/ci/service.ts`
  - `server/src/modules/ci/routes.ts`
- Does:
  - **Contracts, additively, in both copies:** add `repo: z.string().nullish()` to
    `CiRun` (the runs list needs it and the table has no repo column - it is
    joined from `ci_installations.repo`); add
    `CiRunInput = z.object({ repo, pr_number, diff, agent, post_as, fail_on,
    github_url })` reusing `MAX_REVIEW_DIFF_CHARS` from `./review-diff.js`; add
    `CiRunResult = z.object({ run: CiRun, review: ReviewDiffResponse, posted:
    z.boolean() })`. Export only NEW names - the barrel `export *`s every contract
    file and re-exporting an imported name is a duplicate-export build error
    (`INSIGHTS.md:81-87`).
  - `reviews/service.ts`: add `export { reviewDiff } from './diff-review.js';`
    directly beneath the existing `export { findingRowToDto, reviewToDto } from
    './helpers.js';` at line 13. This is the ONLY legal way for `ci/service.ts` to
    reach it.
  - `ci/constants.ts`: `failOnToSeverity(ciFailOn)` -
    `never -> undefined`, `critical -> 'CRITICAL'`, `warning -> 'WARNING'`,
    `any -> 'SUGGESTION'` (pure, no I/O).
  - `CiService.recordRun(workspaceId, input)`:
    1. `parseRepoRef(input.repo)` - reject a malformed value with a 400 `AppError`.
    2. `repo.installationForRepo(workspaceId, input.repo)` - **404 when there is
       no installation.** This is the containment control: an unauthenticated
       caller cannot aim a review or a GitHub write at an arbitrary repository.
    3. `reviewDiff(this.container, workspaceId, { diff: input.diff, agent:
       input.agent, fail_on: input.fail_on ?? failOnToSeverity(agent.ciFailOn),
       source: 'other' })`.
    4. When `input.post_as !== 'none'`: `(await container.github()).postReview(ref,
       input.pr_number, { body, event: result.blockers > 0 ? 'REQUEST_CHANGES' :
       'COMMENT' })`. `post_as: 'pr_comment'` maps to `event: 'COMMENT'`. A
       failure here is caught, logged, and returned as `posted: false` - a
       GitHub outage must not lose the recorded run.
    5. Insert the `ci_runs` row (`ci_installation_id`, `pr_number`, `ran_at:
       now()`, `status`, `findings_count`, `cost_usd` from
       `result.usage.cost_usd`, `github_url: input.github_url`, `source: 'gha'`).
       `status` is `'failed'` when `blockers > 0`, `'no_findings'` when
       `findings.length === 0`, else `'succeeded'`.
  - `routes.ts`: `POST /ci-runs`, `schema: { body: CiRunInput, response: { 200:
    CiRunResult } }`, `bodyLimit: DIFF_REVIEW_BODY_LIMIT_BYTES` imported from
    `../reviews/constants.js` (a `constants.ts` import is the documented
    cross-module exemption), `config: { rateLimit: { max: 4, timeWindow: '1
    minute' } }` - the same ceiling `POST /reviews/diff` uses
    (`reviews/routes.ts:75`) because this endpoint does the same billable work
    plus a GitHub write.
- Does NOT:
  - Add authentication. This server has none (`LocalNoAuthProvider` resolves a
    fixed user/workspace for every request) and inventing a scheme for one
    endpoint is out of scope - the installation gate, the rate limit and the body
    limit are the controls this step ships. Flagged for `/security-review`.
  - Download or unzip a GitHub artifact - ingest is push, not pull.
  - Add a unique key or dedup for `ci_runs` (see Risks).
  - Reshape `CiExportInput`'s loose `triggers: z.array(z.string())`.
- Skills: `zod`, `onion-architecture`, `fastify-best-practices`
- Verify:
  `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  then `cd client && pnpm typecheck && pnpm build`

---

**Step 3 - Make the workflow real: CLI `--mode branch` + a generator that emits it**

- Files:
  - `mcp/src/cli/modes.ts:26-49`
  - `mcp/src/cli/args.ts:12-20,68-125`
  - `mcp/src/cli/git.ts:86-105`
  - `mcp/src/cli/main.ts`, `mcp/src/cli/help.ts`, `mcp/src/cli/render.ts`
  - `mcp/src/api/index.ts:11-28,52-95`, `mcp/src/api/schemas.ts:256+`
  - `server/src/modules/ci/bundle.ts:32-56,140-186,192-221`
  - `server/src/modules/ci/service.ts:28-35`
  - `server/src/modules/ci/bundle.test.ts:145-155` (update assertions only)
  - `e2e/specs/13-export-ci.flow.json`
- Does:
  - **CLI.** Implement the already-registered `branch` mode: give `ModeDef` a
    `diffArgsFor?: (base: string) => string[]` alongside `diffArgs`, and have
    `branch` return the merge-base range so `collectDiff` produces the
    base-to-HEAD diff. Add flags `--base <ref>` (required by `branch`),
    `--repo <owner/name>`, `--pr <number>`, `--post-as <github_review|pr_comment|none>`,
    and `--ci-result <path>`. When `--repo` and `--pr` are both present, the CLI
    calls the new `ciRun` port method instead of `reviewDiff`; `--ci-result`
    writes a `CiResultArtifact`-shaped JSON file. Exit code stays what `exit.ts`
    already computes from blockers.
  - **API port.** Add `ciRun(body): Promise<s.CiRunResult>` to the `ApiClient`
    interface and `createApiClient` (`mcp/src/api/index.ts`), reusing
    `REVIEW_DIFF_TIMEOUT_MS`; add the mirrored `CiRunResult` schema to
    `mcp/src/api/schemas.ts` in **zod 4**. `src/cli/**` imports only
    `src/api/index.ts`.
  - **Generator.** Add `id: string` to `BundleAgent` (`bundle.ts:37-44`) and pass
    `row.id` from `service.ts:28-35`. Rewrite `workflowYaml` to emit:
    `permissions: { contents: read }` (the server posts the review with its own
    token, so the workflow needs no write scope);
    `runs-on: [self-hosted, devdigest]`;
    `actions/checkout@v4` with `fetch-depth: 0` and the PR head `ref`;
    a review step running the CLI with
    `--mode branch --base ... --repo ... --pr ... --agent <agent id> --post-as ... --ci-result devdigest-result.json`,
    with `DEVDIGEST_BASE`/`DEVDIGEST_PR`/`DEVDIGEST_REPO`/`DEVDIGEST_API_URL` set
    from GitHub Actions expressions kept in named constants beside
    `GITHUB_TOKEN_EXPR` (`bundle.ts:32`) so no Actions expression is ever read as
    a JS interpolation; and a final `actions/upload-artifact@v4` step with
    `if: always()`.
    Replace the "WHAT THIS DOES TODAY: nothing yet" header with one that states
    the self-hosted requirement, `$DEVDIGEST_CLI`, and `DEVDIGEST_API_URL`.
  - **Existing assertions.** `bundle.test.ts:145` pins `PLACEHOLDER` and
    `bundle.test.ts:151` pins the un-interpolated token expression - update the
    first to assert the real review step, keep the second (retarget it at whichever
    Actions expressions survive). Update the two `13-export-ci.flow.json` steps
    that wait on "The workflow does not run a review yet" and "Nothing is written
    to any repository".
- Does NOT:
  - Add any dependency to `mcp/` - it stays on the MCP SDK and zod only, and
    holds no GitHub token. Posting to GitHub is the server's job.
  - Import `reviewer-core`, `server/` or an octokit client anywhere under `mcp/src`.
  - Write NEW test cases anywhere; only update the assertions named above.
  - Change `slugify`/`uniqueSlugs`/`agentYaml` or the determinism property
    (L06 AC-15 still holds: same agent + same options = byte-identical files).
- Skills: `zod` (zod 4 in `mcp/`)
- Verify:
  `cd mcp && pnpm typecheck && pnpm arch:check && pnpm test && pnpm budget`
  then `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  then `cd e2e && pnpm typecheck`

---

**Step 4 - The CI tab stops being an explainer: installed state, repo list, install-by-PR**

- Files:
  - `client/src/lib/hooks/ci.ts:1-18`
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx`
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/styles.ts`
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx:33,42` (update assertions only)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportCiWizard/ExportCiWizard.tsx:33-107,189-243`
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportCiWizard/ExportCiWizard.test.tsx:170` (update assertion only)
  - `client/messages/en/ci.json`
- Does:
  - `lib/hooks/ci.ts`: add a `ciKeys` object (following `evalKeys` in
    `lib/hooks/eval.ts:18-27` - query keys live in the hook file, never in a
    component), `useCiInstallations(agentId)` over
    `GET /agents/:id/ci-installations`, and `useExportCi(agentId)` over
    `POST /agents/:id/export-ci` invalidating `ciKeys.installations(agentId)`.
  - `CiTab.tsx`: when installations exist, render "Active in N repos"
    (`ciTab.installed` already exists in `ci.json:103`) and the per-repo list with
    its `installed_at`; keep today's explainer as the empty state. Add the
    **"Fail CI on"** control bound to `agent.ci_fail_on` through the existing
    `useUpdateAgent` hook - the same field the Config tab writes
    (`ConfigTab.tsx:121`), not a second piece of state.
  - `ExportCiWizard.tsx`: the third step gains the install card - a target-repo
    input (`exportWizard.repoLabel`/`repoHint`/`repoPlaceholder` already exist)
    and an **Install** button that calls `useExportCi` with
    `{ repo, target, action: 'open_pr', post_as, triggers, base: 'main' }`, then
    shows the returned `pr_url` (`publishDialog.openPr`). Per-file copy and
    download stay. Replace the `placeholderTitle`/`placeholderBody` note with a
    self-hosted-runner note; add the new keys to `ci.json`.
- Does NOT:
  - Import a runtime value from `@devdigest/shared` - `import type` only
    (`client/INSIGHTS.md:318-329`).
  - Import a sibling feature's `_components` (`pnpm lint` rejects it).
  - Add a repo picker that fetches `/repos` - a free-text `owner/name` field is
    what `CiExportInput.repo` accepts, and the server validates it.
  - Write new test cases; only update the two named obsolete assertions.
- Skills: `frontend-ui-architecture`, `react-best-practices`
- Verify:
  `cd client && pnpm typecheck && pnpm lint && pnpm test && pnpm build`

---

**Step 5 - The CI Runs page**

- Files:
  - `server/src/modules/ci/repository.ts`, `service.ts`, `routes.ts`
  - `client/src/lib/hooks/ci.ts`
  - `client/src/app/ci-runs/page.tsx` (new)
  - `client/src/app/ci-runs/layout.tsx` (new)
  - `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,constants.ts,styles.ts,index.ts}` (new)
  - `client/src/vendor/ui/nav.ts:30-37,58-71`
- Does:
  - Server: `CiRepository.listRuns(workspaceId, limit)` - select from `ci_runs`
    inner-joined to `ci_installations` and `agents`, filtered on
    `agents.workspace_id`, ordered `ran_at desc`, capped at 200; project
    `repo` from the installation and `agent` from the agent name into the
    `CiRun` shape. `GET /ci-runs` on the existing `ci` plugin,
    `response: { 200: z.array(CiRun) }`.
  - Client: `useCiRuns()` in `lib/hooks/ci.ts` with a `ciKeys.runs()` key and
    `refetchInterval: 15_000` (the `runs.autoRefresh` string already exists).
  - `page.tsx` exports ONLY `metadata` and the default component - copy the shape
    of `client/src/app/eval/page.tsx`; `layout.tsx` copies
    `client/src/app/eval/layout.tsx` (`ShellLayout`). Any constant goes in
    `_components/CiRunsView/constants.ts`.
  - `CiRunsView.tsx`: header + Refresh button (an `invalidateQueries`, not a
    GitHub poll - nothing is pulled), the four filter dropdowns applied
    CLIENT-side over the bounded list, and the table whose columns are exactly the
    `runs.table.*` keys already in `ci.json:16-23`. Every string through
    `useTranslations("ci")`.
  - `nav.ts`: one `NAV` entry under `SKILLS LAB` -
    `{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs", gKey: "i" }`
    plus its `SHORTCUTS` row. Data edit only.
- Does NOT:
  - Edit `client/src/components/app-shell/helpers.ts` (the `ci-runs` branch is
    already there at line 38) or `messages/en/shell.json` (`nav.ci-runs` already
    present).
  - Edit anything else under `client/src/vendor/ui/**`.
  - Add server-side filter query params or an index on `ci_runs`.
- Skills: `next-best-practices`, `frontend-ui-architecture`,
  `fastify-best-practices`, `drizzle-orm-patterns`
- Verify:
  `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  then `cd client && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  then `./scripts/e2e.sh`

### Test strategy

**The implementer writes no tests.** Every step's completion is defined by the
existing commands above staying green, plus the falsifiable criteria below.

Three existing suites contain assertions this work deliberately invalidates, and
those assertions must be UPDATED in the step that breaks them (Step 3 and
Step 4), not left red and not deleted:
`server/src/modules/ci/bundle.test.ts:145`,
`client/.../CiTab.test.tsx:33,42`,
`client/.../ExportCiWizard.test.tsx:170`,
and two `wait --text` steps in `e2e/specs/13-export-ci.flow.json`.

No `*.it.test.ts` file is added. No schema change means no migration to test.

**What SHOULD be written later, by `test-writer`** (recorded here so the gap is
not lost):

| Suite | Coverage owed |
| --- | --- |
| `server/src/modules/ci/*.it.test.ts` (new, DB-backed) | `POST /agents/:id/export-ci` writes exactly one `ci_installations` row per `(agent, repo)` and re-export reuses it; `open_pr` calls `commitFiles` once and `openPullRequest` only when `findOpenPr` is null (assert via `MockGitHubClient.committed` / `.openedPrs`); 404 for an unknown agent. Must pass `secrets: new MockSecretsProvider({})` AND every `overrides.llm` provider, or it makes real billable calls (`server/INSIGHTS.md:248-259`). |
| same file | `POST /ci-runs` 404s for a repo with no installation; records one `ci_runs` row with the right `status` for each of blockers / no findings / findings-below-gate; still records the run when `postReview` throws. |
| `server/src/modules/ci/bundle.test.ts` (hermetic) | The emitted workflow parses as YAML; `permissions` is `contents: read`; the CLI invocation interpolates no agent-authored text; determinism across two calls still holds. |
| `mcp/src/cli/*.test.ts` (hermetic) | `parseArgs` table for `--base`/`--repo`/`--pr`/`--ci-result`, including `--mode branch` without `--base`; `branch` mode's diff args; `--ci-result` writes a file matching `CiResultArtifact`. |
| `client` (jsdom) | `CiTab` renders the repo list and the count from `useCiInstallations`; the wizard's Install step calls `useExportCi` with the right body and renders the returned PR link; `CiRunsView` filters client-side and renders the status labels. `navigator.clipboard` and any deferred call need the stubs described in `client/INSIGHTS.md:261-283`. |
| `e2e/specs/13-export-ci.flow.json` + a new `14-ci-runs.flow.json` | The install step is reachable and the `/ci-runs` page renders on seeded data. Deterministic locators only - no `chat`. |

### Non-functional requirements

- **i18n** - every new user-facing string is a `next-intl` key in
  `client/messages/en/ci.json`; no literal English in a component. Steps 4 and 5.
- **Client bundle** - `import type` only from `@devdigest/shared`, or `pnpm build`
  breaks while typecheck stays green. Steps 2, 4, 5.
- **Determinism** - `buildBundle` stays pure, clock-free and DI-free; two
  identical requests still produce byte-identical files. Step 3.
- **Cost containment** - `POST /ci-runs` inherits the four limits that guard
  `POST /reviews/diff`: socket `bodyLimit`, the 400k-char zod bound, the
  200-file service cap, and a 4/min rate limit. Step 2.
- **Data volume** - `ci_runs` has no index beyond its PK and the list is capped at
  200 rows; acceptable at this scale, and named here so a later growth problem is
  traceable. Step 5.
- **Security, not reviewed here:** `POST /ci-runs` is an unauthenticated endpoint
  that spends model budget and writes a review to GitHub with the user's PAT; its
  only containment is the installation gate, the rate limit and the body limit.
  `parseRepoRef` is the single place untrusted `owner/name` becomes a GitHub API
  path. `CiExportInput.repo` reaches `commitFiles`, which writes to a real
  repository. Hand all three to `/security-review`.

### Stop conditions

- The runner question (Q1) was answered "hosted GitHub Action" rather than
  "self-hosted" - Steps 2 and 3 are built on the wrong model; stop and re-plan.
- Any step needs `pnpm db:generate` - this plan asserts zero schema change; stop
  and report which column is missing rather than generating a migration.
- `commitFiles` or `findOpenPr` does not behave as its doc comment claims
  (`server/src/vendor/shared/adapters.ts:156-163`) - stop rather than adding
  methods to the port.
- A depcruise rule fires and the only apparent fix is an allowlist entry or a
  widened rule - stop; the placement is wrong, not the rule.
- The work appears to require editing `docs/specs/L06-export-ci.md` (its AC-3 and
  AC-17 are now false) - do not edit it. Report it; specs belong to `specreator`.

### Acceptance criteria

- [ ] `POST /agents/:id/export-ci` with `action: "open_pr"` returns
      `{installation, files, pr_url}` and a `ci_installations` row exists for that
      `(agent, repo)` - verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` green, plus a
      `curl -s -XPOST localhost:3001/agents/<id>/export-ci -d '{"repo":"acme/payments-api","action":"files"}'`
      against `./scripts/dev.sh` returning a `CiExport` shape.
- [ ] A second export for the same `(agent, repo)` returns the SAME installation
      id and does not open a second PR - verify: the two responses' `installation.id` match.
- [ ] `GET /agents/:id/ci-installations` returns `CiInstallation[]` and 404s for an
      unknown agent - verify: a curl against an unknown uuid prints 404.
- [ ] `POST /ci-runs` for a repo with NO installation answers 404 and writes no
      `ci_runs` row - verify: the same curl with an unknown repo prints 404.
- [ ] `POST /ci-runs` for an installed repo records exactly one `ci_runs` row and
      returns `{run, review, posted}` - verify: `select count(*) from ci_runs;` increments by one.
- [ ] `CiRunInput`, `CiRunResult` and `CiRun.repo` are byte-identical in both
      vendor copies - verify: a `diff` of the added block across the two files prints nothing.
- [ ] `devdigest review --mode branch --base <ref>` produces a merge-base diff
      instead of the "not implemented" message - verify: a real run in a git worktree.
- [ ] `devdigest review ... --ci-result out.json` writes a file that parses against
      `CiResultArtifact` - verify: `node -e "JSON.parse(require('fs').readFileSync('out.json'))"` plus the field names.
- [ ] The generated workflow contains no `PLACEHOLDER`, carries
      `permissions: contents: read`, `runs-on: [self-hosted, devdigest]` and an
      `actions/upload-artifact@v4` step - verify:
      `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` green (updated `bundle.test.ts`).
- [ ] The generated workflow still parses as YAML and is byte-identical across two
      identical requests - verify: the existing AC-15 case in `bundle.test.ts` stays green.
- [ ] The CI tab shows a repo count and per-repo list when installations exist, and
      today's explainer when none do - verify: `cd client && pnpm test` green.
- [ ] The CI tab's "Fail CI on" control writes `agents.ci_fail_on` and the Config
      tab reflects the change - verify: manual, switch tabs after changing it.
- [ ] `/ci-runs` renders, is reachable from the sidebar, and the sidebar entry is
      highlighted on that route - verify: `cd client && pnpm build` green and
      `./scripts/e2e.sh` green.
- [ ] `pnpm arch:check` passes in `server/` and `mcp/` with no new allowlist entry -
      verify: `git diff --stat server/.dependency-cruiser.cjs mcp/.dependency-cruiser.cjs` is empty.

### Deliberately out of scope

- **A GitHub-hosted runner** (a bundled JS action with a model key in repo
  secrets). It needs a sixth package, an `ncc` `dist/` commit and a `node24`
  action, and it still cannot run on fork PRs. Its own spec, via `specreator`.
- **Fork-PR support.** On `pull_request` from a fork, repo secrets are withheld
  and `GITHUB_TOKEN` is read-only; `pull_request_target` is the documented
  workaround and carries the pwn-request risk. Not attempted.
- **Pull-based ingest** (listing and downloading workflow-run artifacts through
  the GitHub API). Ingest is push, from the runner.
- **`ci_runs` deduplication** - no unique key, so a re-run of the same workflow
  records a second row.
- **CircleCI / Jenkins / generic CLI targets**, memory export, the zip archive,
  and in-wizard file editing - all still fenced by L06.
- **Superseding `docs/specs/L06-export-ci.md`** - this work falsifies its AC-3 and
  AC-17; the spec update belongs to `specreator`.
- **Authentication for `POST /ci-runs`** and the trust boundary around
  `CiExportInput.repo` - for `/security-review`, not for this plan.
