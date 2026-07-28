# Insights — server

Append-only lessons specific to this package (including `src/modules/repo-intel`),
kept in fixed sections — append into the matching one, never rewrite old
entries. Cross-cutting lessons go to the root INSIGHTS.md. Format and quality
gates: `.claude/skills/engineering-insights/SKILL.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- [2026-07-28] Drizzle's `sum()` returns a STRING (SQL numeric), not a number —
  wrap in `Number(...)` before putting it in a JSON response, or Zod
  `z.number()` contracts reject it (see the `total_cost_usd` aggregate in
  `src/modules/pulls/routes.ts`).

## Recurring Errors & Fixes

## Session Notes

## Open Questions
