import type { BlastIndexState } from '@devdigest/shared';
import { INDEXER_VERSION } from '../repo-intel/constants.js';
import type { IndexHealth } from '../repo-intel/types.js';

/**
 * PURE: `IndexHealth` -> the `index` block of the blast response.
 *
 * This function is the whole "an empty array must not be mistaken for a fact"
 * requirement. Every state the index can be in maps to exactly one
 * (status, reason) pair, and the client renders a translated sentence from the
 * reason - the server never composes an English one.
 *
 * It reads `IndexHealth`, NEVER `BlastResult.degraded`. That flag records which
 * BRANCH of the facade ran, which is a fact about our code, not about the data:
 * the persistent branch can return an empty result from a half-built index and
 * still report `degraded: false`.
 *
 * ORDER MATTERS, and the first three cases are the only ones that suppress the
 * read entirely:
 *
 *   !enabled                          degraded / flag_off
 *   !present                          degraded / not_indexed
 *   status 'failed'                   degraded / index_failed
 *   status 'degraded'                 degraded / index_degraded
 *   indexerVersion < INDEXER_VERSION  partial  / stale_indexer
 *   ranked === 0                      partial  / no_rank
 *   softBudgetReached                 partial  / soft_budget
 *   graphFailed                       partial  / graph_failed
 *   parseDegradedCount > 0            partial  / parse_errors
 *   status 'partial'                  partial  / index_partial
 *   otherwise                         ok       / none
 *
 * `ranked === 0` is checked BEFORE the generic `index_partial` because it is the
 * precise case that used to return zero callers with no explanation: the caller
 * query joined `file_rank`, and an index that stopped before the rank step has
 * none. Reporting it as plain "partial" would lose the one detail that tells a
 * reader why the list is short.
 */
export function deriveIndexState(health: IndexHealth): BlastIndexState {
  const base = {
    ranked: health.ranked > 0,
    facts: health.factsWritten > 0,
    graph: health.edgesWritten > 0,
    last_indexed_sha: health.lastIndexedSha,
    indexed_at: health.updatedAt ? health.updatedAt.toISOString() : '',
  };

  if (!health.enabled) return { ...base, status: 'degraded', reason: 'flag_off' };
  if (!health.present) return { ...base, status: 'degraded', reason: 'not_indexed' };
  if (health.status === 'failed') return { ...base, status: 'degraded', reason: 'index_failed' };
  if (health.status === 'degraded') {
    return { ...base, status: 'degraded', reason: 'index_degraded' };
  }
  if (health.indexerVersion < INDEXER_VERSION) {
    return { ...base, status: 'partial', reason: 'stale_indexer' };
  }
  if (health.ranked === 0) return { ...base, status: 'partial', reason: 'no_rank' };
  if (health.softBudgetReached) return { ...base, status: 'partial', reason: 'soft_budget' };
  if (health.graphFailed !== null) return { ...base, status: 'partial', reason: 'graph_failed' };
  if (health.parseDegradedCount > 0) {
    return { ...base, status: 'partial', reason: 'parse_errors' };
  }
  if (health.status === 'partial') return { ...base, status: 'partial', reason: 'index_partial' };
  return { ...base, status: 'ok', reason: 'none' };
}
