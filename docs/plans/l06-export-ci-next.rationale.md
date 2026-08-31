## Rationale: Export to CI, iteration 2 - runner, PR-opening install, installation state, CI Runs page

Companion to `docs/plans/l06-export-ci-next.md`.

### Affected modules

| Package / module | What changes | Why |
| --- | --- | --- |
| `server/src/modules/ci` | Gains `repository.ts` + `constants.ts`; `service.ts` grows `export()` and `recordRun()`; `routes.ts` grows four endpoints; `bundle.ts`'s `workflowYaml` is rewritten | It owns `ci_installations` and `ci_runs`, and it owns the generated workflow |
| `server/src/modules/reviews` | One re-export line in `service.ts` | `no-cross-module-imports` exempts only `service.ts`/`types.ts`/`constants.ts`, and `reviewDiff` lives in `diff-review.ts` |
| `server/src/db/rows.ts` | Two row types appended | The file's stated purpose is exactly this - cross-cutting consumers referencing a row without importing another module's data layer |
| both `vendor/shared/contracts/eval-ci.ts` | `CiRunInput`, `CiRunResult`, `CiRun.repo` | The ingest endpoint's request/response; `CiRun` has no repo field and the runs list needs one |
| `mcp/src/cli` + `mcp/src/api` | `branch` mode implemented; five new flags; one new port method + its zod-4 schema | It is the only artifact that already reaches the DevDigest API and computes a git diff safely |
| `client` agent editor CI tab | Installed state, repo list, fail-on control, install-by-PR step | The mockups' CI tab, previously fenced off because nothing was persisted |
| `client` `/ci-runs` | New route, layout, view; one `nav.ts` data entry | The CI Runs page; every other wiring point is pre-shipped |

### Verified facts this plan rests on

| Fact | Evidence |
| --- | --- |
| `commitFiles`, `openPullRequest` and `findOpenPr` already exist on the port, in the Octokit adapter and in the mock, and NO module calls them today | `server/src/vendor/shared/adapters.ts:155-163`; `server/src/adapters/github/octokit.ts:245-349`; `server/src/adapters/mocks.ts:236-249`; grep over `server/src/modules` found no callers |
| `commitFiles` is documented as idempotent (creates the branch from `base` if missing, else fast-forwards) and `findOpenPr` exists so re-publish reuses the PR | `server/src/vendor/shared/adapters.ts:156-163` |
| The container getter is `async github(): Promise<GitHubClient>` and throws `ConfigError` when `GITHUB_TOKEN` is unset; the override field is `github?: GitHubClient` | `server/src/platform/container.ts:44,159-166` |
| One global `GITHUB_TOKEN` via `LocalSecretsProvider`, with `GITHUB_PAT` as fallback; no per-workspace or per-repo token | `server/src/adapters/secrets/local.ts:37-42`; `server/src/vendor/shared/adapters.ts:292-297` |
| `ci_installations` and `ci_runs` exist with every column this plan writes; ids are `uuid ... defaultRandom()`; NEITHER has `workspace_id`, unlike essentially every other domain table | `server/src/db/schema/ci.ts:4-26`; contrast `server/src/db/schema/agents.ts:8-12` |
| `CiExportInput`, `CiExport`, `CiInstallation`, `CiRun`, `CiResultArtifact`, `CiTarget`, `CiFile` are present and identical in BOTH vendor copies; the ONLY structural drift in `eval-ci.ts` is `AgentManifest`, missing client-side | `diff` of `^export const` lines across the two copies |
| `POST /reviews/diff` already reviews a raw diff with an agent and a `fail_on`, persists nothing, and returns findings + blockers + usage | `server/src/modules/reviews/routes.ts:70-81`; `server/src/vendor/shared/contracts/review-diff.ts:39-94` |
| `reviewDiff` is a FUNCTION in `reviews/diff-review.ts:50`, not a `ReviewService` method - so a cross-module call needs a re-export from `service.ts`, and that file already re-exports helpers on line 13 | `server/src/modules/reviews/diff-review.ts:50`; `server/src/modules/reviews/service.ts:13` |
| The `/reviews/diff` limit stack is four independent controls: 2 MB `bodyLimit`, 400k zod chars, 200 files, 4/min | `server/src/modules/reviews/routes.ts:59-81`; `server/src/vendor/shared/contracts/review-diff.ts:28-37` |
| The server has NO authentication on any route; `LocalNoAuthProvider` resolves a fixed user/workspace regardless of the request; CORS is a single hardcoded localhost origin; there is no webhook or signature-checking route anywhere | `server/src/adapters/auth/local.ts:14-37`; `server/src/app.ts:99-114` |
| `mcp/src/cli/modes.ts` registers `branch` as explicitly not implemented, with `diffArgs: null`; `collectDiff(root, diffArgs)` is the seam | `mcp/src/cli/modes.ts:26-43`; `mcp/src/cli/git.ts:86-105` |
| `mcp` has exactly two runtime deps (MCP SDK, zod 4), holds no secret, has NO build step, and `bin/devdigest` execs `tsx` against TS source | `mcp/package.json:16-28`; `mcp/bin/devdigest:19`; `mcp/src/config.ts:1-13` |
| `mcp`'s depcruise forbids importing `server/client/reviewer-core/e2e`, forbids `octokit`/`drizzle`/`fastify`, and pins `src/cli/**` at `src/api/index.ts` | `mcp/.dependency-cruiser.cjs:14-34,47-56` |
| `reviewer-core` emits no JS (`build` is `tsc --noEmit`); nothing consumes a built output; its own header names an `agent-runner (CI)` consumer and an `@vercel/ncc bundle` that do not exist in this repo | `reviewer-core/package.json:14`; `reviewer-core/src/index.ts:8-12`; `reviewer-core/src/llm/openrouter.ts:12-23` |
| The server-side review path pulls in DB, an on-disk clone, repo-intel, the GitHub client and a tokenizer - none available to a stateless runner | `server/src/modules/reviews/run-executor.ts:212-252`; `server/src/platform/container.ts:16-32` |
| `agents` has NO `slug` column, so the workflow must pass the agent's uuid to `--agent` | `server/src/db/schema/agents.ts:8-35` |
| `Severity` is `CRITICAL/WARNING/SUGGESTION` while `CiFailOn` is `never/critical/warning/any`, so a mapping function is required | `server/src/vendor/shared/contracts/findings.ts:11`; `server/src/vendor/shared/contracts/knowledge.ts:498` |
| `ci_fail_on` is ALREADY a live control on the Config tab and already accepted by the agent update route | `client/.../ConfigTab/ConfigTab.tsx:121`; `server/src/modules/agents/routes.ts:41,54,99` |
| The `/ci-runs` route is pre-wired everywhere except `nav.ts` and the page itself: `activeKeyFor` branches on it, `shell.json` has `nav.ci-runs`, and `ci.json` has `page.crumb` plus a complete `runs.*` block | `client/src/components/app-shell/helpers.ts:38`; `client/messages/en/shell.json`; `client/messages/en/ci.json:2-31,124-126` |
| The wizard's install copy is pre-shipped: `installCardTitle`, `installCardBody`, `repoLabel/Hint/Placeholder`, `ciTab.installed`, the whole `publishDialog.*` block | `client/messages/en/ci.json:58-60,73-74,103,108-123` |
| Adding a top-level page requires editing vendored `nav.ts`, the one sanctioned data-only exception | `client/INSIGHTS.md:158-169` |
| `VALID_TABS` is derived from `TABS` in `AgentEditor/constants.ts`; no page edit is needed to keep the CI tab reachable | `client/.../AgentEditor/constants.ts`; `client/INSIGHTS.md:74-83` |
| The obsolete assertions are exactly: `bundle.test.ts:145`, `CiTab.test.tsx:33,42`, `ExportCiWizard.test.tsx:170`, and two `wait --text` steps in `13-export-ci.flow.json` | direct read of each file |
| **External:** on `pull_request` from a fork, repo secrets are withheld and `GITHUB_TOKEN` is read-only - a hosted runner with a model key cannot work on fork PRs | GitHub Docs, "Events that trigger workflows" |
| **External:** GitHub states self-hosted runners "should almost never be used for public repositories," because anyone who can open a PR can compromise the runner and its secrets; the recommendation is private repos only | GitHub Docs, "Secure use reference" |
| **External:** `pull_request_target` grants base-repo secrets and a write token on fork PRs, and GitHub's rule is that the checked-out code must be treated as data and never executed - the pwn-request class | GitHub Docs, "Securely using pull_request_target" |
| **External:** JavaScript actions must ship a bundled `dist/`; `node20` is removed from GitHub-hosted runners on 2026-09-23, so a new action must target `node24` | GitHub Docs, "Creating a JavaScript action"; GitHub Changelog, 2025-09-19 |
| **External:** `actions/upload-artifact` v4+ is current; v4 artifacts are immutable and one artifact name cannot be written by two jobs; v3 is shut down | `actions/upload-artifact` README |
| **External:** `actions/checkout` defaults to `fetch-depth: 1`; a base-to-head diff needs `fetch-depth: 0`, and the PR head (rather than the merge commit) needs an explicit `ref` | `actions/checkout` README |
| **External:** posting a review needs `pull-requests: write`; prior art (`anthropics/claude-code-action`) requests `contents/pull-requests/issues/id-token: write` and defends fork PRs with an actor write-access check | GitHub Docs, "Secure use reference"; `anthropics/claude-code-action` security docs |

### Traceability

| Requirement | Step(s) | Acceptance criterion |
| --- | --- | --- |
| REQ-1 "The CI runner - investigate and RECOMMEND an approach with trade-offs stated" | Recommendations + Alternatives rejected below; implemented by Steps 2, 3 | Workflow contains no `PLACEHOLDER`, carries `permissions: contents: read`, `runs-on: [self-hosted, devdigest]` and `upload-artifact@v4`; `--mode branch --base` produces a merge-base diff; `--ci-result` writes a `CiResultArtifact` |
| REQ-2 "Open a PR with the generated files - `action: open_pr` via `POST /agents/:id/export-ci` returning `CiExport`" | Step 1 | `POST /agents/:id/export-ci` returns `{installation, files, pr_url}`; a second export reuses the same installation and opens no second PR |
| REQ-3 "Installation state - write and read `ci_installations`; Active in N repos, per-repo list, Fail CI on" | Steps 1, 4 | `GET /agents/:id/ci-installations` returns `CiInstallation[]` and 404s for an unknown agent; the CI tab shows the count and list; the Fail CI on control writes `agents.ci_fail_on` |
| REQ-4 "CI Runs page + ingest - `ci_runs`, an endpoint that ingests `CiResultArtifact`, the page with route, filters and table" | Steps 2, 5 | `POST /ci-runs` records exactly one row and 404s without an installation; `/ci-runs` renders, is reachable from the sidebar, and `pnpm build` + `./scripts/e2e.sh` are green |
| REQ-5 "At most 5 implementation agents" | Steps 1-5, one agent each | n/a - structural |
| REQ-6 "No new tests; per-step existing commands must pass; record the test gap separately" | every step's Verify line; Test strategy | `pnpm typecheck` / `pnpm lint` / `pnpm arch:check` / the existing suites green in `server`, `client`, `mcp`, `e2e` |
| REQ-7 "Reviewable by arch-evidence, architecture-reviewer and plan-verifier: concrete paths, falsifiable criteria, traceability" | Architectural constraints; per-step file lists; this table | `pnpm arch:check` passes in `server/` and `mcp/` with no new allowlist entry |
| CQ-1 default: self-hosted runner reaching the local API | Steps 2, 3 | as REQ-1 |
| CQ-2 default: the SERVER posts the GitHub review with its own PAT | Step 2 | `POST /ci-runs` returns `{run, review, posted}` |
| CQ-3 default: "Fail CI on" is a second live control on the same `agents.ci_fail_on` field | Step 4 | the Config tab reflects a change made on the CI tab |

Two shipped L06 criteria are deliberately falsified by REQ-3 and REQ-1 - **AC-3**
("shall not display any count of repositories, installation status, or past CI
run") and **AC-17** ("shall mark the workflow's review step as a placeholder").
They are cited here verbatim so the reviewer sees the invalidation was chosen,
not overlooked. The spec file itself is not edited by this plan.

### Lessons from INSIGHTS.md

- **Grep for the lesson's noun before building; the scaffolding often spans all
  three packages** - `INSIGHTS.md:10-40`. Acted on: it is why this plan adds
  almost no scaffolding. `commitFiles`/`openPullRequest`/`findOpenPr`, the two CI
  tables, every `Ci*` contract but two, the `ci-runs` `activeKeyFor` branch, the
  `nav.ci-runs` message, and the entire `runs.*`/`publishDialog.*` copy block all
  already exist.
- **Scaffolding can be complete on the data side and absent on the execution
  side - check the executor** - `INSIGHTS.md:30-40`, written while spec'ing this
  very feature. Acted on: Step 3 exists because the binary the generated config
  invokes does not exist yet, and the plan says exactly which flags it gains.
- **A table with no `workspace_id` gets tenancy from the layer above, and the
  repository's doc comment must say so** - `server/INSIGHTS.md:465-471`
  (`pr_intent`). Acted on: a constraint in the plan and a required doc comment in
  Steps 1 and 5, so the next reader does not "fix" the unscoped `where`.
- **Shared knowledge two modules need belongs in `constants.ts`, because
  `no-cross-module-imports` exempts only service/types/constants** -
  `server/INSIGHTS.md:332-344`. Acted on: the `bodyLimit` comes from
  `reviews/constants.ts`, and `reviewDiff` is reached through a `service.ts`
  re-export rather than a folder reach-in.
- **A module that only joins other modules' data needs no repository; reach for
  one when the module OWNS a table** - `server/INSIGHTS.md:390-399`
  (`smart-diff`). Acted on inversely: `ci` DOES own two tables now, so
  `repository.ts` is correct here where it was wrong before.
- **A `*.it.test.ts` omitting `secrets: new MockSecretsProvider({})` makes real
  billable calls** - `server/INSIGHTS.md:248-259`. Recorded in the test-writer
  hand-off, since this plan writes no tests.
- **Adding an editor tab is a three-place edit and `VALID_TABS` is now derived** -
  `client/INSIGHTS.md:64-83`. Acted on: no tab is added, and Step 5 explicitly
  does NOT touch `helpers.ts` or `shell.json`, both already wired.
- **The first RUNTIME value imported from `@devdigest/shared` breaks `pnpm build`
  while typecheck, lint and test stay green** - `client/INSIGHTS.md:318-329`.
  Acted on: `import type` only, and `pnpm build` is a verify command on every
  client-touching step.
- **A Next `page.tsx` may export nothing but the route contract** -
  `client/INSIGHTS.md:74-83`. Acted on: Step 5 puts constants in a sibling file.
- **Adding a top-level page requires the vendored `nav.ts` data edit; everything
  else is automatic** - `client/INSIGHTS.md:158-169`. Acted on in Step 5.
- **`jsdom` implements neither `scrollIntoView` nor `navigator.clipboard`, and a
  deferred call needs `waitFor`** - `client/INSIGHTS.md:261-283`. Recorded in the
  test-writer hand-off.
- **Never hand-roll YAML for user- or model-authored text; use the `yaml`
  package** - `server/INSIGHTS.md:540-551`. Acted on: Step 3 rewrites only the
  workflow template (which contains no user text) and leaves `agentYaml`'s
  validate-serialize-reparse loop untouched.
- **`grep -rn ... --include=*.ts` must be quoted in this repo's zsh or it returns
  nothing and reads as "the code does not exist"** - `INSIGHTS.md:176-182`.
- **The default node here is v17 and breaks `pnpm`/`vitest`** - `INSIGHTS.md:186-190`.
  Acted on: the PATH prefix is in Step 1's verify line.

### Recommendations

- **The runner: recommend the self-hosted path, and say so in the product copy.**
  It reuses `POST /reviews/diff`, the user's existing key, their agents and skills,
  and needs no published artifact, no bundling and no model key in CI. Its
  honest limitation - GitHub's own guidance is that self-hosted runners belong on
  private repositories only - should be stated in the wizard's install step, not
  buried. The hosted action is the right *second* step, once there is evidence
  anyone wants CI review on a public or fork-heavy repo.
- **Let the server post the review, not the workflow.** The workflow then needs
  only `permissions: contents: read`, no `GITHUB_TOKEN` in a `run:` step, and no
  agent-authored text ever reaches a shell or a GitHub API call assembled in
  YAML. The cost is that the review appears as the user rather than as
  `github-actions[bot]`; that is a product choice worth making deliberately.
- **Gate `POST /ci-runs` on an existing installation.** This is the single
  cheapest control available on a server with no authentication: it means the
  endpoint cannot be aimed at a repository the user never installed the agent
  into, which bounds both the spend and the GitHub write. It also gives the four
  pieces a spine - installation state stops being decoration.
- **Do not duplicate "Fail CI on" as new state.** The field is already a live
  control on the Config tab; two controls over one field is fine, two pieces of
  state is a bug waiting to happen.
- **Filter the CI Runs table client-side.** The list is capped at 200 rows and
  `ci_runs` has no index beyond its PK; four server-side filter params would be
  more API surface than the data justifies. Revisit when the table grows.
- **Three pre-existing schema weaknesses to fix in a later, dedicated change**
  (not here, because this plan deliberately ships no migration): `ci_runs.status`
  is unconstrained `text` with a `CiRunStatus` enum already defined in the
  contract; there is no unique index on `ci_installations (agent_id, repo)`, so
  the upsert is a read-then-insert rather than an `ON CONFLICT`; and neither table
  indexes its FK column, which PostgreSQL does not do automatically. Adding a
  `github_run_id` + unique index at the same time would make ingest idempotent.
- **Send the spec back to `specreator`.** This iteration falsifies L06's AC-3 and
  AC-17 and answers its Open Questions 1 and 4. An L07 spec superseding L06 would
  keep the `AC-N` ids honest for the next planner.

### Risks and forks

- **The runner model is the whole bet.** If self-hosted is unacceptable, Steps 2
  and 3 are wasted work. This is Q1 and a Stop condition; do not start Step 3
  before it is answered.
- **`POST /ci-runs` is unauthenticated, spends money, and writes to GitHub.** The
  server has no auth of any kind and `POST /reviews/diff` already sets the
  precedent for "unauthenticated and billable" - but adding a GitHub write raises
  the stakes. The installation gate + 4/min + `bodyLimit` are the mitigations
  this plan ships. Recommend `/security-review` treat this endpoint as its
  primary target.
- **`ci_runs` has no dedup.** A re-run of the same workflow records a second row.
  Accepted for this iteration to keep the plan migration-free; the fix is a
  `github_run_id` column with a unique index, which is a schema change.
- **`ci_installations` has no unique constraint on `(agent_id, repo)`.** The
  upsert is read-then-insert inside a service-owned transaction, which is correct
  under this app's single-process, local-first usage but is not a database-level
  guarantee. Named so a reviewer does not read it as an oversight.
- **`$DEVDIGEST_CLI` is an unresolved ergonomic.** The generated workflow assumes
  the self-hosted runner's environment defines it. The alternative - hardcoding
  an absolute path into a committed workflow file - is worse. The install step's
  copy has to carry this, and it is the most likely place a first-time user gets
  stuck.
- **Five steps, five agents, no slack.** Step 2 is the heaviest (contracts in two
  copies + a composing service + a route). If the budget must shrink, defer
  **Step 5** (the CI Runs page): it is the only step whose value depends on
  earlier steps having already produced data, and `GET /ci-runs` against an empty
  table shows nothing. Deferring Step 1 or 2 instead would break the chain.
- **Step 3's assertion updates are load-bearing.** If the implementer rewrites
  `workflowYaml` without updating `bundle.test.ts:145`, the step's own verify
  command fails and the agent may "fix" it by weakening the assertion. The plan
  names the line numbers to make that visible to `plan-verifier`.
- **Unresolved externally:** the exact latest major of `actions/upload-artifact`
  (v4 confirmed current, later tags reported but unverified) and whether
  `GITHUB_TOKEN`'s self-review restriction can bite a bot review on a
  bot-authored PR. Neither changes a step; both are smoke-test items.

### Alternatives rejected

- **A sixth `agent-runner/` package: a `node24` JavaScript action bundling
  `reviewer-core` with `@vercel/ncc`.** This is what the code's own comments
  anticipate (`reviewer-core/src/index.ts:8-12`,
  `reviewer-core/src/llm/openrouter.ts:12-23`), and it is the right long-term
  answer. Rejected for this iteration: it needs a committed `dist/`, a published
  or vendored action, a model key as a repo secret, its own CI workflow and five
  edits to `scripts/repo-facts.sh` - and it still cannot run on fork PRs. It is a
  separate spec, not a step in this plan.
- **Pull-based ingest: the server lists and downloads workflow-run artifacts
  through the GitHub API.** More robust (it would also serve a hosted runner) and
  it matches the contract's own "ingested back on refresh" comment. Rejected
  because it needs two new port methods, artifact-zip handling, and a polling
  story - and with a self-hosted runner the runner can simply POST, which needs
  none of it. The Refresh button on the CI Runs page is therefore an
  `invalidateQueries`, and the plan says so rather than implying a GitHub round
  trip.
- **The CLI posts the review to GitHub itself with `fetch`.** Cheap, and
  `mcp-has-no-db-or-framework` bans the octokit *package* rather than plain
  `fetch`. Rejected because `mcp/src/config.ts:1-8` states as an invariant that
  the CLI holds no secret, and handing it a `GITHUB_TOKEN` breaks that on purpose
  rather than by accident.
- **A `gh api --input` step in the generated workflow.** Avoids interpolating
  model-authored text into a shell, but `gh` is not guaranteed on a self-hosted
  runner, and it would put review posting in a YAML template nobody can unit-test.
- **Widening `POST /reviews/diff` with optional `repo`/`pr_number` instead of a
  new `POST /ci-runs`.** One fewer endpoint, but it would put `ci_runs` writes and
  a GitHub write inside the reviews module, which owns neither - and it would make
  a documented "persists nothing" endpoint start persisting.
- **Server-side filter query params on `GET /ci-runs`.** Rejected as more API
  surface than a 200-row list justifies; see Recommendations.
