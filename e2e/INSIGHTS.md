# Insights — e2e

Append-only lessons specific to this package, kept in fixed sections — append
into the matching one, never rewrite old entries. Cross-cutting lessons go to
the root INSIGHTS.md. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

## What Doesn't Work

- [2026-08-04] `{"cmd": ["click", "--text", "Label"]}` is NOT valid
  agent-browser: `click` takes a SELECTOR (CSS/XPath/`@e1` ref) and has no
  `--text` flag, so the step dies with "Command failed: agent-browser click
  --text …" no matter what the page renders. Clicking by visible label is
  `["find", "role", "button", "click", "--name", "Label", "--exact"]` (or
  `["find", "text", "…", "click"]`) — check `agent-browser <cmd> --help`, and
  never copy a step shape from another framework. `--exact` matters when one
  label is a prefix of another ("Accept" vs "Accepted"). Bit flow
  `08-conventions`, which passed review and only failed on its first CI run.

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
