# Insights — repo-wide

Append-only lessons that span packages, kept in fixed sections — append into
the matching one, never rewrite old entries. Package-specific lessons go to
`<package>/INSIGHTS.md` instead. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- [2026-07-28] `@devdigest/shared` exists as two vendored copies
  (`server/src/vendor/shared` canonical, `client/src/vendor/shared` for the
  client) — contract changes must be applied to both, there is no sync script.
  - [2026-08-02] The copies ALREADY drift in 4 files (`adapters.ts`,
    `contracts/{eval-ci,knowledge,productionize}.ts`; server is ahead — e.g.
    client's `adapters.ts` lacks the `openrouter` provider id). Any automated
    sync check must scope to files touched by the current diff, or it fails on
    every run; a blanket `diff -rq` of the two trees is always red.
- [2026-08-02] The Drizzle schema is a DIRECTORY (`server/src/db/schema/*.ts`:
  core, pulls, reviews, runs), not the single `server/src/db/schema.ts` that
  CLAUDE.md's do-not-touch note implies — path checks/greps must match
  `server/src/db/schema(\.ts|/)` or they miss real schema changes
  (bit `scripts/pr-self-review-checks.sh`'s migrations-without-schema check).

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

## Session Notes

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
