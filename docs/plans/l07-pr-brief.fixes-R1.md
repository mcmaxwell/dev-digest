# Fixes - round 1 for l07-pr-brief

Source: `plan-verifier` round 1 over the full change-set in `.claude/last-change.json`
(`architecture-reviewer` round 1 returned a clean verdict with no findings).

Two steps. Step 1 is the blocking finding. Step 2 is an advisory promoted into this
round because it is an acceptance criterion that is currently unmet in code and the
fix is a few lines.

Triage decisions carried into this round, for the final report:

- **AC-20** - not fixed in code. The criterion was amended instead, by decision at
  the gate: the original wording ("exactly one model-written paragraph ... across
  all its cards") contradicted the same spec's decision to keep L03's intent quote,
  which is also model-written. `docs/specs/L07-pr-brief.md:181` now reads "exactly
  two model-written prose blocks ... and no third", with the amendment note beneath
  it. No code change follows from this. Do not touch `IntentCard.tsx`.
- **AC-23** - accepted. Reason recorded: asserting that the persisted `what`
  contains an incompleteness statement requires a model that produces compliant
  text; the prompt-level instruction and its test are the verifiable half.
- **Degraded prose is empty** (`persistDegraded`) - accepted. Reason recorded: the
  reason code is what the client renders through next-intl, and a sentence composed
  on the server could not be translated. The plan's word "deterministic" oversold
  it; the behaviour is right.

## Step 1 - The brief history must render newest first

- File: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`
  (the `BriefHistory` component, around lines 419-478)
- Also: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx`
  (the brief-history fixture and its assertions, around lines 303-321)
- Finding, verbatim: "the brief-history section does not render newest-first in
  production. `BriefHistory` drives its row order from the `commits` prop, which
  arrives oldest-first from GitHub and is passed through unmodified; only entries
  with no matching commit fall back to (already newest-first) `entries` order. The
  `PrBriefCard.test.tsx:313-321` test passes only because its fixture's `commits`
  array is hand-ordered newest-first, which does not match production data shape."
- Rule broken: **AC-45** - "the system shall render the brief history newest first".
- Evidence the finding rests on, so you do not have to re-derive it:
  - `server/src/adapters/github/octokit.ts:85-89` returns commits with no reverse
    and no sort - GitHub's `pulls.listCommits` is oldest-first.
  - `server/src/modules/pulls/repository.ts:82-83` `getCommits` has no `orderBy`.
  - The server side is already correct: `server/src/modules/brief/repository.ts:91-98`
    orders `pr_brief_history` by `desc(...)`. The client discards that order.
  - The shipped precedent for this exact requirement sorts explicitly:
    `client/.../RunHistory.tsx:113-118` does `.sort((a, b) => b.ts - a.ts)`.
- What to change: order the rendered rows newest-first regardless of the order
  `commits` arrives in. Keep the AC-46 behaviour intact - a commit with no brief
  entry still renders its explicit no-brief marker, and it must land in the same
  newest-first sequence as the rest, not in a separate block.
- **Fix the test fixture first, and watch it go red.** The current fixture hands
  `commits` in newest-first order, which production never does. Reorder it to
  oldest-first so it matches `octokit.ts`'s real output, confirm the existing
  assertion fails, then make it pass. A fixture that cannot fail is what let this
  ship.
- Done when: `PrBriefCard.test.tsx` contains a brief-history case whose `commits`
  prop is in oldest-first order and which asserts the rendered rows are newest-first,
  and `cd client && pnpm test` is green.

## Step 2 - Enforce the three-sentence half of AC-21 in code

- File: `server/src/modules/brief/service.ts` (the prose clamp, around lines 591-593)
- Finding, verbatim: "char cap enforced (`schemas.ts:73,81` `.max(MAX_PROSE_CHARS)`,
  `service.ts:591-593` `clamp`); the 3-sentence cap is only a prompt instruction
  (`prompt.ts:58`), never counted/enforced in code."
- Rule broken: **AC-21** - "the system shall constrain the brief's prose to at most
  three sentences per field, observed as the stored `what` and `why` each containing
  at most three sentence-terminating marks."
- What to change: extend the existing clamp so it also bounds sentence count, using
  the same observation the criterion names - sentence-terminating marks. Truncate at
  the third terminator rather than rejecting the whole field, matching how the
  character clamp already degrades. Keep the prompt instruction where it is; the
  clamp is the enforcement, the instruction is what keeps the model from needing it.
- Do not: change `MAX_PROSE_CHARS`, add a retry, or reject a brief for over-long
  prose - a degraded field is the shipped behaviour, an error is not.
- Done when: a unit test covers a four-sentence field being stored as three, and
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` is green.

## Out of scope for this round

- `IntentCard.tsx` - see the AC-20 note above. The criterion moved, the code does not.
- Anything not named in the two steps above.
