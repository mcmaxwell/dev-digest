import { z } from 'zod';
import { BlastCaller, BlastRadius, DownstreamImpact } from './brief.js';

/**
 * L04 - Blast Radius: what else a PR can reach.
 *
 * A NEW file rather than an edit to `brief.ts`, per the barrel rule in
 * `index.ts` ("feature agents EXTEND with new files"). It borrows the
 * vocabulary that already exists there (`ChangedSymbol`, `BlastCaller`,
 * `DownstreamImpact`, `BlastRadius`) and adds only what the served view needs:
 * a rank per caller, truncation counters, and an honest statement about the
 * index the whole answer was read from.
 *
 * Because the barrel `export *`s BOTH files, nothing imported above may be
 * re-exported here - a duplicate export would be a build error in every
 * consumer.
 *
 * TWO HONESTIES THAT TRAVEL WITH THIS CONTRACT, and are surfaced in the UI:
 *
 *  1. Attribution is FILE-LEVEL. `endpoints_affected` / `crons_affected` are
 *     derived from the import graph, which is a graph of FILES, so two symbols
 *     declared in the same changed file get the same sets. Pretending otherwise
 *     would be invented precision.
 *  2. The index is built from the repo's DEFAULT BRANCH, not the PR head. A
 *     symbol the PR ADDS is therefore invisible here, and one it DELETES can
 *     still show callers. Fixing that needs per-branch indexing and is out of
 *     scope; `BlastIndexState.last_indexed_sha` is what lets a reader see it.
 */

// ---- Callers ---------------------------------------------------------------

/**
 * A caller, plus how important its file is (`file_rank.rank`, 0..1).
 *
 * `rank` stays on the wire even though the card only sorts by it: the MCP tool
 * advertises a `min_rank` parameter, and dropping the field would mean removing
 * a parameter from a schema whose every byte is already budgeted.
 *
 * `rank` is 0 - not absent - when the repo is indexed but unranked. That case
 * is reported as `BlastIndexState.status = 'partial'` / `reason = 'no_rank'`,
 * never as "this caller does not matter".
 */
export const RankedBlastCaller = BlastCaller.extend({
  rank: z.number().min(0).max(1),
});
export type RankedBlastCaller = z.infer<typeof RankedBlastCaller>;

/**
 * One changed symbol and everything known to sit downstream of it.
 *
 * The `*_total` fields are the counts BEFORE the per-symbol cap, so the UI can
 * say "showing 20 of 137" instead of silently truncating. `callers` is capped;
 * the endpoint/cron arrays are not (they are already unioned sets).
 */
export const BlastDownstream = DownstreamImpact.extend({
  callers: z.array(RankedBlastCaller),
  /** Callers found before the per-symbol cap was applied. */
  caller_total: z.number().int().min(0),
  endpoints_total: z.number().int().min(0),
  crons_total: z.number().int().min(0),
});
export type BlastDownstream = z.infer<typeof BlastDownstream>;

/**
 * The blast radius of one PR. A symbol with zero callers is KEPT: "nothing
 * known calls this" is a result, not an absence of one.
 */
export const PrBlastRadius = BlastRadius.extend({
  downstream: z.array(BlastDownstream),
});
export type PrBlastRadius = z.infer<typeof PrBlastRadius>;

// ---- Index health ----------------------------------------------------------

/**
 * How much of this answer can be trusted.
 *
 * `partial` is the case a boolean could not express, and the one that matters:
 * the index exists and returned rows, but a piece of it is missing, so an empty
 * `callers` array may mean "not indexed" rather than "nobody calls this".
 * `degraded` means we did not read the index at all and returned an empty
 * envelope on purpose.
 */
export const BlastIndexStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastIndexStatus = z.infer<typeof BlastIndexStatus>;

/**
 * WHY the status is what it is - an enum, never an English sentence. The client
 * maps it through next-intl, the same way `intent.status.*` already works; a
 * sentence composed on the server cannot be translated.
 */
export const BlastIndexReason = z.enum([
  /** status === 'ok'. */
  'none',
  /** Repo-intel is switched off for this deployment (operator opt-out). */
  'flag_off',
  /** No `repo_index_state` row at all - the repo was never analyzed. */
  'not_indexed',
  'index_failed',
  'index_degraded',
  /** Indexed by an older extractor; rank/graph data may predate the current shape. */
  'stale_indexer',
  /** Indexed, but `file_rank` is empty - callers come back unranked. */
  'no_rank',
  /** The indexer hit its soft time budget and skipped the rank/graph/facts block. */
  'soft_budget',
  'graph_failed',
  'parse_errors',
  'index_partial',
]);
export type BlastIndexReason = z.infer<typeof BlastIndexReason>;

/**
 * The projection of `repo_index_state` this feature needs, and the only place
 * the answer's trustworthiness is stated.
 *
 * `ranked` / `facts` / `graph` are separate booleans rather than one "quality"
 * score because they fail independently and explain different holes: no rank →
 * unordered callers, no facts → no endpoints, no graph → no depth-2 reach.
 */
export const BlastIndexState = z.object({
  status: BlastIndexStatus,
  reason: BlastIndexReason,
  /** `file_rank` has rows: callers are ordered by importance. */
  ranked: z.boolean(),
  /** `file_facts` was written: endpoints and crons are answerable. */
  facts: z.boolean(),
  /** `file_edges` has rows: the reverse walk to endpoints could run. */
  graph: z.boolean(),
  /** The commit the index was built from - the ONLY sha caller lines are valid at. */
  last_indexed_sha: z.string(),
  /** ISO timestamp, or '' when the repo was never indexed. */
  indexed_at: z.string(),
});
export type BlastIndexState = z.infer<typeof BlastIndexState>;

// ---- Optional LLM summary --------------------------------------------------

/**
 * The one-paragraph impact summary, produced only by an explicit
 * `POST /pulls/:id/blast/summary`. The GET never spends a token.
 *
 * `stale` is DERIVED on read against BOTH shas: a summary can rot because the
 * PR moved (`head_sha`) or because the repo was re-indexed under it
 * (`indexed_sha`). One column could not catch the second.
 */
export const BlastSummaryMeta = z.object({
  text: z.string(),
  provider: z.string(),
  model: z.string(),
  generated_at: z.string(),
  stale: z.boolean(),
});
export type BlastSummaryMeta = z.infer<typeof BlastSummaryMeta>;

// ---- The envelope ----------------------------------------------------------

/**
 * `GET /pulls/:id/blast` and `POST /pulls/:id/blast/summary` both return THIS.
 *
 * The POST returns the whole envelope rather than just the summary so the
 * client can `setQueryData` the complete cache entry in one tick - the same
 * trick `useDetectIntent` uses.
 */
export const PrBlastResponse = z.object({
  blast: PrBlastRadius,
  summary: BlastSummaryMeta.nullable(),
  index: BlastIndexState,
  /** How many changed files were considered (the denominator of "no symbols"). */
  changed_files: z.number().int().min(0),
  computed_at: z.string(),
});
export type PrBlastResponse = z.infer<typeof PrBlastResponse>;
