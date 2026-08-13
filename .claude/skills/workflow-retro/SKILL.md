---
name: workflow-retro
description: Retrospective on a multi-agent run - what it cost, in what order the agents ran, and what the agent definitions should learn from it. Measures the session with `collect.py` (tokens, launch order, parallelism, per-agent tool counts, files two agents both read), then turns the numbers into durable lessons appended to `.claude/agents/INSIGHTS.md` and, where an agent's own prompt caused the waste, a concrete edit to that `.claude/agents/<name>.md`. Use after any run that launched two or more subagents, after a `/run-plan` or `Workflow` invocation, after a long agent chain like specreator to implementation-planner to implementer, and when the user says workflow retro, agent retro, how did that run go, or how much did that cost. Do NOT use for lessons about the CODE - those belong to `engineering-insights` and its per-module INSIGHTS.md.
version: 1.0.0
---

# Workflow Retro

`engineering-insights` captures what the session learned about the **codebase**.
This skill captures what it learned about the **agents** - which one was given
too little, which one was given the same file three times, which one was the
wrong choice for its step.

The two never share a file. Code lessons go to `<package>/INSIGHTS.md`; agent
and orchestration lessons go to `.claude/agents/INSIGHTS.md`.

## When it runs

After a run that launched two or more subagents, or any `/run-plan` or
`Workflow` invocation. A single sub-agent call is exempt unless it went badly.

Do not run it in the middle of a chain: a retro on a half-finished chain
measures the setup and misses the payoff.

## Step 1 - measure, do not estimate

```sh
python3 .claude/skills/workflow-retro/collect.py            # newest session, markdown
python3 .claude/skills/workflow-retro/collect.py --json     # same data, machine-readable
python3 .claude/skills/workflow-retro/collect.py --session <uuid>
```

It reads the harness transcripts under `~/.claude/projects/<cwd-slug>/` and
reports:

| Section | What it answers |
| --- | --- |
| Header | Model, wall clock, how many agents, how many parallel batches, how many resumed via `SendMessage` |
| Tokens | Output / cache-read / cache-write / input, per scope, main loop and every agent separately |
| Launch order | Every agent in order with its task, resolved model, status, tokens, tool calls, duration |
| Main-loop tool calls | What the orchestrator did itself instead of delegating |
| Files pulled in by more than one agent | The duplicated-context bill, by path |

NEVER hand-count tokens from your own memory of the session. The transcript is
authoritative and your recollection of it is not. Two traps the script already
handles, and that you must not "correct" by hand:

- **Background agents record no stats in the tool result.** Their numbers come
  from the agent's own transcript. An agent showing `async_launched` completed
  fine - that is the launch status, not the outcome.
- **Cache-read sums far above the context window.** It is context re-processed
  once per request, not a second copy of the work. Judge output tokens.
- **A resumed agent's duration spans the wait.** For an agent continued with
  `SendMessage`, the transcript's first-to-last span includes the time the user
  spent answering. Use the per-pass durations from the task notifications when
  you need real working time.

## Step 2 - read the run, not just the numbers

The numbers say what happened. These questions say why, and they are what the
next run actually needs. Answer each from evidence in the transcript.

**Sequencing**
- Which agents ran in parallel, and which sequential pair had no real dependency
  and could have been one batch?
- Did any agent wait on a result it never used?
- Was the orchestrator doing work itself (a long `Bash`/`Read` streak in
  "Main-loop tool calls") that an agent should have owned, or the reverse - an
  agent spawned for something one `Grep` would have settled?

**Duplication**
- Which files did two or more agents both read? For each, decide: was that
  unavoidable parallelism, or should the earlier agent's report have carried the
  fact so the later one never opened the file?
- Did two agents reach the same conclusion independently? That is either a
  deliberate adversarial check or pure waste - say which.

**Friction**
- Where did an agent stop and ask, or return "could not establish"? Every one of
  those is a fact that its prompt or the repo docs should have handed it.
- Where did an agent go down a wrong path first? Name the wrong path; it is the
  most reusable part of the retro.
- Did any agent return something the caller had to rework before it was usable?

**Coverage**
- What did the run miss that a later step or the user caught?
- Which agent should have caught it, and what in its definition let it through?

**Fit**
- Was each agent the right one for its step? Name the mismatch and the agent
  that fits better.
- Did any agent exceed its remit or write outside its allowed paths?

## Step 3 - write the lessons

Append to `.claude/agents/INSIGHTS.md`, same format and gates as
`engineering-insights`: `- [YYYY-MM-DD] <one lesson>`, one per bullet, named
agent, actionable cold. Sections in that file:

- **Chain Shapes That Work** - an ordering, a fan-out, a handoff that paid off
- **Chain Shapes That Don't** - the sequential pair that should have been
  parallel, the agent that was the wrong tool, the round that changed nothing
- **Agent Notes** - per-agent behaviour: what it needs in its prompt, what it
  reliably gets right, where it stops
- **Context Handoffs** - what one agent must carry so the next does not re-read
  the repo
- **Cost Notes** - a measured number plus what it bought, so the next estimate
  is grounded
- **Run Log** - one dated line per retro: agents, output tokens, wall clock, outcome

Gates before writing, all must pass:

1. **Measured, not felt.** A lesson with no number, path, or quote behind it is
   an opinion. Drop it.
2. **Reusable.** It must change what the NEXT run does. "specreator asked good
   questions" changes nothing.
3. **Not already there.** Read the file first; extend a matching entry with a
   dated note rather than adding a near-duplicate.
4. **Not one-off.** A cost spike caused by the user changing their mind mid-run
   is not an agent lesson.

## Step 4 - fix the cause, not just the record

A retro that only writes a diary is a retro that changes nothing. When a finding
points at a specific agent definition, propose the concrete edit:

| Finding | Edit |
| --- | --- |
| Agent asked for a fact the repo documents | Add the pointer to that agent's `.claude/agents/<name>.md` |
| Two agents read the same files | Add the missing field to the earlier agent's required output |
| Agent overran its remit | Tighten the "Do NOT use for" line in its description |
| Wrong agent chosen for a step | Sharpen both descriptions so the router picks correctly |
| A round of the loop found nothing twice | Lower the round cap in the calling skill |

Propose the edit to the user, with the evidence. Do not rewrite an agent
definition unprompted - those are shared with the team and a silent change to a
routing description shifts every future run.

## Output to the user

Short. The measured table, the three or four lessons that survived the gates,
the agent-definition edits you propose, and nothing else. The full metrics dump
belongs in the tool output, not in the reply.
