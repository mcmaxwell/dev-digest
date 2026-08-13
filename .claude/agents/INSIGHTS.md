# Agent insights

Lessons about the AGENTS and how runs are orchestrated.
Code lessons belong in `<package>/INSIGHTS.md` (`engineering-insights`), never here.

Written by the `workflow-retro` skill, from measured transcript data only.

## Chain Shapes That Work

## Chain Shapes That Don't

## Agent Notes

## Context Handoffs

## Cost Notes

- [2026-08-13] Planning `docs/specs/L05-project-context.md` (51 EARS criteria, server + client + engine) inline in the main loop, with zero delegation, cost 100.9k output tokens, 44 `Bash` calls and 35.5 min wall clock, and produced an 18-step plan. Use this as the baseline the next time someone weighs an inline plan against `implementation-planner`: the exploration alone was ~40 tool calls across five packages, and every one of them landed in the orchestrator's context and stayed there.

## Run Log

- [2026-08-13] L05 plan authored inline: 0 agents, 100.9k output tokens (main loop), 35.5 min, plan written to `docs/plans/l05-project-context.md`. No agent lessons earned - nothing was delegated, so nothing about the agents was exercised.
