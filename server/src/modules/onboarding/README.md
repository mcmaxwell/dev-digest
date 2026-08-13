# modules/onboarding — the generated repository tour (L06)

One tour per imported repository: five fixed sections built from facts DevDigest
already holds plus **exactly one** structured model call, with every path the
model emitted checked against the clone before anything is stored.

Spec: `docs/specs/L06-onboarding-tour.md`.

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

A degraded tour is persisted and readable. It is never rendered as an error.

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
It is per process — two API processes would each allow a generation — which is
the price of not having a `running` row that would need a boot reaper.

## Things that will bite

- `MockGitClient.readFile` resolves a MISSING path to `''`. Every "file absent"
  branch treats blank as absent, not only a throw.
- A first task can only be found in the top `MAX_RANKED_FILES` files: the marker
  grep is filtered to the candidate set, which is how the junk-path filter is
  applied without importing `isJunkPath` (module-local to `repo-intel`, and not
  an exempt cross-module import). Raising the constant is free.
- `guardDiagram` is a STRUCTURAL check, not a real mermaid parse. The client's
  `MermaidDiagram` is the authoritative gate and renders `null` on failure.
- `repo_too_large` marks an otherwise perfect tour `degraded`. The spec's enum
  puts it there; a healthy 60,000-file repository will show a degraded badge on
  a good tour.
