# Insights — server

Append-only lessons specific to this package (including `src/modules/repo-intel`),
kept in fixed sections — append into the matching one, never rewrite old
entries. Cross-cutting lessons go to the root INSIGHTS.md. Format and quality
gates: `.claude/skills/engineering-insights/SKILL.md`.

## What Works

## What Doesn't Work

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
- [2026-07-28] Runs link to reviews only via `reviews.run_id` (no FK), and
  `reviews.kind` can be `'summary'` — any run↔findings aggregation must filter
  `kind = 'review'` and `run_id IS NOT NULL`, else summary rows skew counts.

## Tool & Library Notes

- [2026-07-28] Drizzle's `sum()` returns a STRING (SQL numeric), not a number —
  wrap in `Number(...)` before putting it in a JSON response, or Zod
  `z.number()` contracts reject it (see the `total_cost_usd` aggregate in
  `src/modules/pulls/routes.ts`).

## Recurring Errors & Fixes

## Session Notes

## Open Questions
