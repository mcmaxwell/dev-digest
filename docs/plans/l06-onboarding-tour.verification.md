# Verification: L06 Onboarding Tour

The AC to task to test to commit matrix, produced by `plan-verifier` over the whole chain before
merge.

Spec: `docs/specs/L05-onboarding-tour.md` (70 EARS criteria).
Plan: `docs/plans/l06-onboarding-tour.md` (14 steps).
Fixes: `docs/plans/l06-onboarding-tour.fixes-R1.md` (6 findings).

| Commit | Stage |
| --- | --- |
| `fd9de1b` | baseline, the commit before this feature |
| `5fe492a` | spec |
| `0fc7d6f` | plan |
| `329cd7a` | implementation, production code only |
| `e5c29e9` | tests, derived from the spec's acceptance criteria |
| `35302e8` | fix round R1 |

## Result

| Done | Partial | Missing | Deviated | Unverifiable |
| --- | --- | --- | --- | --- |
| 68 | 0 | 0 | 0 | 0 |

Two rows came back `partial` from the first verification pass, AC-55 and AC-70, both observability
criteria with a real implementation and no test asserting it.
Both were closed before merge rather than merged as known gaps; see "Unclosed rows" below.

## Matrix

`Step` is the plan step. `Commit` is where the implementation landed; every test row landed in
`e5c29e9` unless the fix round added it, in which case the commit is `35302e8`.

| AC | Step | Implementation | Test | Commit | Status |
| --- | --- | --- | --- | --- | --- |
| AC-1 | 3, 5 | `onboarding/repository.ts:32-69` | `onboarding.it.test.ts` "replaces the stored tour rather than accumulating one per generation" | `329cd7a` | done |
| AC-2 | 12 | `client/src/vendor/ui/nav.ts:26` | `app-shell/helpers.test.ts` "places it above Project Context"; e2e flow 12 | `329cd7a` | done |
| AC-3 | 10, 12 | `app-shell/helpers.ts:29` (left as-is by design) | `helpers.test.ts` "highlights nothing on the add-repository screen" | `329cd7a` | done |
| AC-4 | constructive, 9 | no module outside `modules/onboarding/` imports it | `onboarding.it.test.ts` "puts no onboarding text into a review prompt" | `329cd7a` | done |
| AC-5 | 6 | `service.ts:433-436` | `onboarding.it.test.ts` "records the clone head as the tour commit" | `329cd7a` | done |
| AC-6 | 4, 6 | `facts.ts:44-133`, `constants.ts:117-143` | `facts.test.ts` "runnable commands and their source" | `329cd7a` | done |
| AC-7 | 4, 6 | `facts.ts:29-41` (`envKeys`, LHS only) | `facts.test.ts` "never reads a .env file"; `prompt.test.ts:222` | `329cd7a` | done |
| AC-8 | 4, 6 | `candidates.ts:26-34` | `candidates.test.ts` "preserves the rank order it was given, verbatim" | `329cd7a` | done |
| AC-9 | 4, 6 | `prompt.ts:30-39` | `prompt.test.ts` "excerpts at most 15 files", "at most the first 120 lines" | `329cd7a` | done |
| AC-10 | 4, 6, 12 | `service.ts:455-456,538` | `onboarding.it.test.ts` "uses no file excerpts above the 50,000-file cutoff" | `329cd7a` | done |
| AC-11 | 4 | `prompt.ts:55-64`, `service.ts:576-607` | `prompt.test.ts` "drops file excerpts before it touches anything else" | `329cd7a` | done |
| AC-12 | 7, 8, 9 | `service.ts:302-318` (no `withRetry`), `jobs.ts:62,89-107` | `onboarding.it.test.ts` "keeps ONE model call when the handler throws AFTER the call succeeded" | `329cd7a` | done |
| AC-13 | 7, 9 | `constants.ts:52`, `service.ts:315,337-345` | `onboarding.it.test.ts` asserts `attempts <= 3` | `329cd7a` | done |
| AC-14 | 7, 9 | `service.ts:264-267` | `onboarding.it.test.ts` asserts provider and model from settings | `329cd7a` | done |
| AC-15 | 7, 9 | `service.ts:306-318`, `constants.ts:46` | `onboarding.it.test.ts` "persists a readable degraded tour when the model call fails" | `329cd7a` | done |
| AC-16 | 7, 8, 12 | `service.ts:184-226` (claim before any await, F1) | `onboarding.it.test.ts` "refuses the second of two SIMULTANEOUS generate requests" | `35302e8` | done |
| AC-17 | 1, 4, 7, 12 | `schemas.ts:45-102`, `skeleton.ts:53-131` | `OnboardingTourView.test.tsx` "renders all five in the fixed order" | `329cd7a` | done |
| AC-18 | 4, 12 | `skeleton.ts` (`deterministicSections` always five) | `skeleton.test.ts` "the five sections always exist" | `329cd7a` | done |
| AC-19 | 4, 11, 12 | `skeleton.ts:38-50` (`EMPTY_BODY`) | `skeleton.test.ts`; client "renders an empty section with its own line naming what was looked for" | `329cd7a` | done |
| AC-20 | 4, 7 | `schemas.ts:46-51` | `verify.test.ts` "puts a diagram on the architecture section and on no other" | `329cd7a` | done |
| AC-21 | 4, 12 | `verify.ts:95-121` (`guardDiagram`) | client "leaves the prose standing when the diagram does not render, with no blank card" | `329cd7a` | done |
| AC-22 | 4, 7 | `verify.ts:266-280`, `constants.ts:63` | `verify.test.ts` "lists at most 8" | `329cd7a` | done |
| AC-23 | 6, 7 | `candidates.ts:43-60`, `verify.ts:269` | `candidates.test.ts`; `onboarding.it.test.ts` | `329cd7a` | done |
| AC-24 | 4, 7 | `verify.ts:294-310` | client "shows every run step with its ordinal, its command and the file it came from" | `329cd7a` | done |
| AC-25 | 4, 7 | `verify.ts:296-299` | `onboarding.it.test.ts` "drops every row and step whose path does not exist at head_sha" | `329cd7a` | done |
| AC-26 | 12 | `CopyButton.tsx:55-65` (`aria-live="polite"`) | client "copies a multi-line command whole from the keyboard alone, and announces the copy" | `329cd7a` | done |
| AC-27 | 4, 7 | `verify.ts:312-322`, `constants.ts:65` | `verify.test.ts` "lists at most 10" | `329cd7a` | done |
| AC-28 | 4, 7 | `verify.ts:332-343`, `schemas.ts:88-101` | `verify.test.ts` "lists at most 5" | `329cd7a` | done |
| AC-29 | 2, 6, 7, 9 | `candidates.ts:76-95` | `onboarding.it.test.ts` "builds first tasks only from markers we found and issues we fetched" | `329cd7a` | done |
| AC-30 | 4, 11, 12 | `skeleton.ts:48-49` | client empty-state test asserts both marker and issue wording | `329cd7a` | done |
| AC-31 | 6, 7, 9 | `service.ts:522-534` | `onboarding.it.test.ts` "records issues_unavailable and still produces marker tasks" | `329cd7a` | done |
| AC-32 | 4, 7 | `service.ts:320-336` (verify before upsert) | `verify.test.ts:88-108`; `onboarding.it.test.ts` | `329cd7a` | done |
| AC-33 | 4, 7 | `verify.ts:270-272,296-298,338-340` | `onboarding.it.test.ts` checks `dropped_rows` / `dropped_steps` | `329cd7a` | done |
| AC-34 | 4, 12 | `verify.ts:152-173` (`linkProsePaths`) | `verify.test.ts` "leaves a path that does not exist as plain text, never a link" | `329cd7a` | done |
| AC-35 | 4, 12 | `verify.ts:140-142`, `SectionCard.tsx:84` | client "links every path to the GitHub blob pinned to the generation commit" | `329cd7a` | done |
| AC-36 | constructive, 12 | every link `target="_blank"` to github.com | client same test, "and nowhere in-product" | `329cd7a` | done |
| AC-37 | 6, 12, 13 | `OnboardingTourView.tsx:69-71`, `service.ts:143,203-209` | `onboarding.it.test.ts`; e2e flow 12 | `329cd7a` | done |
| AC-38 | 12 | `OnboardingTourView.tsx:75-85` | client "states what a generation will produce when there is a clone and no tour" | `329cd7a` | done |
| AC-39 | 6, 7, 11, 12 | `OnboardingTourView.tsx:122-144`, `service.ts:735-744` | client "shows the phase and the five headings while generating" | `329cd7a` | done |
| AC-40 | 6, 12 | `TourHeader.tsx:60-65` | client "names the index size, the generation commit and the generation time" | `329cd7a` | done |
| AC-41 | 6, 12 | `TourHeader.tsx:67-69` | client, same test | `329cd7a` | done |
| AC-42 | 12 | `SectionCard.tsx:38,44-63` (local state) | client "collapses one card without touching the other four, and starts expanded" | `329cd7a` | done |
| AC-43 | 12 | `PageNav.tsx:15-20`, `SectionCard.tsx:54` | client "moves FOCUS to the section, not only the scroll position" | `329cd7a` | done |
| AC-44 | 12 | `constants.ts:4`, `OnboardingTourView.tsx:29-40` | client "collapses to a single jump control below 900px" | `329cd7a` | done |
| AC-45 | 12 | `TourHeader.tsx:44-48`, `helpers.ts:62-81` | client "copies the whole tour as Markdown" | `329cd7a` | done |
| AC-46 | 12 | `TourHeader.tsx:42-58` | client "carries no control producing a shareable URL" | `329cd7a` | done |
| AC-47 | 6, 12 | `service.ts:147-162,667-677` | `onboarding.it.test.ts` "reports staleness by commit once the head moves" | `329cd7a` | done |
| AC-48 | constructive, 9 | only `requestGeneration` calls `jobs.enqueue(GENERATE_JOB_KIND, …)` | `onboarding.it.test.ts` asserts `generated_at` unchanged after the head moves | `329cd7a` | done |
| AC-49 | 5, 7, 9 | `repository.ts:55-69` | `onboarding.it.test.ts` "replaces the stored tour" | `329cd7a` | done |
| AC-50 | 7, 12 | `service.ts:382-389` (write once, at the end) | client "keeps the previous tour readable while a regeneration runs" | `329cd7a` | done |
| AC-51 | 3, 9 | `db/schema/context.ts:121-123` (`onDelete: 'cascade'`) | `onboarding.it.test.ts` "removes the tour when the repository is removed" | pre-existing | done |
| AC-52 | 1, 7, 9 | `service.ts:337-346,352-361` | `onboarding.it.test.ts` asserts the whole usage record | `329cd7a` | done |
| AC-53 | 12 | `TourHeader.tsx:120-140` (`CostLine`) | client "shows the call count, the token counts and the dollar cost" | `329cd7a` | done |
| AC-54 | 1, 11, 12 | `helpers.ts:42-45` (returns null, never `$0.0000`) | client "states that cost is unavailable rather than showing zero" | `329cd7a` | done |
| AC-55 | 7 | `service.ts:290-299`, `prompt-log.ts:141-177` | closed after verification, see "Unclosed rows" | `329cd7a` | done |
| AC-56 | 6, 7, 9 | `service.ts:450-456` | `onboarding.it.test.ts` "falls back to the heuristic and marks both graph sections" | `329cd7a` | done |
| AC-57 | 2, 4, 6, 9 | `candidates.ts:107-163`, `service.ts:487-505` | `candidates.test.ts:126-229`; three integration scenarios | `35302e8` | done |
| AC-58 | 1, 4, 12 | `verify.ts:80-88`, `service.ts:478-485` (`GraphSignals`, F2) | `onboarding.it.test.ts` "marks critical paths without the graph while the reading path keeps its ranking" | `35302e8` | done |
| AC-59 | 7, 12 | `service.ts:365,394-411`, `TourHeader.tsx:103-109` | `onboarding.it.test.ts` "states each degraded reason exactly once" | `329cd7a` | done |
| AC-60 | 4, 7, 12 | `skeleton.ts`, `TourHeader.tsx:49-57` (Retry) | client "offers Regenerate on a healthy tour and Retry on a degraded one" | `329cd7a` | done |
| AC-61 | 7, 9 | `repository.ts` (persisted document) | `onboarding.it.test.ts` re-reads through a fresh app after failure | `329cd7a` | done |
| AC-62 | 5, 7, 9 | `repository.ts:55-69` | `onboarding.it.test.ts` retry continuation asserts `status === 'ready'` | `329cd7a` | done |
| AC-63 | 6, 7, 12 | `service.ts:684-702` (`parseStoredTour` never throws) | `onboarding.it.test.ts` "persists an honest degraded tour when the clone goes away" | `35302e8` | done |
| AC-64 | 4 | `prompt.ts:86-192` (every block `wrapUntrusted`) | `prompt.test.ts` "encloses the README, the file excerpts and the issue titles" | `329cd7a` | done |
| AC-65 | 4 | reused, `reviewer-core/src/prompt.ts:30-34`, unchanged | `prompt.test.ts` "neutralises a fact that carries the closing delimiter" | pre-existing | done |
| AC-66 | 12 | `DocMarkdown.tsx:8-13,30-45` (L05 component, reused) | client "renders embedded HTML and script as text, and emits no non-http(s) link" | pre-existing | done |
| AC-67 | 8 | `routes.ts:33-41` (`IdParams` only) | `onboarding.it.test.ts` "accepts no client-supplied path on either route" | `329cd7a` | done |
| AC-68 | constructive, 9 | `GitClient` has no write method | `onboarding.it.test.ts` "writes nothing into the clone" (filesystem snapshot) | `329cd7a` | done |
| AC-69 | 6, 7, 8, 9 | `service.ts:632-636` (`requireRepo`) | `onboarding.it.test.ts` 404s on both routes cross-workspace | `329cd7a` | done |
| AC-70 | 7 | `service.ts:254,350` (`scrubSecrets`) | closed after verification, see "Unclosed rows" | `329cd7a` | done |

## Unclosed rows

Both rows the first verification pass returned as `partial`.
Both were observability criteria: real implementation, correctly placed, but nothing that would
fail if they broke.

| AC | Why it was open | How it was closed |
| --- | --- | --- |
| AC-55 | No test exercised `logPromptAssembly` or `buildPromptLogRecord` **for a generation**. | Four integration cases that capture the real logger during a generation: exactly one `prompt.assembled` line per generation, carrying `call: 'onboarding'`, a correlation id, the model and per-section token counts; and eight distinctive strings from three fact channels and the model's own output asserted absent from every line, alongside a positive token count so the assertion cannot pass vacuously. Plus five appended unit cases on the record builder. |
| AC-70 | `onboarding.it.test.ts` staged a secret-shaped string in a thrown provider error, but nothing ever read it back, so its absence was never checked. | A test at the criterion's own observation point: a README heading carrying an example API key, under `PROMPT_LOG=verbose`. It asserts the heading survived **and** the key was replaced, so the key's absence cannot be explained by the line having been dropped. **This test found a real bug - see below.** |

### The correction I owe on AC-55

My instruction to the test-writer repeated the verifier's claim that `server/test/prompt-log.test.ts`
did not exist.
It did, with seven tests.
The verifier's grep was scoped to `server/src`, and the platform tests live flat in `server/test/`,
so the file was outside the search path rather than absent.
The seam was half-covered already; what was genuinely missing was any test of it *for a
generation*, which is what AC-55's observation point names.
The existing seven tests were preserved byte-identical and the new cases appended
(`git diff` on that file is 101 insertions, 0 deletions).

### The bug AC-70's test found

`scrubSecrets` did not recognise Stripe keys.
`SECRET_PATTERNS` matched `sk-…` with a hyphen; Stripe uses an underscore, so
`sk_live_…` and `sk_test_…` passed through untouched, as did GitLab `glpat-` and Slack `xox…-`.

A README containing `STRIPE_KEY=sk_live_51H8Zz…` therefore reached the server log verbatim under
`PROMPT_LOG=verbose`, because `outlineOf` keeps Markdown headings intact and the scrub was the only
thing standing between an untrusted repository file and the log.

The irony is the sharpest part of the finding: `sk_live_xxx` is this product's own canonical
example of a leaked secret.
`server/src/adapters/mocks.ts:195` seeds it as exactly the finding a review is meant to catch.
A shape the product teaches its users to fear was not secret-shaped by its own scrubber.

Blast radius, stated honestly: `summary` is the default mode and keeps no line of any file, and
`verbose` is refused when `NODE_ENV=production` (`config.ts:89-90`), so the exposure was a
developer running verbose locally, not a production aggregator.
AC-70 carries no mode qualifier though - it says *every* log line this feature emits.

Fixed in `server/src/platform/prompt-log.ts` by adding Stripe, GitLab and Slack patterns.
Verified by probe:

```
sk_live_<example-not-a-real-key>  -> [redacted:stripe-key]
sk_test_<example-not-a-real-key>  -> [redacted:stripe-key]
xoxb-<example-not-a-real-token> -> [redacted:slack-token]
glpat-<example-not-a-real-token>         -> [redacted:gitlab-token]
not-a-secret-at-all                -> not-a-secret-at-all
```

This is the clearest argument in the whole chain for writing tests from the specification rather
than from the shipped code.
A test derived from the implementation would have asserted the shapes the code already knew, and
would have been green.

## Plan steps

All 14 landed.
Steps 9 and 13 were reassigned from the implementer to the test-writer on purpose, so that the
tests would derive from the spec's acceptance criteria rather than from the shipped code; every
`*.test.ts` was withheld from `329cd7a` and written in `e5c29e9`.
That is the intended ordering, not a gap.

## Fix round

| Fix | Verdict |
| --- | --- |
| F1, single-flight TOCTOU | applied, premise disproven and documented. Reverting the fix left the concurrent test green: check-and-set with no `await` between them is already mutually exclusive on a single-threaded event loop. Kept as a cheaper refusal and as a guard if an `await` is ever inserted between the two. |
| F2, `usedGraph` mislabelling | done, split into `GraphSignals { reading, critical }` with two integration scenarios |
| F3, narrower junk denylist | done, patterns moved to the import-exempt `repo-intel/constants.ts` and shared |
| F4, probe-budget ordering | done, bounded fields probed before prose |
| F5, unguarded `collectFacts` | done, confirmed real by reverting it (`expected 'ready' to be 'degraded'`) |
| F6, depth penalty | done, depth is now a tie-break |

## Deviations and corrections

- **The plan carried an unsatisfiable acceptance line.** It required
  `grep -rn '"/onboarding"' client/src` to return nothing after the route move, while the same step
  says to leave `app-shell/helpers.ts:29` exactly as it is - and that line contains the string.
  Corrected in the plan to `grep -rn 'push("/onboarding")'`, which is what the step actually does.
- **`clone_unavailable` is a sixth degraded reason** beyond the five the spec's module-interactions
  table enumerates. It was added by F5 because reporting a vanished clone as `model_failed` would
  have been a lie. The spec is not rewritten - `docs/specs/README.md` says nothing rewrites an
  existing spec - so this is recorded here as a known, deliberate addition.
- Seven deviations the implementer declared were each verified true and acceptable: the real
  `jobs.enqueue(workspaceId, kind, payload)` signature (the plan had it wrong), the request-time
  single-flight claim, `collectDraftPaths`, `AppError(..., 409)` over a new `ConflictError`, the
  local `COMMIT_DISTANCE_MAX_COUNT`, and `DeterministicFacts.present` carrying paths rather than
  content - the last of which was a real leak of `.env.example` values into the fact struct.

## Scope creep

None beyond `clone_unavailable` above.
Every other line in the diff traces to a named acceptance criterion or a named plan step.
