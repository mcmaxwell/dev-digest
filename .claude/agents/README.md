# Agents

Subagents for this repository.
Each one runs in its own isolated context, sees none of the caller's conversation, and returns a single structured report.
Canonical location is `.claude/agents/`, shared with the team via version control.

This file is a map.
The rules themselves live in each agent's own file; do not restate them here.

## Catalog

| Agent | Responsibility | Model | Writes files |
|-------|----------------|-------|--------------|
| [researcher](researcher.md) | Answers a question about this repo or about the outside world, with evidence and citations | `sonnet` | no |
| [specreator](specreator.md) | Interrogates a feature idea and its mockups, then writes the product spec with EARS acceptance criteria - specs only, never plans | `opus` | yes (`docs/specs/` only, create-only) |
| [implementation-planner](implementation-planner.md) | Verifies a task's requirements and turns them into an Implementation Plan bound by the repo's architecture and lessons - plans only, never specs | `opus` | no |
| [implementer](implementer.md) | Executes an approved plan across frontend and backend, runs the existing tests | `inherit` | yes |
| [test-writer](test-writer.md) | Writes tests for either side and runs the matching per-package suite | `inherit` | yes (tests only) |
| [arch-evidence](arch-evidence.md) | Runs the mechanical boundary checks and returns raw observations, no judgement | `sonnet` | no |
| [architecture-reviewer](architecture-reviewer.md) | Judges those observations against this repo's written boundaries | `sonnet` | no |
| [plan-verifier](plan-verifier.md) | Maps every item of a plan to evidence in the code: done, partial, missing, deviated | `sonnet` | no |
| [doc-writer](doc-writer.md) | Documents implemented work into the right `docs/` or package file, with diagrams | `sonnet` | yes (docs only) |

[`INSIGHTS.md`](INSIGHTS.md) next to this file holds what past runs learned about these agents: which chain shapes paid off, which agent needs what in its prompt, what a given fan-out actually cost.
It is written by the `workflow-retro` skill after a multi-agent run and worth reading before launching a chain.
Lessons about the *code* never go there; those belong in `<package>/INSIGHTS.md`.

Architecture review **is** an agent here, because the boundaries it checks are written down in this repository and can be cited line by line: `onion-architecture`, `frontend-ui-architecture`, the two `vendor/shared` copies, `reviewer-core` purity, the `*.it.test.ts` split, the do-not-touch list.
A rule with a source is reviewable by a worker with a fixed input and a fixed output; taste is not.

Security review is deliberately **not** an agent.
It stays the `/security-review` command over the pending branch changes, with the `security` skill behind it, and every agent here that notices something security-shaped names it in one unjudged line and stops.

`pr-self-review` also stays a skill, not an agent.
It owns the whole change set against `merge-base`, the verdict marker in `.git/pr-self-review.json`, and the `gh pr create` gate in `scripts/pr-gate.sh`.
`architecture-reviewer` answers one question about one diff and returns a report; it never writes a marker and never gates anything.

## The chain

```
researcher (when a fact is missing)
    ↓  report
specreator  (when *what* to build is not settled yet)
    ↓  questions → the user     (discovery pass, writes nothing)
    ↓  spec → docs/specs/L<NN>-<slug>.md   (the planner reads this)
implementation-planner
    ↓  contract → docs/plans/<slug>.md     (the implementer reads this)
    ↓  rationale → docs/plans/<slug>.rationale.md   (humans and the verifier read this)
    ↓  execution-mode question → the user  (multi-agent chain or single-agent pass)
╭─ /run-plan drives everything below, and stops at the triage gate ──────────╮
│ implementer  ← receives the contract path, not the plan text                │
│     ↓  implementation report  +  .claude/last-change.json                   │
│ arch-evidence  ·  plan-verifier   ← both read the manifest, run in parallel │
│     ↓  observation table              ↓  coverage table                     │
│ architecture-reviewer  ← judges the evidence table                          │
│     ↓  findings → one ledger → ⛔ triage gate → the user                     │
│     ↓  docs/plans/<slug>.fixes-R<N>.md                                      │
│ implementer  ← the fix addendum, never the original plan                    │
│     ↺  up to 3 rounds, delta-scoped, then one full pass                     │
╰────────────────────────────────────────────────────────────────────────────╯
test-writer  (when tests are their own piece of work - not in /run-plan)
    ↓  test report
doc-writer  (when the feature needs documenting - /run-plan --docs)
    ↓  docs, written in place
/pr-self-review  →  /security-review  →  gh pr create
```

`specreator` and `implementation-planner` are run by hand, on purpose.
They are where the product decision and the architecture decision get made, and a decision made inside an automated chain is a decision nobody reviewed.
Everything after them is mechanical enough to automate, which is what `/run-plan` does.

There is no direct channel between subagents, with one exception: `implementation-planner` may spawn `researcher` subagents itself while planning, because a fact gap discovered mid-plan would otherwise cost a full round trip through the caller.
Every other handoff relays through the calling session, so it stays visible to a human before the next agent starts.

Three things travel as paths rather than as inlined text, because a fresh context is expensive and re-deriving a fact costs more than reading it:

- **`.claude/repo-facts.md`** - generated by `scripts/repo-facts.sh`. The package layout, the test lanes, the boundary rule names, the two contract copies, the do-not-touch list, the environment traps. Every agent reads this one file instead of assembling the same picture from `AGENTS.md`, `TESTING.md`, three `package.json` files and two depcruise configs. Regenerate it when a package script, a module, a contract file, or a rule name changes.
- **The plan, split in two.** The contract is what gets built; the rationale is why. The implementer never opens the rationale, which keeps roughly half the plan out of the context that writes code.
- **`.claude/last-change.json`** - the implementer's manifest of what it touched, with the plan step behind each file and an explicit list of paths that belong to somebody else's uncommitted work. Reviewers start from it instead of re-deriving scope from `git status`, which cannot tell one feature's dirty files from another's. Git-ignored: it describes one working tree at one moment.

`architecture-reviewer` and `plan-verifier` answer different questions about the same two inputs, so they run in either order or at the same time.
`arch-evidence` runs *before* the architecture reviewer, on a cheaper model: collecting the evidence is mechanical, judging it is not, and most rows come back empty.

## Agents

### researcher

| | |
|---|---|
| **Use when** | A question needs investigation before code is written, a claim about the codebase needs verifying, or an external technical decision needs grounding |
| **Input** | A concrete question with a subject and a definition of what would answer it |
| **Output** | Research report: Answer, Findings with `path:line` or URL evidence, Relevant files, Gaps and open questions |
| **Tools** | `Read, Grep, Glob, Bash, WebSearch, WebFetch, TodoWrite` |
| **Cannot** | Write or edit files, delegate to other agents, invoke `/deep-research` |

### specreator

| | |
|---|---|
| **Use when** | What the product should do is not settled yet, or a spec is the missing input someone else stopped on |
| **Input** | A feature idea, plus file paths to any design mockups. On the second pass, the answers to its questions and the word `WRITE` |
| **Output** | Discovery pass: Understanding, Designs read, Boundaries touched, Blocking and optional questions with recommendations, Design gaps, Proposed identity - and nothing written. Write pass: `docs/specs/L<NN>-<slug>.md` plus a report of criteria, assumptions, and what needs a human edit |
| **Tools** | `Read, Grep, Glob, Bash, Write, TodoWrite, Skill` |
| **Preloaded skills** | `mermaid-diagram`, `security`, `onion-architecture` |
| **Cannot** | Write anywhere but `docs/specs/`, overwrite an existing spec, use `Edit`, decide implementation, delegate, research externally, invoke any implementation skill |

It runs in two passes because a subagent cannot stop and ask.
The first pass reads the repo and the screenshots and returns at most seven blocking questions, each with the answer it would default to; the second pass writes the file.
A spec therefore never appears in `docs/specs/` before its product decisions were made by a human.

Acceptance criteria use EARS notation with stable `AC-N` identifiers, so the plan, the tests, and the PR all cite the same requirement instead of paraphrasing it.
The format contract lives in `docs/specs/README.md`, not in the agent file, so a human writing a spec by hand follows the same rules.

Its three preloaded skills each serve one section: `mermaid-diagram` for Module interactions, `security` for Untrusted inputs, and `onion-architecture` as a feasibility check, so it cannot specify a boundary this repository is not allowed to have.
The implementation skills are named and forbidden in its file - a spec that starts answering implementation questions has stopped being a spec.

`scripts/specs-gate.sh` enforces the destination mechanically on `PreToolUse`, keyed on `agent_type`, so it is silent for every other caller.

### implementation-planner

| | |
|---|---|
| **Use when** | A task touches more than one file or crosses package boundaries |
| **Input** | A task description or requirements, plus a researcher report when an external fact is involved |
| **Output** | Implementation Plan: Understanding, Affected modules, Architectural constraints, Lessons from INSIGHTS.md, Skills applied while planning, Skills for the implementer, Steps with files and verify commands, Test strategy, Non-functional requirements, Recommendations, Traceability, Risks and forks, Acceptance criteria with verification hints, Out of scope - plus an execution-mode question (multi-agent or single-agent) the caller relays to the user |
| **Tools** | `Read, Grep, Glob, Bash, TodoWrite, Skill, Agent` (Agent is prompt-scoped to `researcher` only) |
| **Preloaded skills** | `onion-architecture`, `frontend-ui-architecture`, `next-best-practices`, `postgresql-table-design` |
| **Cannot** | Write or edit files, write or draft specs, spawn any agent other than `researcher`, run its own review, start implementation or assume an execution mode |

It verifies the requirements before planning: inconsistencies become findings, ambiguities become at most three clarifying questions with defaults, and better shapes become Recommendations for the user to accept or reject.
Specs are its input, never its output - product behaviour it cannot source from a spec or the task is a question, not a guess.
When a fact it needs is out of reach it fans out `researcher` subagents - in parallel when the questions are disjoint - instead of guessing, and it reads only the `INSIGHTS.md` files of the modules the task actually touches.
Before emitting, it runs a final self-check: requirements traced to steps and acceptance criteria, verify commands sourced, no invented behaviour, execution-mode question last.

The four preloaded skills are the ones that constrain a *decision a plan makes* (which layer, where code lives, the server/client boundary, table and index design), not a line of code someone later writes.
The `Skill` tool covers the rest on demand: a plan must not mandate something a skill forbids, and the frontmatter alone does not always reveal that.

### implementer

| | |
|---|---|
| **Use when** | A plan already exists and needs to be carried out |
| **Input** | A path to an approved plan under `docs/plans/` |
| **Output** | Implementation Report: Status, Changes, Skills applied, Tests with real output, Deviations from the plan, Not done, For review, INSIGHTS |
| **Tools** | `Read, Grep, Glob, Edit, Write, Bash, TodoWrite, Skill` |
| **Cannot** | Commit, push, or open a PR; delegate to other agents; research externally; widen a step beyond the plan |

Skills are invoked at runtime from the routing table in the agent file rather than preloaded, so a frontend task never pays for Drizzle and Postgres rules it will not use.
`security` and `pr-self-review` are excluded on purpose; those belong to the review agents that run afterwards.

### test-writer

| | |
|---|---|
| **Use when** | Tests are the task: backfilling a gap, reproducing a bug as a failing test, or a suite the plan called out as its own step |
| **Input** | A behaviour to pin down, plus the spec, contract, or plan that says what it should do |
| **Output** | Test report: Status, Tests added, Behaviour source, Skills applied, Runs with real output, Failures under test, Not covered, INSIGHTS |
| **Tools** | `Read, Grep, Glob, Edit, Write, Bash, TodoWrite, Skill` |
| **Cannot** | Edit the code under test, edit a runner config or a shared helper, commit, delegate, research externally |

The split against `implementer`: the implementer writes the tests its own plan step names, and `test-writer` runs when tests *are* the work.
It never edits the code under test, so a red test is a deliverable rather than a blocker, and it can be pointed at a branch the implementer just finished without both agents editing the same file.
It writes the assertion from the stated intended behaviour rather than from the implementation, because a test derived only from the code under test asserts the bug along with the feature.

### arch-evidence

| | |
|---|---|
| **Use when** | Immediately before `architecture-reviewer`, to collect its evidence on a cheaper model |
| **Input** | `.claude/last-change.json`, a diff range, or a file list |
| **Output** | Evidence table: the three mechanical commands with real output, one probe per boundary with `path:line` hits or an explicit zero, Could not run, git status |
| **Tools** | `Read, Grep, Glob, Bash, TodoWrite` |
| **Cannot** | Write or edit files, judge anything, assign a severity, invoke a skill, delegate |

The split exists because the two halves of a boundary review are different kinds of work.
Running depcruise and fifteen greps is mechanical and most rows come back at zero; deciding what a non-zero row means is judgement.
Both halves run on `sonnet` today - the judgement half was on `opus` until 2026-08-13, and the two files are one frontmatter line apart if the verdicts ever look thin.
This agent is forbidden from using the words that constitute a verdict, so the reviewer cannot inherit a conclusion it did not reach.

### architecture-reviewer

| | |
|---|---|
| **Use when** | An implementation is finished and someone needs to know whether it stayed inside this repo's written boundaries |
| **Input** | `arch-evidence`'s table when there is one, plus `.claude/last-change.json` or a diff range |
| **Output** | Architecture review: Verdict, Findings with rule + `path:line` evidence + severity, Boundaries checked (every row), Mechanical checks, For other reviewers, Gaps |
| **Tools** | `Read, Grep, Glob, Bash, TodoWrite, Skill` |
| **Preloaded skills** | `onion-architecture`, `frontend-ui-architecture` |
| **Cannot** | Write or edit files, run tests or builds, touch `.git/`, do security review, gate a PR, delegate |

Given an `arch-evidence` table it does not re-run the probes and does not re-open the change set; it judges rows and opens a file only where a row's hit needs its surrounding code.
Without a table it collects its own evidence and says so in the report header, so a reader can tell the two modes apart.

Exactly two skills are preloaded because they *are* the boundaries it enforces, and a diff can span both sides of the repo in one change.
`next-best-practices`, `postgresql-table-design`, `drizzle-orm-patterns`, and `zod` stay on the `Skill` tool because whether they apply depends on what the diff touches.
The three analysis commands it may run (`pnpm arch:check` in `server/` and `reviewer-core/`, `pnpm lint` in `client/`) are named individually in its Hard constraints, because a blanket read-only rule would otherwise forbid them.

### plan-verifier

| | |
|---|---|
| **Use when** | A plan has been executed and someone needs to know exactly what of it landed |
| **Input** | The plan (a path, or pasted inline) and a change set |
| **Output** | Plan verification: item count, Verdict counts, Item by item table, Deviations, Missing, Unverifiable from code, Out of plan |
| **Tools** | `Read, Grep, Glob, Bash, TodoWrite` |
| **Cannot** | Write or edit files, run any test or build, invoke a skill, comment on code quality |

It is the only agent here with no `Skill` tool, and that is deliberate.
The failure mode it exists to avoid is drifting into generic code review, and a loaded domain skill is an invitation to do exactly that; removing the tool makes the constraint structural rather than merely stated.
Its five statuses (`done`, `partial`, `missing`, `deviated`, `unverifiable`) are a convention of this repository, named as such in the agent file so nobody mistakes them for a standard.

### doc-writer

| | |
|---|---|
| **Use when** | A shipped feature needs documenting, or existing docs have drifted from the code |
| **Input** | A plan, an implementation report, or the code itself, plus who the reader is |
| **Output** | Documentation report: Files written, Placement rationale, Mode, Diagrams, Verified against, Links updated, Not documented, For review |
| **Tools** | `Read, Grep, Glob, Edit, Write, Bash, TodoWrite, Skill` |
| **Cannot** | Write code or config, write any `INSIGHTS.md`, create a `CLAUDE.md`, document unbuilt work, commit |

`mermaid-diagram` is the only preloaded skill, because any document it writes may need a diagram and an agent that forgot the option writes prose where a picture was the answer.
`INSIGHTS.md` is out of bounds: it belongs to the `engineering-insights` wrap-up of whoever did the work.
`CLAUDE.md` is a symlink to `AGENTS.md` at the root and in all four packages, so there is only ever one file to edit.

## Where the rules come from

Applies to every agent in this directory.
Every non-obvious rule in these files traces to one of these.

### Claude Code documentation

| Rule | Source |
|---|---|
| `tools` is an allowlist; omitting it inherits the whole subagent pool, which differs between foreground and background runs. Both agents therefore list tools explicitly | [sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Read-only is expressed by listing only read tools, which is why `implementation-planner` has no `Write`/`Edit` | same |
| A subagent **can** spawn subagents by default, up to three layers. Blocking that requires omitting `Agent` from `tools`, which every agent here does except `implementation-planner`, whose `Agent` use is prompt-scoped to `researcher` only | same |
| `skills:` injects a skill's full text at startup; without it, the `Skill` tool still discovers and invokes skills at runtime. This is the preload-vs-runtime split above | same, and [skills](https://code.claude.com/docs/en/skills) |
| A subagent starts with a fresh context and inherits neither conversation history nor already-invoked skills, which is why both agents open with a mandatory read-first step | [sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Chained subagents hand off through the calling session; no agent-to-agent contract exists | same |
| `disable-model-invocation` and `allowed-tools` are skill fields, not agent fields, so neither appears in this directory | [skills](https://code.claude.com/docs/en/skills) |

The `description` fields deliberately avoid the documented "use proactively" trigger phrasing.
Both agents are meant to be invoked explicitly, following the convention already set by `researcher.md`.

### Anthropic engineering guidance

| Rule | Source |
|---|---|
| Two agents rather than a larger set, and neither delegates further: add agentic complexity only when simpler structures fall short | [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) |
| Orchestrator-workers: the calling session decomposes and synthesises, the agents are workers with a fixed input and output | same |
| The plan is a predefined path, so the implementer reports a deviation instead of re-deciding the step | same |
| Skill names and a plan path travel between agents instead of their contents: keep lightweight identifiers, load just in time | [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| Fixed report templates, because a subagent should return a distilled summary while the heavy reading stays in its own context | same |
| Prompts sit "at the right altitude": a concrete skill routing table, but step shapes left to judgement | same |
| Findings carry a verification bar: a behaviour claim needs a `file:line` citation in the source, not an inference from naming. This is `architecture-reviewer`'s "quote the line or drop the finding" rule | [Code Review](https://code.claude.com/docs/en/code-review) |
| A fixed severity scale attached to findings, so the same diff scores the same way twice | same |

### External practice

Sources outside Anthropic that shaped a rule in one of the four newer agents.

| Rule | Source |
|---|---|
| `test-writer` derives assertions from the stated intended behaviour rather than from the implementation: prompting a model with the code under test measurably increases tests that validate its bugs and suppresses bug-finding ones | [Misguidance Effect of Buggy Code in LLM-Generated Unit Tests](https://arxiv.org/abs/2607.22883), ISSTA 2026 |
| No coverage chasing, and every test carries an assertion that could fail | same, plus `TESTING.md`'s own typological philosophy |
| Prefer the real collaborator, and justify a test double in a comment, because mock-heavy tests couple to implementation and break on behaviour-preserving refactors. This is one influential author's position, not a settled standard | [Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html) |
| Boundary findings are shaped like machine-checkable rules - a named rule, a from-to statement, a severity, a location - rather than prose about coupling | [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [ArchUnit user guide](https://www.archunit.org/userguide/html/000_Index.html) |
| `plan-verifier` maps each requirement to the artifact that verifies it, and refuses items whose wording is not checkable | requirements traceability practice; the checklist gate in [github/spec-kit](https://github.com/github/spec-kit/blob/main/spec-driven.md) |
| `doc-writer` classifies each document as reference, how-to, explanation, or tutorial and does not mix modes | [Diátaxis](https://diataxis.fr/) |
| Documentation lives in version control and goes through code review like code | [Write the Docs: docs as code](https://www.writethedocs.org/guide/docs-as-code/) |
| Decision records use Title / Context / Decision / Status / Consequences, stay one to two pages, and are superseded rather than rewritten; Considered Options is added only when the decision was contested | [Nygard, Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR](https://adr.github.io/madr/) |

### This repository

| Rule | Source |
|---|---|
| File layout `Hard constraints → Step 0 → Method → Report format → Standards`, and the named list of forbidden Bash commands in a read-only agent | [researcher.md](researcher.md) |
| Do-not-touch paths, the two `vendor/shared` contract copies, never `docker compose down -v` | root `AGENTS.md` |
| `engineering-insights` wrap-up is mandatory before finishing | root `AGENTS.md` |
| Per-package verify commands and the `*.it.test.ts` split | `TESTING.md` |
| `pnpm arch:check` in `server/` and `reviewer-core/` and `pnpm lint` in `client/` as the mechanical boundary checks. `server/` and `reviewer-core/` have no `lint` script | `server/package.json`, `reviewer-core/package.json`, `client/AGENTS.md` |
| Module lessons are high-confidence guidance and are read before editing | `INSIGHTS.md` in each package |
| `architecture-reviewer`'s boundary checklist is sourced row by row from root `AGENTS.md`, the package `AGENTS.md` files, and the two dependency-cruiser configs | those files |
| The contract-copy check is scoped to the files in the diff, because the two `vendor/shared` trees already drift and a blanket comparison is always red | root `INSIGHTS.md` |
| The Drizzle schema is a directory, so a migration with no matching change under `server/src/db/schema/` is a finding | root `INSIGHTS.md` |
| Every agent that runs `pnpm` puts nvm v22.18.0 on `PATH` first, because the default `node` here is v17 | root `INSIGHTS.md` |

### Local decisions, with no external source

Named here so they are not mistaken for documented practice.

- The Implementation Plan, Implementation Report, Test, Architecture review, Plan verification, and Documentation report templates.
  The documentation prescribes no handoff schema.
- The contents of the skill routing tables.
- `docs/plans/<slug>.md` as the plan location.
  The directory does not exist yet, which is why `plan-verifier` accepts an inline plan as valid input.
- The model rule: `opus` where the output is a judgement someone commits to, `sonnet` where the criterion is handed in and the work is finding evidence for it, `inherit` where the agent writes code that ships.
- Excluding review skills from the implementer.
- `plan-verifier` having no `Skill` tool at all, to make "do not drift into code review" structural rather than merely stated.
- `plan-verifier`'s five statuses: `done`, `partial`, `missing`, `deviated`, `unverifiable`.
- Splitting `test-writer` out of `implementer`, and forbidding it from editing the code under test.
- The severity scale of `architecture-reviewer`: critical for a mechanically enforced boundary, major for a written rule with no check behind it, minor for a skill preference.
- Keeping security review a command and `pr-self-review` a skill.
- Never committing or pushing without being asked.
- The three handoff artifacts: the generated `repo-facts.md` card, the contract/rationale plan split, and `last-change.json`. No documentation prescribes any of them; they exist because a fresh subagent context otherwise re-derives the same repository facts on every single run, which was measured as the largest single cost in this set.
- Splitting `arch-evidence` out of `architecture-reviewer` on model cost rather than on responsibility.

## Calling these agents efficiently

Conventions for whoever orchestrates them. They cost nothing to follow and they were each learned by paying for the alternative.

- **Give `Explore` a numbered question list, not a topic.** "Map the review pipeline" returns a map, most of which nobody reads. Five numbered questions return five answers, and the overlap between two explorers becomes visible instead of being paid for twice.
- **Two explorers, not three,** unless the third has a genuinely disjoint surface. Overlapping explorers are the cheapest thing to over-order and the hardest to notice.
- **Do not ask two agents the same outside question.** A `researcher` brief that already covers the subagent format makes a second documentation agent redundant.
- **Pass paths, not payloads.** A file list belongs in `.claude/last-change.json`, not pasted into two prompts.
- **Put the invariant part of a prompt first.** Role, checklist and the facts card do not change between runs; the change set does. That ordering is what lets a repeated call reuse a cached prefix.
- **Do the small, located fix yourself.** An edit with known coordinates does not need a fresh agent context to find them again.

## Adding an agent

- Required frontmatter is `name` and `description` only.
  `name` is lowercase with hyphens.
- Write `description` so a reader can tell when **not** to use the agent.
  Both agents here end theirs with an explicit negative.
- List `tools` explicitly, including the omissions that matter, and state them again in the agent's Hard constraints so the model knows its own limits.
- Give the agent one report format and require it.
  An agent whose output shape varies cannot be chained.
- If the agent writes files, name the paths it may write in Hard constraints.
  `tools` cannot scope `Write` to a glob, so the restriction is prompt-level, and the report must list every file written so a human can check it.
- Update the catalog table above.
