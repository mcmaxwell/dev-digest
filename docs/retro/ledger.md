# Retro ledger - agents and orchestration

Append-only lessons about **how the agents run**, not about the code they touch.
Code lessons belong in `<package>/INSIGHTS.md` via the `engineering-insights`
skill; this ledger is written by the `workflow-retro` skill and read before
launching an agent chain.

`workflow-retro` is manual. Nothing appends here automatically, and no entry
lands without the user having asked for the retro that produced it.

Format and gates: `.claude/skills/workflow-retro/SKILL.md`. One lesson per
bullet, `- [YYYY-MM-DD] <lesson>`, every claim backed by a number, a path, or a
quote. Never rewrite an entry; correct it with a dated note underneath.

## Chain Shapes That Work

- [2026-08-13] For spec work, NEVER let the writing agent write on its first
  pass. `specreator`'s two-pass shape (pass 1 returns ranked questions and
  writes nothing, the caller relays them to the user, pass 2 writes) cost 38,144
  output tokens across both passes and produced a 420-line spec that needed no
  rework. Pass 1 is what earns it: it surfaced two structural facts that
  inverted the plan - the `specs` prompt slot was already implemented end to end
  and merely unfed, and the DB tables the feature needs do not exist despite
  `server/CLAUDE.md` claiming every lesson's tables ship in the starter. Had it
  written on pass 1, both would have landed in the spec as wrong assumptions.

## Chain Shapes That Don't

- [2026-08-13] A wide fan-out does not mean the orchestrator delegated. In
  session `b5d6b6de` the main loop generated 545,405 output tokens against
  289,312 from all 12 subagents combined, with 90 `Bash` and 30 `Edit` calls of
  its own. Fan-out was used for reading (9 `Explore`/`Plan` agents) and none for
  the implementation the main loop then did by hand. When the retro shows main-
  loop output exceeding total agent output, the delegation boundary is in the
  wrong place - check what those `Bash` streaks were doing before adding more
  agents.

## Agent Notes

- [2026-08-13] `specreator` returns each open question with its own recommended
  default. Answer the ones you care about and say explicitly "your default
  stands" for the rest - an unanswered question does not silently take the
  default, it lands in the spec's Open questions section and stops being a
  decision. It also accepts a direct override of its own recommendation; L05
  rejected its content-hash-pinning proposal and its agent-versioning default in
  one message and it complied without re-arguing.
- [2026-08-13] `specreator` is create-only and cannot touch a file it already
  wrote. Flipping `Status: draft` to `approved`, linking the spec from
  `README.md`, and marking a superseded spec are ALWAYS main-loop edits after it
  returns. Budget for them; do not send the agent back.

## Context Handoffs

- [2026-08-13] Put local screenshot paths directly in the launch prompt with one
  line of what each shows. `specreator` read all four L05 mockups and returned a
  per-mockup "what it does not show" table with no round-trip. Naming the
  expected artifact path in the same prompt (`docs/specs/L05-project-context.md`)
  removes the second thing it would otherwise ask about.

## Cost Notes

- [2026-08-13] A full product spec from mockups plus requirements: 1 agent, 2
  passes, 38,144 agent output tokens, about 9 minutes of agent working time, 41
  tool calls. Output: 420 lines, 11 sections, 51 EARS criteria, 2 Mermaid
  diagrams. Use this as the unit when estimating a multi-spec lesson.

## Run Log

- [2026-08-13] L05 Project Context spec. 1 agent (`specreator`, resumed once via
  `SendMessage`), 38k agent output + 79k main-loop output, 27 min wall clock.
  Outcome: spec approved, no rework. No duplicated file reads (single agent).
