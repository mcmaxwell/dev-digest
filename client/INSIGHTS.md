# Insights — client

Append-only lessons specific to this package, kept in fixed sections — append
into the matching one, never rewrite old entries. Cross-cutting lessons go to
the root INSIGHTS.md. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- [2026-07-28] `e2e/specs/04-pr-findings.flow.json` asserts the literal
  substring "2 findings" in the ReviewRunAccordion header — when changing that
  header, APPEND after the `N findings` prefix (as the severity breakdown
  does), never replace it, or the e2e flow breaks.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
