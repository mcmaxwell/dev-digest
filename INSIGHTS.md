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

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
