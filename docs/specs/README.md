# Specs - product level

One spec per feature or course lesson: what the system must do, for whom, and
how you would know it works.
Package-local implementation notes go to `<package>/specs/` instead.

A spec is written by the [`specreator`](../../.claude/agents/specreator.md)
agent and read by `implementation-planner`, which turns it into a plan.
The spec says **what** the system does and **where the boundaries run**; the
plan says **how** it is built.

## Naming

`L<NN>-<slug>.md`, where `<NN>` is the next free lesson number and `<slug>` is
the feature in two or three words.
The same number is the spec's identity inside the file: `Spec ID: L<NN>`.

One feature that ships in two halves keeps one number and takes two slugs, as
`L03-intent.md` and `L03-smart-diff.md` already do.

Nothing rewrites an existing spec.
A decision that replaces an earlier one gets its own file with `Supersedes:`
pointing at the old ID; the superseded file is marked by hand.
`L01`-`L03` predate this template and are left as they are.

## Template

```markdown
# Spec: <feature name>

Spec ID: L<NN>
Status: draft | approved | implemented
Supersedes: <spec ID, if this one replaces an earlier decision>

## Problem and user
## Goals and non-goals
## User stories
## Module interactions
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance
## Untrusted inputs
## Design review
## Open questions
```

Every section appears, in this order.
A section with nothing to say gets one line - `None - <why>` - never `TBD` and
never silence.

| Section | Holds |
| --- | --- |
| **Problem and user** | Who hits this, what they do today without the feature, and what it costs them. No solution. |
| **Goals and non-goals** | What success is. Non-goals are the scope fence: the reasonable-sounding things this spec deliberately does not do. |
| **User stories** | One line per story, in the user's vocabulary. If they split into several independent stories, that is usually two specs. |
| **Module interactions** | Which modules take part, who calls whom, what crosses each boundary, and what happens when a neighbour is unavailable. Mermaid diagrams and data-shape contracts belong here. |
| **Acceptance criteria (EARS)** | The falsifiable core of the spec. See below. |
| **Edge cases** | Empty, zero, one, very many, too long, unauthorized, offline, concurrent, already-exists, partially-failed. |
| **Non-functional requirements** | Latency, cost, token budget, data volume, accessibility - each with a number, or it is not a requirement. |
| **Inputs and provenance** | Every input, where it comes from, and what its absence means. An input with no stated source is a guess. |
| **Untrusted inputs** | What arrives from outside the trust boundary - PR bodies, diffs, third-party READMEs, file contents - and what the system may never let it do. |
| **Design review** | What the mockups did not answer: missing states, uncovered corner cases, UX proposals. Each line marked `accepted`, `rejected`, or `open`. |
| **Open questions** | What is still undecided, each with the assumption the rest of the spec was written under. |

## Acceptance criteria in EARS

Each criterion gets a stable identifier - `AC-1`, `AC-2`, … - so a plan, a
test, and a PR can cite the same requirement without paraphrasing it.
Identifiers are never renumbered.

Five patterns, and every criterion is one of them:

| Pattern | Form |
| --- | --- |
| Ubiquitous | The system shall `<response>` |
| Event-driven | WHEN `<trigger>`, the system shall `<response>` |
| State-driven | WHILE `<state>`, the system shall `<response>` |
| Unwanted behaviour | IF `<condition>`, THEN the system shall `<response>` |
| Optional feature | WHERE `<feature is included>`, the system shall `<response>` |

Rules:

- **One criterion, one requirement.**
  An `and` in the middle usually hides two tests.
- **Each criterion names where it is observed** - a screen, an API response, a
  row, a log line.
  A requirement nobody can watch fail is not a requirement.
- **No vague predicates.**
  `fast`, `robust`, `user-friendly`, `properly`, `gracefully`, `as needed`,
  `where appropriate` are banned - they are the thing EARS exists to replace.
- **No implementation.**
  Table names, migrations, function signatures, library choices and new file
  paths belong to the plan.

The translation the notation is for:

| Vague requirement | EARS criterion |
| --- | --- |
| "should work fine on big repos" | WHEN a repository exceeds the indexing threshold, the system shall generate the overview from deterministic facts only, without reading file bodies |
| "shouldn't break if the model is down" | IF the structured model call fails, THEN the system shall render the deterministic review skeleton with the reason, instead of an error |
| "should hint where to start reading" | The system shall order the reading path by file rank from the import graph, not alphabetically or by date |
