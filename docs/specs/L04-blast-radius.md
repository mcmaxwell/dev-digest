# L04 - Blast Radius + pre-push CLI

## Goal

A reviewer reading a diff sees what changed.
It does not see **what else that change can reach** - who calls the functions it edits, and which HTTP endpoints and scheduled jobs sit behind those callers.
Changed lines cannot answer that; only the relationships between symbols and files can.

The important part: **no model is needed for this.**
Every fact is already in the `repo-intel` index. The feature reads the index and presents it honestly, and the read costs nothing.

The second half moves that same review one step earlier: `devdigest review --mode working` runs a DevDigest agent over the uncommitted working tree, before `git push`.

## Scope

1. **`blast` server module** - `GET /pulls/:id/blast` (free, pure index read) and `POST /pulls/:id/blast/summary` (one explicit, optional LLM call).
   Owns the new `pr_blast_summary` table.
2. **An honest index status** - every way the index can be incomplete maps to one `(status, reason)` pair, and the client renders a translated sentence from the reason.
   An empty caller list must never be mistaken for "nothing calls this".
3. **Per-symbol caller caps, fixed at the source** - `getResolvedCallersTopN` uses `row_number() OVER (PARTITION BY to_symbol …)` so one hot symbol cannot eat every slot, and `LEFT JOIN file_rank` so a rank-less partial index still returns callers.
4. **A two-level reverse import walk** - `routes -> service -> repository`: when the PR changes `repository.ts`, the endpoint in `routes.ts` never names the changed symbol, so depth-1 callers cannot find it. The walk feeds endpoints and crons only; an import edge is not proof of a call.
5. **Blast Radius card** - on the PR Overview tab, under the Intent card. Four stat chips, a tree of changed symbols with their callers, a lazily-loaded mermaid graph, and the optional impact summary.
6. **`get_blast_radius` MCP tool** - the L04 stub is replaced by a real implementation with a grouped output schema and an `index_status` that replaces the old `degraded: boolean`.
7. **`devdigest review --mode working`** - a second binary in `mcp/`, reviewing the working tree through a new `POST /reviews/diff`.

Out of scope: indexing the PR's own branch (so symbols the PR ADDS stay invisible), symbol-level endpoint attribution (the import graph is a graph of files), the `staged` and `branch` CLI modes (they parse and exit 3 with a sentence), and any persistence for the PR-less review.

## Data flow

`GET /pulls/:id/blast` → `BlastService.load` resolves the PR **workspace-scoped first** → `repoIntel.getIndexHealth` (index row + live counts of `file_rank` / `file_edges` / `file_facts`) → `deriveIndexState` →
**hard gate**: a `degraded` status returns an honest empty envelope WITHOUT calling `getBlastRadius`, because that facade's fallback branch reads the clone and shells out to ripgrep →
changed files come from `reviewRepo.getPrFiles` (one indexed SELECT; not `PullsService.detail`, which calls GitHub, and not `loadDiff`, which runs a real `git diff`) →
`getBlastRadius` + `getReverseImporters` in parallel → `getFileFactsFor` over every file either path reached → the pure `buildBlast` groups, caps per symbol, and unions endpoints/crons → `PrBlastResponse`.

`POST /pulls/:id/blast/summary` reuses that load, refuses (409) when there is nothing to summarise, and feeds a **digest only** - symbols, caller counts, a few paths, endpoints, crons, one line about index completeness. Never a diff, never file contents. The result is clamped to 400 characters and stored in `pr_blast_summary`.

`devdigest review` → `git rev-parse --show-toplevel` → `git diff HEAD --no-color --no-ext-diff -U3` (via `execFile`, never a shell) → untracked files listed and EXCLUDED → `POST /reviews/diff` → `reviewPullRequest` from `reviewer-core` → grounded findings back → exit code.

## Acceptance criteria

1. The card appears on Overview beside Intent, with non-zero chips on an indexed repo.
2. An endpoint reachable only through a **depth-2** import edge is attributed to the changed symbol.
3. A cap of 20 callers applies **per symbol**: 21 callers of `A` and 5 of `B` yield 20 + 5, never 20 in total.
4. An index with no `file_rank` still returns callers, reported as `partial / no_rank`.
5. Deleting `repo_index_state` yields a 200 with `not_indexed` and a working Re-analyze CTA - never a spinner, never four zeroes, and never a clone read (proven by a spy in `blast.it.test.ts`).
6. Clicking a `file:line` opens GitHub at the **indexed** commit, not the PR head. With no repo full name it renders as text, never as an inert button.
7. `PrBlastResponse` parses with the CLIENT's copy of the contract (asserted in the server's integration test, so drift fails there).
8. The MCP `tools/list` payload stays under the 2200-token warn band.
9. `devdigest review` exits 0 / 1 / 2 / 3 / 4 as documented in `--help`, names excluded untracked files on stderr, and never sends an untracked file.

## Non-obvious decisions

- **`ranked` / `facts` / `graph` are COUNTED from the tables, not read from `repo_index_state.stats`.** The incremental pipeline rebuilds rank and facts without re-recording their counts, so a stats-derived `ranked` reads 0 after every "Re-analyze" on a perfectly ranked repo.
- **`no_rank` is checked before the generic `index_partial`.** It is exactly the case where the old `INNER JOIN file_rank` returned silence, and reporting it as plain "partial" loses the one detail that explains the short list.
- **The declaring file's own facts count.** A PR editing the handler inside `routes.ts` affects the endpoint declared in that same file; reporting "no endpoints" there would be plainly wrong.
- **The degraded gate lives in the SERVICE, not the route** - L02's lesson about state guards, and here it is also the mechanism that keeps a request off the clone.
- **Nothing is persisted for `POST /reviews/diff`.** `reviews.pr_id` is `notNull`; an `agent_runs` row with a null `pr_id` would be invisible in the UI while inflating cost rollups.
- **Slug resolution stays in `mcp/src/format/slug.ts`.** The database has no slug column, so the server accepts an id or an exact name and the CLI resolves the slug before calling.
