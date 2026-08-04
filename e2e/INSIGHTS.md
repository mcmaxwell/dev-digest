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

- [2026-08-04] A flow that WRITES (accept, dismiss, toggle) must undo itself in
  its last steps and re-assert the pre-state, or it only passes against a
  freshly-seeded DB — `scripts/e2e.sh` reseeds every run, so CI stays green
  while the flow is silently single-use against any persistent stack. Flow
  `08-conventions` accepts a candidate, then closes the modal and clicks
  "Deselect all" before re-asserting "0 of 3 accepted". Prove it by running the
  suite TWICE against one stack (patch `scripts/e2e.sh`'s `(cd e2e && npm test)`
  line into `… && …` and fix `ROOT` if you copy the script elsewhere) — a single
  `e2e.sh` run can never detect this, because teardown hides it.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
