# modules/onboarding — the generated repository tour (L06)

One tour per imported repository: five fixed sections built from facts DevDigest
already holds plus **exactly one** structured model call, with every path the
model emitted checked against the clone before anything is stored.

Spec: `docs/specs/L05-onboarding-tour.md`.

## The three properties this module exists to hold

**One model call per generation.**
`completeStructured` is called once, wrapped in `withTimeout` and deliberately
**not** in `withRetry` — a retry would re-issue the whole call.
The provider's own repair loop runs `maxRetries + 1` attempts, so
`MAX_SCHEMA_REPAIRS = 2` bounds `usage.attempts` at 3 with no extra code.
The job registers with `retries: 0`, because `JobRunner` otherwise wraps every
handler in `withRetry` at 2 and any throw *after* a successful call would re-run
the handler — and re-issue the call — up to three times per click.
`usage` on the tour is what makes all of this falsifiable from the page rather
than from a log.

**No path resolves to a bare error.**
A missing index, unavailable issues, a failed model call and a stored document
that no longer parses are all statuses the page renders.
The deterministic skeleton (`skeleton.ts`) is both the fallback tour and the base
every successful generation merges into, so all five sections always exist.

**Nothing the client says is a path.**
The read list is the module constant `FACT_FILES`; every other path comes from
`repo-intel` or from the model and is then checked against the clone.
Neither route schema carries anything path-shaped, which removes the
path-traversal class by construction instead of defending against it.

## The prompt ceiling bounds assembly, not spend

`PROMPT_TOKEN_CEILING = 30_000` is measured with **our** tokenizer over the user
text **we** build, and the budget ladder drops excerpts and then walks the
repo-map budget down until it fits (AC-11).

It does not bound the invoice, and the difference is large enough to matter.
A live generation against `openai/gpt-5.6-luna-pro` on OpenRouter measured
11,376 tokens here and was billed **57,243** - 5.0x, on two consecutive runs.
The system prompt is 748 tokens and the structured-output JSON schema is 1,817,
so they explain almost none of it; a deliberately tiny 21-token prompt to the
same model was billed 1,718, so it is not a fixed overhead either.
The remainder is the provider's accounting and could not be attributed from the
client side.

So: **lowering the ceiling shrinks the prompt, not reliably the bill.**
`logTokenAccounting` emits the measured figure, the billed figure and their
ratio on every generation, and raises the line to `warn` past
`TOKEN_ACCOUNTING_WARN_RATIO`.
When you need to reason about spend, read `usage.tokens_in` and `usage.cost_usd`
from the provider result - which is also what the page shows - never a locally
measured count.

## Files

| File | What it is |
| --- | --- |
| `constants.ts` | Every budget, cap and fixed list, so a measurement can move a number without reading the algorithm |
| `types.ts` | Work-in-progress shapes. Nothing here is stored or returned |
| `facts.ts` | Pure extraction from the fixed fact-file list |
| `candidates.ts` | Pure. The sets a row may be drawn from, including the no-graph heuristic |
| `schemas.ts` | The schema the MODEL sees — flat, five fixed keys |
| `prompt.ts` | Pure assembly, every fact block `wrapUntrusted`-wrapped |
| `verify.ts` | Pure grounding over an injected `exists(path)` |
| `skeleton.ts` | The deterministic five sections, and the merge |
| `repository.ts` | The only drizzle importer; one row per repository |
| `service.ts` | Fact collection, the one call, verification, persistence, single-flight |
| `routes.ts` | Two routes, one service instance, the job registration |

## Grounding: candidate sets, not post-hoc checks

AC-8 ("the reading path's order matches `getTopFilesByRank`") and AC-23
("critical-path entries all appear in `getCriticalPaths` output") are MEMBERSHIP
and ORDERING properties.
Post-hoc verification can only ever check existence, so the rows are built from
candidate sets in the first place and `verify.ts` drops anything outside them.

Run steps are deliberately **not** restricted this way: AC-25 defines the check
as "the cited source file exists", not "the command came from a list", so the
model may quote a command out of a README as long as it names the file it read
it from — and that citation is the only thing the reader can check it against.

Prose paths are linked only when they resolve.
An invented path stays inline code and never becomes a link, because a
hallucination rendered as a working-looking link is indistinguishable from a
fact.

## The degraded matrix

| Condition | Reason recorded | What the tour still does |
| --- | --- | --- |
| Index absent / `filesIndexed = 0` / `failed` | `no_index` | Both graph-dependent sections fall back to the directory-prominence heuristic and are marked `no_graph` |
| Index `partial` or `degraded` | `partial_index` | Same, recorded separately |
| Above `EXCERPT_CUTOFF_INDEXED_FILES` | `repo_too_large` | Zero excerpts; every other budget unchanged |
| `listIssues` throws (incl. no `GITHUB_TOKEN`) | `issues_unavailable` | First tasks come from `TODO`/`FIXME` markers alone |
| Model call fails, times out, or cannot be repaired | `model_failed` | The deterministic skeleton is persisted; the page offers Retry |
| The clone cannot be read AT JOB TIME (resync, deletion) | `clone_unavailable` | No model call is made at all; the empty skeleton is persisted with this reason and the page offers Retry |

A degraded tour is persisted and readable. It is never rendered as an error.

`clone_unavailable` is separate from `model_failed` on purpose. `requestGeneration`
checks the clone, but the generation runs LATER on the queue, so the clone can be
mid-resync or gone by the time `collectFacts` reads it. Reporting that as a model
failure would blame the model for a disk, and letting the job simply throw would
persist nothing at all — the page would then keep rendering the PREVIOUS tour and
look like nothing had happened.

## The two halves of the import graph

`usedGraph` is a PAIR, not a boolean, because the two graph-dependent sections
lose the graph separately:

- **Reading path** needs a *ranking*. `computeFileRank` gives an edge-less
  repository PageRank's uniform floor rather than nothing, so "there are ranked
  files" is not "there is a ranking" — the rank percentiles are read and a
  single shared value counts as no ranking. A rank the port could not report at
  all is UNMEASURED, not flat, and does not downgrade the section.
- **Critical paths** need *edges*. `getCriticalPaths` returns `[]` as soon as
  there are none, so its own emptiness is the signal.

A repository with a real ranking and no usable chains therefore marks Critical
paths `no_graph` while the reading path stays `ok`. Reporting the first as
`empty` would read as "we looked and found nothing" (AC-57, AC-58).

## The trust boundary

Everything this module reads was written by someone other than the person
reading the tour — the repository's maintainers, a vendored dependency, or a
stranger who opened an issue.
All of it goes through `wrapUntrusted`, which also neutralises a nested
`</untrusted>` so a README cannot close its own block.

There is deliberately **no second injection-guard sentence** in `prompt.ts`.
`src/prompts/onboarding.system.md` already carries the one canonical rule, and a
second, weaker phrasing beside a new untrusted slot is worse than none.

`.env` is not on the read list at all, and `.env.example` yields variable NAMES
only — `DeterministicFacts.present` carries file PATHS rather than content for
exactly that reason.

## What runs where

The generation is not awaited in the request.
`POST /repos/:id/onboarding/generate` claims the in-memory single-flight slot,
enqueues the job and returns the page with `generation.status = 'running'`; the
client polls `GET /repos/:id/onboarding` for the phase.
The slot is claimed at REQUEST time, not inside the handler, so a second request
arriving while the first is still queued is refused rather than queued behind it.
It is claimed BEFORE the repository read and the clone probe, so the check and
the claim stay an unbroken pair no matter what those reads do, and every early
exit (unknown repository, no clone, a queue that refused the job) releases it.
It is per process — two API processes would each allow a generation — which is
the price of not having a `running` row that would need a boot reaper.

## Things that will bite

- `MockGitClient.readFile` resolves a MISSING path to `''`. Every "file absent"
  branch treats blank as absent, not only a throw.
- A first task can only be found in the top `MAX_RANKED_FILES` files: the marker
  grep is filtered to the candidate set, which is what keeps a `TODO` inside a
  vendored dependency out of the tour. Raising the constant is free.
- `HEURISTIC_EXCLUDE_PATTERNS` extends `repo-intel`'s `JUNK_PATH_PATTERNS`
  rather than re-typing it. The ranked path is filtered twice (index-time
  `EXCLUDED_DIRS`, read-time junk filter) and the no-graph path only here, so a
  local copy silently became the narrower of the two and let `*.test.ts`,
  `tsconfig.json` and `.d.ts` into an unindexed repository's tour. Import the
  constants; never `isJunkPath` itself — `repo-intel/service.ts` is not an
  exempt cross-module import and `arch:check` rejects it.
- `guardDiagram` is a STRUCTURAL check, not a real mermaid parse. The client's
  `MermaidDiagram` is the authoritative gate and renders `null` on failure.
- `repo_too_large` marks an otherwise perfect tour `degraded`. The spec's enum
  puts it there; a healthy 60,000-file repository will show a degraded badge on
  a good tour.
