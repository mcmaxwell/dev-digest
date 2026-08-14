# Insights — repo-wide

Append-only lessons that span packages, kept in fixed sections — append into
the matching one, never rewrite old entries. Package-specific lessons go to
`<package>/INSIGHTS.md` instead. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

- [2026-08-02] Before building a lesson feature, grep for its noun across the
  whole repo — this starter pre-ships most of the scaffolding and it is easy to
  rebuild something that already exists. "conventions" turned up an empty DB
  table, a `ConventionCandidate` contract, a `conventions` entry in
  `FEATURE_MODELS`, `repoIntel.getConventionSamples()`, a finished
  `client/messages/en/conventions.json`, a pre-wired `activeKeyFor` branch, and
  a comment in `adapters/mocks.ts` naming the intended two-step LLM flow
  (`ConventionFileSelection` → `ConventionExtraction`). The mock adapters'
  comments in particular document the SHAPE a lesson's model calls are meant to
  take — read them before designing the pipeline.
  - [2026-08-13] The pre-shipped scaffolding often spans ALL THREE packages, so
    grep the client too, not just server + engine. Spec'ing L05 project context
    found the whole path already built and merely unfed: `PromptParts.specs` →
    `## Project context` with `wrapUntrusted('spec-N', …)`
    (`reviewer-core/src/prompt.ts:44-52,109-113`), `RunTrace.specs_read` in the
    vendored contract, and `client/.../RunTraceDrawer/TraceBody.tsx` already
    rendering both the `Specs read` config row and the prompt-assembly block,
    with `run-executor.ts:404` hardcoding `specs_read: []` as the only missing
    link. Checking the CLIENT renderer before planning UI work is what tells you
    whether a lesson is a wiring job or a build.

## What Doesn't Work

## Codebase Patterns

- [2026-08-14] A criterion of the form "the persisted prompt contains no line
  beginning with `+` or `-` outside a reconstructed `@@` header" is defeated by
  the PROMPT'S OWN markdown bullets, not by a diff body. Every `- path` list
  item this codebase writes into a prompt sits at column 0 and trips the check,
  which makes the check useless rather than red — it was written to catch a diff
  leak and instead catches us. Indent every list marker two spaces
  (`modules/brief/prompt.ts`), leaving only `buildFileMap`'s own output at column
  0 where `safePath` already handles a file literally named `-rf`. The general
  rule: when a mechanical honesty check is a substring/prefix property of the
  whole artifact, the artifact's own formatting is part of the invariant.

- [2026-08-13] `implementer` only ever executes a plan file, so review findings
  cannot be handed to it as prose — a fix round writes
  `docs/plans/<slug>.fixes-R<N>.md` (one step per finding: file, the claim, the
  rule broken, "Done when") and passes THAT path. Never re-pass the original
  plan: it is already executed and re-running it re-implements the same steps.
  Findings are keyed `<file>|<rule>|<slug of summary>` and NOT by line number,
  which shifts under every fix and makes the same finding look new each round.

- [2026-07-28] `@devdigest/shared` exists as two vendored copies
  (`server/src/vendor/shared` canonical, `client/src/vendor/shared` for the
  client) — contract changes must be applied to both, there is no sync script.
  - [2026-08-02] The copies ALREADY drift in 4 files (`adapters.ts`,
    `contracts/{eval-ci,knowledge,productionize}.ts`; server is ahead — e.g.
    client's `adapters.ts` lacks the `openrouter` provider id). Any automated
    sync check must scope to files touched by the current diff, or it fails on
    every run; a blanket `diff -rq` of the two trees is always red.
  - [2026-08-13] The "4 files" above is STALE for `contracts/knowledge.ts`: the
    two copies were byte-identical before L06 and L06 kept them so, which is why
    step 1 of that change could verify with a plain
    `diff -q server/src/vendor/shared/contracts/knowledge.ts
    client/src/vendor/shared/contracts/knowledge.ts`. `.claude/repo-facts.md` is
    generated and lists the CURRENT drift set (three files: `adapters.ts`,
    `contracts/eval-ci.ts`, `contracts/productionize.ts`) — read that rather
    than this bullet before choosing between `diff -q` and a symbol grep.
- [2026-08-10] The `@devdigest/shared` barrel does `export *` over every
  contract file, so a NEW contract file must not re-export a name it imports
  from a sibling - `contracts/blast.ts` builds on `BlastCaller` /
  `DownstreamImpact` / `BlastRadius` from `contracts/brief.ts` and exports only
  new names (`RankedBlastCaller`, `BlastDownstream`, `PrBlastRadius`). A
  re-export is a duplicate-export build error in every consumer, and it appears
  the moment the barrel line is added, not when the file is written.
- [2026-08-10] A server integration test can parse its own response with the
  CLIENT's copy of a contract
  (`import { PrBlastResponse } from '../../client/src/vendor/shared/contracts/blast.js'`
  in `server/test/blast.it.test.ts`). The server's `tsconfig.json` only includes
  `src/**`, so `pnpm typecheck` never sees the test file, and vitest resolves
  `zod` from the client's own `node_modules` - both packages are on the same
  zod 3. That turns the two-copies rule from a review checklist item into a
  failing test, which is the only enforcement that has ever worked here.
- [2026-08-02] The Drizzle schema is a DIRECTORY (`server/src/db/schema/*.ts`:
  core, pulls, reviews, runs), not the single `server/src/db/schema.ts` that
  CLAUDE.md's do-not-touch note implies — path checks/greps must match
  `server/src/db/schema(\.ts|/)` or they miss real schema changes
  (bit `scripts/pr-self-review-checks.sh`'s migrations-without-schema check).
- [2026-08-07] `CLAUDE.md` is a SYMLINK to `AGENTS.md` at the repo root and in
  all four packages (`ls -la CLAUDE.md` → `CLAUDE.md -> AGENTS.md`). Any
  instruction to "update both files" is wrong, and writing `CLAUDE.md` as a new
  file would replace the link. There is one file per scope; edit `AGENTS.md`.
  - [2026-08-10] L04 added a fifth package, `mcp/`, so "all four packages" in
    that entry (and in the generated `.claude/repo-facts.md`) now reads as a
    count that has to be maintained. The root `CLAUDE.md -> AGENTS.md` symlink
    is unchanged; a plan that lists `CLAUDE.md` and `AGENTS.md` as two separate
    rows to edit (this one did) means ONE edit, not two.
- [2026-08-10] Adding a package means editing `scripts/repo-facts.sh` in five
  places, not one: the prose count in the HEADER heredoc, the
  `for p in server client reviewer-core mcp e2e` loop, the test-lane table and
  the package-manager sentence in the LANES heredoc, the per-config
  `rules_of ...dependency-cruiser.cjs` printf block, and the CLAUDE.md-symlink
  sentence in the FOOTER heredoc. Everything else in that script is derived from
  disk, so a missed spot fails silently: the generated card just omits the
  package and every agent that reads it first believes the repo is smaller than
  it is.
- [2026-08-07] Only `client/` has a `lint` script. `server/` has
  `typecheck test arch:check db:*` and `reviewer-core/` has
  `typecheck build arch:check test` — the mechanical boundary check on the
  backend is `arch:check` (dependency-cruiser), NOT lint. `.claude/agents/`
  docs used to imply `pnpm lint` was available server-side; an agent told to
  run it just fails.

- [2026-08-13] Widening a contract field to a UNION (`RunTrace.specs_read`:
  `z.array(z.string())` → `z.array(z.union([z.string(), SpecsReadEntry]))`)
  breaks the CLIENT typecheck the moment it lands, because the drawer renders
  those entries as bare React children and an object is not a valid child. The
  contract change and its client-side normaliser are one unit — plan them as one
  step, or expect `cd client && pnpm typecheck` to stay red in between. The
  normaliser is also the only runtime guard there is: `GET /runs/:id/trace`
  returns the stored jsonb with no zod parse and no response schema, so nothing
  upgrades an old trace on the way out.

## Tool & Library Notes

- [2026-07-31] `Finding` in `contracts/findings.ts` doubles as the LLM
  structured-output schema, so it must stay a FLAT `z.object` — a
  `z.discriminatedUnion` would emit a `oneOf` JSON Schema that models handle far
  worse. Cross-field rules go in `superRefine` instead (`refineTrifecta`), which
  costs at most one reprompt (`completeStructured` feeds the issues back).
  Anything that needs `.extend()` builds on `FindingShape` and re-applies the
  refinement, because `.superRefine()` returns a `ZodEffects` with no `.extend`.

- [2026-08-02] macOS BSD grep treats a pattern starting with `-` as an option
  (`grep -qE "-----BEGIN…"` → "unrecognized option") — in repo shell scripts
  always pass patterns via `grep -e "$pat"` when they can start with a dash.

- [2026-08-13] A `PreToolUse` payload carries `agent_id` + `agent_type` when the
  call comes from a subagent, so a hook can be scoped to ONE agent instead of
  firing for everyone: read `agent_type` first and `exit 0` when it is not
  yours (`scripts/specs-gate.sh` does this for `specreator`). Extracting fields
  with `grep -Eo '"key"[[:space:]]*:[[:space:]]*"[^"]*"'` is safe from a value
  forged inside the written `content`, because JSON escapes the inner quotes
  (`\"`) and the pattern needs bare ones — still validate EVERY match, not just
  the first, so an ambiguous payload fails closed.

- [2026-08-13] A newly created `.claude/agents/<name>.md` is NOT picked up by
  the running session: the Agent tool answers "Agent type '<name>' not found"
  and lists the agents loaded at start. Editing an existing agent file takes
  effect, adding one needs a session restart — budget for that before planning
  a live smoke test of a brand-new agent.

## Recurring Errors & Fixes

- [2026-07-28] On this machine the default shell Node is v17 (nvm), so every
  `pnpm` command fails with "requires at least Node.js v18.12" — prefix
  non-interactive shells with
  `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` (repo needs
  Node ≥ 22).
- [2026-07-28] `./scripts/e2e.sh` failing every flow with
  `spawn agent-browser ENOENT` means the one-time global setup is missing:
  `npm i -g agent-browser && agent-browser install` (plus `pnpm install` in
  `e2e/` — the packages have separate lockfiles, installing server/client does
  NOT install e2e).

- [2026-08-13] `scripts/pr-gate.sh` matches the gated commands as a raw
  substring of the WHOLE hook payload, not of the parsed command — so any Bash
  call whose text merely mentions the blocked string is refused, including a
  test that pipes it into another script. Build the literal at runtime
  (`x="gh pr"" create"`) when a command needs to talk about it.

## Session Notes

- [2026-08-14] L07 PR Brief implemented end-to-end on `feat/l07-pr-brief`:
  `contracts/pr-brief.ts` (both vendored copies, byte-identical) → additive
  migration `0019_confused_micromacro` (`pr_brief` columns + append-only
  `pr_brief_history`) → `modules/_shared/hunk-map.ts` (moved out of
  `modules/intent`, plus a new `buildHunkRanges`) → `modules/brief`
  (candidates/ground/history/prompt pure files, repository, service, two routes)
  → `lib/hooks/brief.ts` + `PrBriefCard`, with the intent card's risk chips and
  the blast card's impact summary both stopping rendering (neither deleted).
  Spec: `docs/specs/L07-pr-brief.md`, plan: `docs/plans/l07-pr-brief.md`.

- [2026-08-13] L05 project context implemented end-to-end on
  `feat/l05-project-context`: `contracts/project-context.ts` +
  `PromptAssembly.specs_tokens` + a widened `RunTrace.specs_read` (both vendored
  copies) → four new tables (migration `0016_mighty_red_skull`, additive) →
  `modules/project-context` (walk/paths/assemble pure files, repository,
  service, seven routes, a scan job) → `run-executor.buildProjectContext` filling
  the long-unfed `specs` seam → `/repos/:id/context` page, agent + skill Context
  tabs, trace drawer chips → e2e flow 11. `reviewer-core` moved
  `## Project context` above `## Repo skeleton`. Spec:
  `docs/specs/L05-project-context.md`, plan: `docs/plans/l05-project-context.md`.
- [2026-08-13] `/run-plan` skill added: takes an approved `docs/plans/<slug>.md`
  and drives `implementer` → (`arch-evidence` ‖ `plan-verifier`) →
  `architecture-reviewer` → triage gate → fix round, up to 3 rounds, then one
  full-scope pass. Commits nothing. `specreator` and `implementation-planner`
  stay manual by design. `test-writer` is out of the chain to save tokens, so
  every run must report which behaviour shipped untested.
  `architecture-reviewer` moved `opus` → `sonnet` the same day; `plan-verifier`
  and `arch-evidence` were already `sonnet`.
- [2026-08-13] `specreator` agent added: writes product specs into
  `docs/specs/` only, create-only, in two passes (discovery returns ranked
  questions and writes nothing; `WRITE` produces the file). Format contract
  lives in `docs/specs/README.md` — EARS criteria with stable `AC-N` ids that
  `implementation-planner` cites verbatim in its Traceability table.
  `scripts/specs-gate.sh` enforces the destination on `PreToolUse`, keyed on
  `agent_type`. `doc-writer` no longer routes anything to `docs/specs/`.
- [2026-08-10] L04 Blast Radius + pre-push CLI shipped end-to-end:
  `modules/blast` (`GET /pulls/:id/blast` free, `POST …/blast/summary` behind a
  button) + four repo-intel facade reads + the BlastRadiusCard, plus
  `POST /reviews/diff` and `mcp/bin/devdigest review --mode working`. Two
  contracts (`blast.ts`, `review-diff.ts`) in BOTH vendored copies. The feature
  needed no model for its main path - every fact was already in the index, and
  the work was reading it honestly: the whole "index status" derivation exists
  so an empty caller list is never mistaken for "nothing calls this".
- [2026-08-04] L02 conventions extractor shipped end-to-end on
  `feat/l02-conventions-extractor`: `modules/conventions` (stratified sampling →
  config rules → per-category LLM fan-out → dedupe → evidence grounding →
  probe-based adherence) + `/conventions` page + skill drafting through the
  ordinary `POST /skills`. Contract change (`ConventionEvidence.sha`) landed in
  BOTH vendored copies. Pre-PR self-review caught three real criticals, all
  fixed: argv injection via a model-authored rg pattern, `db/` importing
  `modules/` (now blocked by a new `db-independent-of-modules` depcruise rule),
  and the scan-in-progress guard sitting in the route instead of the service.

- [2026-07-28] L01 run-cost implemented end-to-end: `agent_runs.cost_usd`
  (migration 0010) → `RunStats`/`RunSummary`/`PrMeta.total_cost_usd` contracts
  (both vendored copies) → trace COST tile, timeline `tok · $` line, PR-list
  Cost column; spec in `docs/specs/L01-cost-badge.md`.
- [2026-07-28] Finding severity breakdown ("the other half of L01") implemented
  end-to-end: `SeverityCounts` contract (both vendored copies) →
  `PrMeta.findings` + `RunSummary.severity_counts` computed on read via
  `rollupSeverities` → PR-list FINDINGS badge column, timeline severity
  badges, accordion `· N critical · N warning` header text. No schema change.

- [2026-08-02] L02 skills implemented end-to-end: `modules/skills` (CRUD +
  multipart import preview via fflate) → run-executor loads enabled linked
  skills (non-manual sources `wrapUntrusted`-wrapped) → `PromptAssembly.skills`
  + new `skills_tokens` → trace UI badge; client `/skills` page + agent-editor
  Skills tab (checkbox=link, drag=order); skill-link changes version the agent;
  2 new seeded agents (Test Quality / API Contract) + 9 seed skills; spec in
  `docs/specs/L02-skills.md`. Contract changes in both vendored copies.
- [2026-08-02] pr-self-review shipped: `.claude/skills/pr-self-review/`
  (routing table in `references/routing.md`) + deterministic layer
  `scripts/pr-self-review-checks.sh` (files/hash/run/marker) + PreToolUse gate
  `scripts/pr-gate.sh` wired in `.claude/settings.json`; verdict marker lives
  in `.git/pr-self-review.json`, bound to the change-set hash.

## Open Questions
