/**
 * `deriveIndexState` — the whole derivation table.
 *
 * This suite IS the "an empty array must never be mistaken for a fact"
 * acceptance criterion: every way an index can be incomplete has to come back
 * with a status a reader can act on and a machine-readable reason, and the two
 * suppressing cases have to stay suppressing.
 */
import { describe, it, expect } from 'vitest';
import { deriveIndexState } from '../src/modules/blast/status.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { IndexHealth } from '../src/modules/repo-intel/types.js';

const HEALTHY: IndexHealth = {
  enabled: true,
  present: true,
  status: 'full',
  indexerVersion: INDEXER_VERSION,
  lastIndexedSha: 'abc123',
  updatedAt: new Date('2026-08-10T10:00:00.000Z'),
  softBudgetReached: false,
  graphFailed: null,
  parseDegradedCount: 0,
  ranked: 120,
  edgesWritten: 300,
  factsWritten: 12,
};

function health(over: Partial<IndexHealth> = {}): IndexHealth {
  return { ...HEALTHY, ...over };
}

describe('deriveIndexState', () => {
  const table: Array<[string, Partial<IndexHealth>, string, string]> = [
    ['a clean full index', {}, 'ok', 'none'],
    ['repo-intel switched off entirely', { enabled: false }, 'degraded', 'flag_off'],
    ['a repo that was never indexed', { present: false }, 'degraded', 'not_indexed'],
    ['a failed index', { status: 'failed' }, 'degraded', 'index_failed'],
    ['an index the indexer marked degraded', { status: 'degraded' }, 'degraded', 'index_degraded'],
    [
      'an index built by an older extractor',
      { indexerVersion: INDEXER_VERSION - 1 },
      'partial',
      'stale_indexer',
    ],
    ['an index with no file_rank rows', { ranked: 0 }, 'partial', 'no_rank'],
    ['an index that hit the soft budget', { softBudgetReached: true }, 'partial', 'soft_budget'],
    ['an index whose graph build failed', { graphFailed: 'boom' }, 'partial', 'graph_failed'],
    ['an index with per-file parse errors', { parseDegradedCount: 3 }, 'partial', 'parse_errors'],
    ['a partial index with no other signal', { status: 'partial' }, 'partial', 'index_partial'],
  ];

  for (const [name, over, status, reason] of table) {
    it(`${name} → ${status} / ${reason}`, () => {
      const state = deriveIndexState(health(over));
      expect(state.status).toBe(status);
      expect(state.reason).toBe(reason);
    });
  }

  it('reports no_rank BEFORE the generic index_partial', () => {
    // Both conditions hold. `no_rank` is the one that explains why the caller
    // list is empty, so it must win — a plain "partial" loses that.
    const state = deriveIndexState(health({ status: 'partial', ranked: 0 }));
    expect(state.reason).toBe('no_rank');
  });

  it('surfaces which artifacts exist, independently of the status', () => {
    const state = deriveIndexState(health({ ranked: 0, factsWritten: 0, edgesWritten: 5 }));
    expect(state).toMatchObject({ ranked: false, facts: false, graph: true });
  });

  it('carries the indexed sha and timestamp — caller lines are only valid there', () => {
    const state = deriveIndexState(health());
    expect(state.last_indexed_sha).toBe('abc123');
    expect(state.indexed_at).toBe('2026-08-10T10:00:00.000Z');
  });

  it('never invents a sha or a timestamp for an unindexed repo', () => {
    const state = deriveIndexState(health({ present: false, lastIndexedSha: '', updatedAt: null }));
    expect(state.last_indexed_sha).toBe('');
    expect(state.indexed_at).toBe('');
  });
});
