# `modules/eval` — the regression harness (L06)

Turns the Accept/Dismiss decisions a reviewer already makes into a gold set, runs
an agent over the whole set with fixed inputs, and scores the result in pure
code. Spec: [`docs/specs/L06-eval-pipeline.md`](../../../../docs/specs/L06-eval-pipeline.md).

## Why there is no judge

An expectation is a file and a line range. A finding matches when the file
string is equal and the line ranges overlap, so a comparison settles it and the
scorer never calls a model. `scoring.ts` imports no `Container`, no adapter and
no provider, which is what makes the per-case call count in
`test/eval.it.test.ts` a real assertion rather than a hopeful one.

## The flow

```mermaid
flowchart LR
  D["finding decision<br/>accepted / dismissed"] --> C["eval_cases<br/>diff + expectations"]
  C --> R["EvalService.runSuite"]
  R -->|"one call per case"| E["reviewer-core<br/>reviewPullRequest"]
  E --> G["grounding gate<br/>kept / dropped"]
  G --> S["scoring.ts<br/>PURE, no model"]
  S --> SR["eval_suite_runs + eval_runs"]
  SR --> CMP["paired compare<br/>gained / lost / unchanged"]
```

## Fixed inputs, and why

A run passes only the agent's system prompt, model, strategy, its enabled linked
skills, and the case's parsed diff. No repo-intel, no derived intent, no project
context, no PR body.

Those are exactly the inputs that move between two moments in time. A harness
whose inputs drift cannot attribute a metric change to the prompt, which is the
one question it exists to answer. Enriching an eval run is a **non-goal**, not
an omission.

## The metrics

| Metric | Definition |
| --- | --- |
| `recall` | matched `must_find` / all `must_find`, micro-averaged over the set |
| `precision` | findings overlapping a `must_find` / all grounded findings. **Strict**: overlapping a `must_not_flag`, or nothing at all, is a false positive |
| `citation_accuracy` | findings the grounding gate kept / (kept + dropped) |
| `f1` | derived, not stored — the headline, because precision and recall are each gameable alone |
| `pass` | every `must_find` matched AND no `must_not_flag` matched. Extra noise costs precision without failing the case |

Micro-averaged, so a case with one expectation cannot outvote a case with nine.
Every empty denominator has a stated value (see `scoring.ts`) rather than a null:
`EvalRun` requires numbers in `[0, 1]`.

## Reading a comparison

The per-case pairing is the point, not the deltas. On a set of a dozen cases one
flipped case moves a ratio by more than ten points, so an aggregate delta cannot
be told apart from the model's own sampling. `pairCases` reports gained / lost /
unchanged, and reports a case present in only one of the two runs rather than
dropping it — silently comparing two different sets is how a harness starts
lying. The pass rate is rendered with a Wilson 95% interval for the same reason.

`repeats` (1–3) runs each case K times, averages the ratios and takes the
majority verdict. Off by default: it multiplies the bill in direct proportion.

## Things that will bite

- **`eval_runs` has no `workspace_id`.** Tenancy comes from the layer above, as
  `pr_intent` does: the service resolves the case or the suite run through a
  workspace-scoped read first. Never query `eval_runs` from an unscoped id.
- **A run is synchronous and billable**, like `POST /reviews/diff`. It is rate
  limited and it must never go behind `JobRunner`, which wraps handlers in
  `withRetry(retries: 2)` and would re-bill every call of a failed attempt.
- **A run is all-or-nothing.** One case failing aborts it and persists nothing;
  a partially-measured run stored beside full ones is compared against a
  different denominator with nothing on screen saying so.
- **The eval path sends no `temperature`.** Structured calls already default to
  0 on all three providers. Adding one here would make two runs of one unchanged
  prompt incomparable. (OpenAI reasoning models drop the parameter entirely, so
  they are less repeatable regardless.)
- **`evalF1` / `evalWilson` live in `contracts/eval-math.ts`**, an import-free
  file, so the client can deep import them without webpack chasing the barrel's
  `.js` specifiers. Do not move them into `eval-suite.ts`.

## The gold set

`db/seed-eval-cases.ts` seeds twelve cases for the Security Reviewer spanning
four kinds — `floor`, `headroom`, `noise`, `clean` — tagged in `notes`. The
composition is the requirement, not the count: a set minted only from accepted
findings is one the agent already passes, so recall pins at 1.0 and the harness
measures nothing. `test/eval-fixtures.test.ts` asserts every seeded expectation
would survive the grounding gate, because an expectation outside its own diff
scores zero forever and reads as an agent failure.

## Verify

```sh
cd server && pnpm verify:l06     # scorer + fixtures + the DB-backed route tests
```
