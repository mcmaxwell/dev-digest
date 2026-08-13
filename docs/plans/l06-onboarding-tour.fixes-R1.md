# Fixes R1: L06 Onboarding Tour

Round 1 of convergence on `docs/plans/l06-onboarding-tour.md`.

Source: the `architecture-reviewer` pass over commit `329cd7a`, run after `arch-evidence` cleared
all 21 mechanical probes, plus two observations the `test-writer` reported without asserting
because the spec does not fix the behaviour.

Nothing here is a boundary violation.
`pnpm arch:check` was clean before these fixes and must stay clean after them.
Every item below is a correctness or honesty defect that the mechanical layer cannot see.

## F1 - The single-flight guard has a TOCTOU race

**Severity: major. Breaks AC-16 under concurrency.**

- Where: `server/src/modules/onboarding/service.ts:173-189`
- What is wrong: the `inFlight.has(repoId)` check and the `inFlight.set(repoId, slot)` are adjacent
  with no `await` between them, so that pair is atomic.
  But `requireRepo(workspaceId, repoId)` (a DB read) and `currentHeadOrNull(ref)` (a git call) are
  both awaited BEFORE the check.
  Fastify interleaves concurrent requests on the event loop, so two `POST /generate` calls arriving
  close together - a double click before the button disables, two open tabs - can both complete
  their DB and git reads, both observe an empty slot, and both enqueue.
  Two generations, two model calls, one repository.
  The module's own doc comment at `service.ts:92-98` claims this cannot happen.
- Fix: claim the slot on `repoId` before any I/O, then do the repository and clone resolution
  inside the claim, releasing the slot on every early-exit path (repository not found, clone
  absent, `enqueue` throwing) as well as on completion.
  The existing release on `enqueue` failure at `service.ts:205-209` is correct and stays.
- Do not: move to a DB-level guard.
  That needs a `running` row, which needs a boot reaper (`server/INSIGHTS.md:51-61`).
  The in-memory, per-process guard dying with the process is the correct behaviour for an
  in-flight lock, and the review confirmed the restart path is already right.
- Verify: an integration case where two `POST .../generate` requests are issued without awaiting
  the first, asserting exactly one `completeStructured` call and one 409.

## F2 - `usedGraph` mislabels the exact case the no-graph fallback exists for

**Severity: major. Breaks AC-57 and AC-58, and makes the tour state something untrue.**

- Where: `server/src/modules/onboarding/service.ts:420`, `const usedGraph = topFiles.length > 0;`
- What is wrong: `computeFileRank` gives edge-less files PageRank's uniform floor rather than
  returning nothing (`server/src/modules/repo-intel/pipeline/rank.ts:23-24`), while
  `getCriticalPaths` returns `[]` as soon as `edges.length === 0`.
  So a repository with a file rank but zero dependency edges - the import graph genuinely
  unavailable - still has `topFiles.length > 0`, `usedGraph` reads `true`, and
  `sectionStatus` (`verify.ts:74`) never returns `'no_graph'`.
  Two things then go wrong on the page: Critical paths renders `'empty'`, which reads as "we
  looked and found nothing" rather than "there is no import graph"; and the reading path's
  skeleton text (`skeleton.ts:100`) tells the reader its entries were "Ranked highly by the
  repository's PageRank-derived file rank" when every rank is the same floor value.
- Fix: derive the graph signal from whether dependency edges exist, not from whether ranked files
  exist. Compute it per section rather than as one shared boolean, since the two sections depend
  on the graph differently: the reading path needs a meaningful RANKING, the critical paths need
  EDGES. A repo with real rank variance but no edges should mark critical paths `no_graph` while
  the reading path stays `ok`.
- Verify: a unit case over a rank set with no chains, asserting `no_graph` on critical paths; and
  an integration case with a `repoIntel` override returning ranked files but empty
  `getCriticalPaths`.

## F3 - The duplicated junk-path denylist is materially narrower than the original

**Severity: should-fix. Lets test files and configs into the tour on the no-graph path.**

- Where: `server/src/modules/onboarding/constants.ts:163-173`, `HEURISTIC_EXCLUDE_PATTERNS`
- What is wrong: the list carries `node_modules/`, `vendor/`, `third_party/`, `dist/`, `build/`,
  `.min.`, `.lock`, `fixtures/`, `__snapshots__/`.
  `isJunkPath` in `repo-intel/service.ts` also excludes test files, `tsconfig`/`eslint`/`jest`/
  `vitest` configs, `.d.ts` and `/migrations/` - none of which appear here.
  The graph-having path is filtered twice (index-time `EXCLUDED_DIRS`, read-time `isJunkPath`);
  the no-graph path is filtered by neither, only by this narrower hand-rolled list.
  So on an unindexed repository a `*.test.ts`, a `tsconfig.json`, a `jest.config.js` or a `.d.ts`
  can be scored "prominent" and shown to a newcomer as a critical path or a first file to read.
  `.lock` also misses `pnpm-lock.yaml` and `package-lock.json`, which sit at root depth and so
  take no depth penalty (reported by `test-writer`).
- Fix: `server/src/modules/repo-intel/constants.ts` is on the `no-cross-module-imports` exempt
  list, so the shared knowledge can be imported rather than re-typed.
  Move the junk patterns that both modules need into that file (or a sibling `types.ts` export)
  and consume them here, keeping only genuinely onboarding-specific additions local.
  Whatever is left local must at minimum cover the four gaps above and the two lockfile names.
- Do not: import `isJunkPath` itself from `repo-intel/service.ts` - that file is not exempt and
  `arch:check` will reject it.

## F4 - The 200-path probe budget is order-dependent and can drop real citations

**Severity: should-fix. Can violate AC-24 and AC-25 on verbose model output.**

- Where: `server/src/modules/onboarding/service.ts:544-557` (`probePaths`, capped at
  `MAX_PATH_PROBES = 200`) fed by `verify.ts:172-189` (`collectDraftPaths`)
- What is wrong: `collectDraftPaths` walks the draft in schema order and, within each section,
  visits links, then UNBOUNDED prose, then items.
  `body` has no length cap in `schemas.ts:41`.
  So a verbose architecture or critical-paths body full of inline-code file mentions - not
  necessarily adversarial, just chatty Markdown - can exhaust the 200 slots before
  `run_locally.items[].source` or `first_tasks.path` are ever probed.
  Those real, bounded, schema-capped citations then fail `exists()` by default, get dropped, and
  are counted in `dropped_steps` / `dropped_rows` - indistinguishable from a hallucinated path.
  It fails safe (nothing is over-linked) but it under-delivers real content non-deterministically.
- Fix: probe the bounded fields first. Collect item paths and link paths from all five sections
  before any prose-derived candidate, so the schema-capped citations can never be starved by
  prose. Optionally give prose its own smaller sub-budget from the remainder.
- Verify: a unit case where prose names more than 200 distinct paths and a `run_locally` step's
  `source` still resolves.

## F5 - `collectFacts` breaks the invariant its own doc comment states

**Severity: major. A job-time clone failure persists nothing at all.**

- Where: `server/src/modules/onboarding/service.ts:391`,
  `const headSha = await this.container.git.currentHead(ref);`
- What is wrong: the doc comment at `service.ts:378-384` states "Nothing here can fail a
  generation", and every other read in `collectFacts` is guarded.
  This one is not, and `generate()` calls `collectFacts` OUTSIDE the `try` that catches model
  failures (`service.ts:221-226`, `247-324`), and the job handler
  (`service.ts:117-126`) does not wrap it either.
  `requestGeneration` does check the clone before enqueueing, but the job runs LATER, on a queue:
  by the time `generate()` re-reads `currentHead`, the clone can be mid-resync or removed.
  If it throws, the job fails, the upsert is never reached, and no degraded tour is persisted -
  contrary to what the module promises and what AC-60/AC-61 require of a failed generation.
  AC-63's literal "no error page" still holds only because the read path returns whatever was
  stored before.
- Fix: bring `collectFacts` inside the same failure path as the model call, so a throw there also
  persists a degraded skeleton with a reason.
  A clone that has gone away needs its own reason rather than being reported as `model_failed`,
  which would be a lie; add one to `OnboardingDegradedReason` in BOTH `vendor/shared` copies if
  none of the existing five fits.
- Verify: an integration case where the git port throws on `currentHead` at job time, asserting a
  persisted degraded tour with an honest reason and a readable page after reload.

## F6 - The heuristic's depth penalty can invert directory prominence

**Severity: nit. Reported by `test-writer`, not spec-mandated.**

- Where: `server/src/modules/onboarding/candidates.ts:128-141`,
  `dirCount + (entryPoint ? 500 : 0) - depth * 5`
- What is wrong: with 5 files under `src/` at depth 2 and 1 file under `scripts/` at depth 1,
  `scripts/one-off.sh` scores -4 and `src/routes/public.ts` scores -5, so the sparse shallow file
  wins.
  AC-57 names "directory prominence and entry-point heuristics" and says nothing about depth.
  Exposure is small repositories and repositories with many root-level files.
- Fix: make the depth term a tie-breaker rather than a term that can overturn prominence - scale
  it below the smallest prominence difference, or apply it only within an equal-prominence group.
- Verify: the `candidates.test.ts` case that currently compares prominence only at equal depth can
  then compare across depths.

## What is confirmed sound - do not change it

The review checked these and found them right.
Changing them would be a regression.

- `AppError('generation_in_progress', ..., 409)` rather than a new `ConflictError` class.
  `server/src/platform/errors.ts` has no such class and `conventions/service.ts:118` already uses
  exactly this shape for the same "one in flight per repo" situation.
- Both platform edits. `jobs.ts`'s per-kind `retries` mirrors the pre-existing `timeoutMs`
  mechanism and is generic; `prompt-log.ts`'s `call` union gains one literal to an
  already-parameterised union. Neither leaks an onboarding-shaped concept into the platform layer.
- The pure/impure split in verification. Pre-resolving paths in the service and handing
  `verifyDraft` a synchronous `exists` is what keeps the verifier testable without I/O.
  Only the ORDER of collection is wrong (F4), not the shape.
- The in-memory, per-process single-flight guard. Its death on restart is correct behaviour, and
  the release on `enqueue` failure is already right. Only the claim POINT is wrong (F1).
- `repository.ts`'s documented tenancy note. `onboarding` has no `workspace_id` and the service
  resolves the repository workspace-scoped first, which is the pattern
  `server/INSIGHTS.md:226-232` requires be written down.

## Non-negotiable

- `pnpm arch:check` stays clean. Never widen a dependency-cruiser rule or add an allowlist entry.
- A contract change lands in BOTH `vendor/shared` copies in one step (F5 may need one).
- Every existing test stays green: 391 server unit, 87 integration, 167 client, 12/12 e2e.
- New tests for F1, F2, F4 and F5 come from the acceptance criteria named above, not from the
  fixed code.
