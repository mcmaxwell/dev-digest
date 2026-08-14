# modules/brief — the PR Brief (L07)

One brief per pull request: a single model-written paragraph, a ranked
"read these first" list, grounded risks that each name a real file, and an
append-only record of how the brief read at each commit that had one.

Spec: `docs/specs/L07-pr-brief.md`. Plan: `docs/plans/l07-pr-brief.md`.

This module is an **application-layer composer**.
Every fact it uses already exists somewhere else — `BlastService` for reach and
the index verdict, `IntentService` for the derived intent,
`_shared/diff-loader.ts` for the diff, `container.reviewRepo` for the PR and the
prior-PR overlap, `container.github()` / `container.git` for the linked issue and
the spec files.
It adds no port, issues no raw `fetch`, and dereferences no URL.

## The four properties this module exists to hold

**One model call per generation, and four gates before it.**
`completeStructured` is called once, wrapped in `withTimeout` and deliberately
**not** in `withRetry` — a retry wrapper re-issues a paid call.
The provider's own repair loop runs `MAX_SCHEMA_REPAIRS + 1 = 3` attempts.
Four conditions persist a deterministic brief and spend nothing:
`index_degraded`, `clone_unavailable`, `no_files`, and `model_failed` (which is
the only one where a call was made and failed).
None of them is an error status — the card renders the reason, never an error
page.

**Nothing the model invents ever renders.**
`candidates.ts` builds the membership sets from the PR's own facts, and
`ground.ts` intersects everything the model returned back with them.
This is a rejection gate rather than a warning because a hallucinated path
rendered as a working-looking link is indistinguishable from a fact, and the
reviewer has no way to tell.
What was removed is counted per category and shown, so a brief that dropped nine
of ten statements does not look like one that dropped none.

**A caller's line number can never become a location in this PR.**
`BlastCaller.line` is a position in the repository's **default branch** at
`last_indexed_sha`.
Neither `candidates.ts` nor `ground.ts` has a parameter that could carry one:
the service projects the blast result down to caller *paths* before either file
sees it.
A line survives only by falling inside a `@@` range from
`_shared/hunk-map.ts::buildHunkRanges` for that same file — and caller files have
no ranges at all.
The guarantee is structural, not a filter someone can delete later.

**The prompt never sees a diff hunk body.**
The only change-location source is `buildFileMap`'s reconstructed `@@` headers,
derived from four integers per hunk.
Every list marker in the prompt is indented so that "no line begins with `+` or
`-` outside a `@@` header" stays a usable mechanical check.

## The two histories are different data

They are next to each other in the contract and they are not the same thing.

| Field | What it is | Where it comes from |
| --- | --- | --- |
| `history` | Prior PRs of the same repository whose changed files overlap this one's | `reviewRepo.overlappingPulls` → `history.ts`, deterministic, no model |
| `brief_history` | *This* PR's own per-generation timeline, newest first | `pr_brief_history`, one row appended per generation |

`brief_history` is APPEND-ONLY, and `BriefRepository` exposes no update and no
delete for that table.
The guarantee is the absence of the code path, not discipline.
It stores a projection (head SHA, timestamp, risk level, `what`) rather than the
whole brief, because storing every brief per commit makes the table grow without
bound on a long-lived PR.

## The degraded matrix

| Condition | Model calls | `status` | `degraded_reason` |
| --- | --- | --- | --- |
| `index.status === 'degraded'` | 0 | `degraded` | `index_degraded` |
| No clone on disk / unreadable HEAD | 0 | `degraded` | `clone_unavailable` |
| PR has no changed files | 0 | `degraded` | `no_files` |
| Provider threw, timed out, or could not be repaired | 1 (failed) | `degraded` | `model_failed` |
| Everything grounded away | 1 | `ok` | `null` — empty lists plus the counts |
| `index.status === 'partial'` | 1 | `ok` | `null` — the prompt tells the model to say so |

A degraded brief carries EMPTY prose on purpose.
Everything it can honestly say is in `degraded_reason`, which is an enum the
client renders through next-intl; a sentence composed on the server could not be
translated, the same reasoning `BlastIndexReason` already follows.

## Staleness is derived on read, from BOTH shas

There is no `stale` column.
A brief rots when the PR moves (`head_sha`) **and** equally when the repository
is re-indexed underneath it (`indexed_sha`), and one stored flag could not catch
the second.
Nothing ever regenerates automatically: a stale brief renders its full contents
beneath a badge, and regeneration is always an explicit click.

## The prompt ceiling bounds assembly, not spend

`PROMPT_TOKEN_CEILING = 8_000` is measured with **our** tokenizer over the text
**we** build.
It does not bound the invoice — a measured-versus-billed ratio of 5.0x was
recorded on this codebase (see `server/INSIGHTS.md`).
Read `res.tokensIn` / `res.costUsd` off the provider result for anything that
claims to be spend; the one log line this module emits does exactly that.

The budget ladder drops blocks in a **fixed** order — prior PRs, then the caller
digest, then spec excerpts, then the file map — because "which fact does the
reviewer lose first" is a product decision, not an optimisation.
`changed_files` is never dropped: without it there is no path the model may cite
and the answer could only be ungroundable.

## Files

| File | What it is |
| --- | --- |
| `constants.ts` | Every ceiling from the spec's NFR table, and nothing derived at a call site |
| `types.ts` | The module-local vocabulary. `CandidateSets` has no line field, deliberately |
| `schemas.ts` | The flat structured-output schema + `BRIEF_SCHEMA_NAME`, which is what identifies the call in a log |
| `candidates.ts` | Pure. The membership sets. Takes caller PATHS, never callers |
| `ground.ts` | Pure. The rejection gate and the drop counters |
| `history.ts` | Pure. Ranks prior overlapping PRs by overlap size, then recency |
| `prompt.ts` | Pure. `DATA_GUARD`, `wrapUntrusted` on every third-party block, the budget ladder |
| `repository.ts` | The only owner of `pr_brief` and `pr_brief_history`. No update, no delete on the latter |
| `service.ts` | The use case: tenancy, single-flight, facts, gates, the one call, grounding, one transaction |
| `routes.ts` | Transport only. `GET`/`POST /pulls/:id/brief`, both nullable, POST at 10/min |

## Things that are deliberately NOT here

- **The blast radius.** `GET /pulls/:id/blast` serves it; the brief carries only
  `index`, so the card can state its own trustworthiness without a second fetch.
  A second copy on the wire would be a fourth blast shape.
- **The intent.** `GET /pulls/:id/intent` serves it, and the Intent card keeps
  its quote, scope columns, confidence badge and missing-context notice.
- **Endpoint and job lists.** The model is asked for them so it can cite the
  reach it was shown, and they are grounded and counted — but none reaches the
  response, because the blast card already lists them authoritatively.
- **An `agent_runs` row.** The brief is not an agent run: one would inflate
  `/pulls/:id/runs`, the run history UI and `total_cost_usd`.
- **`PrBrief` in `contracts/brief.ts`.** Untouched and still unused. The brief's
  contract is the new `contracts/pr-brief.ts`, in both vendored copies.
