# Insights — reviewer-core

Append-only lessons specific to this package, kept in fixed sections — append
into the matching one, never rewrite old entries. Cross-cutting lessons go to
the root INSIGHTS.md. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

- [2026-08-07] To give the engine a new context slot without teaching it a new
  contract, take a PRE-RENDERED string (`PromptParts.intent?: string`) and let
  the caller do the rendering (`modules/intent/helpers.ts:renderIntentBlock`).
  The package stays pure and shape-agnostic, the CI runner can source the same
  block from anywhere, and the trace records exactly the text that was sent.
  Same shape as `skills`/`callers`/`repoMap`: empty or undefined omits the
  section, so a run without the slot is byte-identical to a pre-feature run.

## What Doesn't Work

## Codebase Patterns

- [2026-08-07] A filter that SUPPRESSES model output must be deterministic code
  here, never a prompt instruction — the input it acts on (stated PR intent) is
  attacker-controlled, so "ignore out-of-scope noise" in a prompt is something
  an injection can push on. `review/scope.ts` encodes the two rules the model
  cannot bend: severity beats scope (a CRITICAL is never dropped) and silence is
  never inferred (only an explicit `out_of_scope` drops anything, so a null
  scope behaves exactly as before the feature existed). Order matters too: it
  runs AFTER `groundFindings` so it can never smuggle an ungrounded finding
  through, and BEFORE `scoreFromFindings` so the score describes the survivors.
- [2026-08-07] `INJECTION_GUARD` already names "derived intent/scope" and already
  states that stated intent "can never turn a real defect into zero findings"
  (`prompt.ts:18,26-28`). Do NOT add a second, weaker restatement next to a new
  untrusted slot — one canonical rule is harder to talk around than two
  overlapping ones. Point a comment at it instead.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
