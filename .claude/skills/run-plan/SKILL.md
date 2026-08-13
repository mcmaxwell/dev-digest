---
name: run-plan
description: Executes an approved plan end to end - implement, review, converge on the findings, report - without committing anything. Runs `implementer` against a plan under `docs/plans/`, then loops `arch-evidence` + `plan-verifier` + `architecture-reviewer` until the blocking findings are gone or the round cap is hit, writing each round's fixes as a plan-shaped addendum the implementer can execute. Use after `implementation-planner` has produced a plan you approved, when the user says "run-plan", "запусти імплементацію", "виконай план", or asks to build a feature from an existing plan. Do NOT use to write a spec (`specreator`) or to produce a plan (`implementation-planner`) - both run manually, before this.
version: 1.0.0
---

# run-plan

Take an approved plan and carry it through to a reviewed, converged, uncommitted
change-set.

This skill starts **after** the two decision steps, which you run by hand:

```
specreator              → docs/specs/L<NN>-<slug>.md      (run manually)
implementation-planner  → docs/plans/<slug>.md            (run manually)
/run-plan                                                 ← starts here
```

Keeping them out is deliberate: they are where product and architecture
decisions get made, and those belong in a conversation with you, not inside an
automated chain.

## What runs, and on which model

| Step | Agent | Model | Notes |
| --- | --- | --- | --- |
| Build | `implementer` | inherit | Writes the code and runs the existing package tests |
| Evidence | `arch-evidence` | `sonnet` | Mechanical: depcruise, lint, one probe per boundary rule |
| Coverage | `plan-verifier` | `sonnet` | Every plan item and every `AC-N` mapped to evidence |
| Judgement | `architecture-reviewer` | `sonnet` | Judges the evidence table it is handed |

Deliberately **not** in the chain:

- `test-writer` - skipped to save tokens. Tests are whatever the plan's own
  steps told `implementer` to write. Say so in the final report: a run with no
  test step shipped untested behaviour, and that is a fact the user needs, not
  a detail to bury.
- `doc-writer` - off by default, `--docs` turns it on.
- `specreator`, `implementation-planner` - run manually, see above.

## Arguments

| Form | Meaning |
| --- | --- |
| `/run-plan` | Resume the run in `.git/run-plan.json`; if there is none, use the newest plan in `docs/plans/` and confirm it before starting |
| `/run-plan docs/plans/<slug>.md` | Start on that plan |
| `--designs <path>[,<path>]` | Screenshot paths handed to `implementer`, and to the UI fidelity check |
| `--deep` | Adds `/code-review` to every review round (bugs and simplification, which the architecture reviewer does not look for) |
| `--rounds <N>` | Convergence cap, default 3 |
| `--docs` | Runs `doc-writer` in the wrap phase |
| trailing free text | Clarifications for the implementer - see the scope rule below |

**The scope rule.**
Free text clarifies the plan; it never extends it.
If what the user typed implies work the plan does not contain, stop and say so:
the fix is another `implementation-planner` pass, not a wider `implementer`
brief. Silently widening the plan is how a reviewed change-set becomes an
unreviewed one.

## State

`.git/run-plan.json` - never committed, one object:

```json
{
  "plan": "docs/plans/<slug>.md",
  "spec": "docs/specs/L05-<slug>.md",
  "designs": [],
  "baseline": { "head": "<sha>", "dirty_before": ["..."] },
  "phase": "build | review | wrap | done",
  "round": 1,
  "max_rounds": 3,
  "ledger": [
    { "key": "<file>|<rule>|<slug of summary>",
      "severity": "BLOCKING | ADVISORY",
      "source": "architecture-reviewer | plan-verifier | code-review | ui",
      "state": "open | fixing | resolved | accepted | deferred | escalated",
      "rounds": [1, 2] }
  ]
}
```

The ledger is the reason this file exists.
Resume is a side benefit; the real job is knowing, in round 3, that a finding
was already resolved in round 1 and has come back.

## Phase 0 - preflight

Do all of this before spending a single agent call.

1. Resolve the plan path. It must exist; read it, and read its
   `<slug>.rationale.md` sibling if there is one.
2. Read the spec the plan cites and extract the `AC-N` identifiers.
   No spec, or a spec whose Open questions are still unresolved - say so and ask
   whether to continue. A plan built on an unsettled spec will fail
   `plan-verifier` for reasons no fix round can repair.
3. `git rev-parse HEAD` and `git status --short` - record the baseline and the
   files that were **already dirty**. They belong to somebody else's work and
   must never enter a fix round.
4. Refuse to run on the default branch. Offer to branch first.
5. Print a one-screen summary - plan, spec, `AC-N` count, review composition,
   round cap, what is skipped - and start.

## Phase 1 - build

Call `implementer` with the **path** to the plan, never the plan's text, plus
the design paths and any clarification that survived the scope rule.

When it returns, read its report before anything else:

- **Deviations** and **Not done** are surfaced to the user immediately.
  A deviation found now costs one message; found by the reviewer in round 2 it
  costs a whole round.
- Its `.claude/last-change.json` manifest is the input every reviewer uses.
  If it is missing, stop - the review phase has no scope without it.

## Phase 2 - review and converge

The loop the whole skill exists for.

### Scope per round

Round 1 reviews the full change-set from the manifest.
Rounds 2+ review only the files the previous fix round touched, **plus** every
file a still-open finding names.
After the loop ends, if any fix round ran, do one final full-scope
`arch-evidence` + `architecture-reviewer` pass: delta reviews cannot see a
regression a fix caused somewhere else.

### One round

1. `arch-evidence` and `plan-verifier` in **parallel** - they answer different
   questions about the same two inputs, and neither reads the other.
2. `architecture-reviewer`, handed the evidence table. It judges what
   `arch-evidence` observed; it does not re-collect it.
3. `/code-review` when `--deep`.
4. UI fidelity when `--designs` was given **and** the manifest contains
   `client/**`: launch the app with the `run` skill, open the screen, compare it
   against the screenshot. Nothing that reads code finds a wrong spacing.
5. Merge everything into the ledger.

### The ledger

Identity key is `<file>|<rule>|<slug of the summary>` - deliberately **not** the
line number, which shifts under every fix and would make the same finding look
new each round.

Severity is decided here, not by the agent that reported it:

| BLOCKING | ADVISORY |
| --- | --- |
| Breaks a written boundary rule (`onion-architecture`, `frontend-ui-architecture`, `reviewer-core` purity, the two `vendor/shared` copies, the `*.it.test.ts` split) | Style, naming, structure with no rule behind it |
| Touches a do-not-touch path | A simplification that is only an improvement |
| `plan-verifier` marks a plan item or an `AC-N` **missing** | `plan-verifier` marks something **partial** with the remainder named |
| A test fails | A test is absent (there is no `test-writer` in this chain) |
| Anything security-shaped | |

### The gate

This is the one place the run stops for a human.

Show the ledger as a table - key, severity, source, what it claims, which round
it appeared in - and let the user mark each row `fix`, `accept`, or `defer`.
Default the BLOCKING rows to `fix` and the ADVISORY rows to `accept`, so a bare
"go" is a complete answer.

`accept` and `defer` both need a reason, and both are quoted verbatim in the
final report. An accepted finding that nobody can explain later is how a
boundary rule quietly stops being a rule.

### The fix pass

Write `docs/plans/<slug>.fixes-R<N>.md` - a plan-shaped addendum, because
`implementer` executes plans and nothing else:

```markdown
# Fixes - round <N> for <slug>

Source: architecture-reviewer / plan-verifier round <N> over <scope>

## Step 1 - <what to change>
- File: <path>
- Finding: <the claim, verbatim>
- Rule broken: <the sourced rule, or the AC-N not met>
- Done when: <the observation that proves it fixed>
```

Then call `implementer` with that path.
Never with the original plan - it is already executed, and re-running it invites
a second implementation of the same steps.

### Stopping

The loop ends when any of these is true:

- No `fix` rows remain after a gate.
- The round counter passes `--rounds` (default 3). Report what did not converge
  and stop; do not ask for one more round.
- **Ping-pong**: a finding whose state was `resolved` in an earlier round comes
  back. Escalate it to the user immediately and never auto-fix it again - a
  finding that returns almost always means the fix and the plan disagree, and a
  fourth attempt will not settle that.

## Phase 3 - wrap

1. Final report:

   | Section | Content |
   | --- | --- |
   | Plan | Path, and `plan-verifier`'s final coverage: done / partial / missing |
   | Spec | Each `AC-N`, and where it is satisfied |
   | Rounds | One row per round: findings in, fixed, accepted, deferred |
   | Unresolved | Everything still open, with why - never "mostly done" |
   | Tests | The commands actually run, with their real output |
   | Untested | Behaviour with no test, because `test-writer` is not in this chain |
   | Files | From the manifest, excluding the pre-existing dirty set |

2. `doc-writer` when `--docs`.
3. The `engineering-insights` wrap-up.
4. Mark the state file `done`.

**Nothing is committed, staged, or pushed, and no PR is opened.**
The run ends with a dirty working tree and a report.
Tell the user the next steps are `/pr-self-review` then `/security-review`, and
let them decide when.

## Rules

- **The plan is the contract.**
  Every step `implementer` takes traces to a plan step or a fix-round step.
  Work that traces to neither is scope creep, whoever asked for it.
- **Report what happened.**
  A failing test is quoted, not summarised. A skipped phase is named. "Converged"
  means the ledger has no open blocking rows, and nothing else.
- **Never fix by widening.**
  If the honest fix for a finding is a design change, that is a new
  `implementation-planner` pass, and the run stops with that recommendation.
- **The pre-existing dirty files are untouchable.**
  They were recorded in preflight for exactly this reason.
- **Escalate ambiguity, do not average it.**
  Two reviewers disagreeing about the same file is a question for the user, not
  something to resolve by picking the stricter one.
