# `repo-intel` — the codebase indexer

`repo-intel` reads a cloned repository **once on clone** (and incrementally on
fetch, keyed by file content hash) and turns it into queryable facts: symbols,
the import graph, a PageRank-based file importance score, and a compact **repo
map** (the project skeleton). On a review it is only **read** — the index is
already computed, so adding context to a prompt costs no analysis at request time.

This is **starter infrastructure**: it works from day 1 (the **Indexed** badge),
but you don't write it. Course lessons build features _on top_ of its facade —
Blast Radius (L04), Conventions samples (L02), Onboarding reading-path (L05),
the Phantom-API gate (L06) — by calling `repoIntel.*`, not by re-indexing.

## Pipeline

```mermaid
flowchart LR
  CLONE["git clone / fetch"] --> WALK["walk.ts<br/>discover source files"]
  WALK --> AST["ast-grep adapter<br/>symbols + references"]
  AST --> EDGES["import graph<br/>(dependency-cruiser)"]
  EDGES --> RANK["rank.ts<br/>PageRank + git hotness → file rank"]
  RANK --> MAP["repo-map.ts<br/>compact repo skeleton (cached)"]
  AST --> DB[("Postgres<br/>symbols · references · file_edges · file_rank · repo_map_cache")]
  EDGES --> DB
  RANK --> DB
  MAP --> DB
```

Full vs incremental indexing lives in `pipeline/{full,incremental}.ts`; an
unindexed or partially-indexed repo degrades gracefully (the facade returns empty
results rather than throwing).

## Facade (`repoIntel.*`)

Everything downstream reads through one facade (`service.ts`) so consumers never
touch the pipeline internals:

- `getRepoMap(repoId)` → the cached repo skeleton (fed into the **review prompt**).
- `getFileRank(repoId, files)` → importance percentile per changed file.
- `getCallerSignatures(repoId, files, limit)` → callers of changed symbols.
- `getBlastRadius(repoId, files)` → impacted symbols / callers. USED, by
  `modules/blast` (L04): callers are capped per symbol in SQL
  (`getResolvedCallersTopN`), which `LEFT JOIN`s `file_rank` so a rank-less
  partial index still returns callers instead of silently returning none.
- `getIndexHealth(repoId)` → the honest projection of `repo_index_state` PLUS
  live counts of `file_rank` / `file_edges` / `file_facts`. Counted, not read
  from `stats`: the incremental pipeline rebuilds rank and facts without
  re-recording their counts, so a stats-derived `ranked` reads 0 after every
  refresh. `modules/blast/status.ts` turns this into the user-facing status.
- `getReverseImporters(repoId, files, depth)` → who imports the changed files,
  up to `depth` hops (one indexed query per level, provenance preserved). Feeds
  endpoint/cron attribution ONLY - an import edge is not proof of a call.
- `getFileFactsFor(repoId, files)` → precomputed endpoints/crons per file.
- `getUnresolvedReferences(repoId, …)` → phantom-symbol detection (used by L06).
- `getConventionSamples(repoId)` → top-ranked files for convention extraction (L02).

`getRepoMap` / `getFileRank` / `getCallerSignatures` are wired into
`modules/reviews/run-executor.ts`, which adds the repo map and a
high-blast-radius note to the prompt. The last four are wired into
`modules/blast` (`GET /pulls/:id/blast`). Toggled by `REPO_INTEL_ENABLED`
(global) and a per-agent `repo_intel` flag; with the flag off `getIndexHealth`
reports `enabled: false` and the blast route returns an honest empty envelope
rather than falling through to the clone-reading fallback.

## Routes

- `GET /repos/:id/index-state` — index status (drives the **Indexed** badge).
- `POST /repos/:id/resync` — enqueue a re-index.
