import { describe, expect, it } from 'vitest';
import { rankPriorPulls } from './history.js';
import { MAX_PRIOR_PRS } from './constants.js';
import type { PriorPullInput } from './types.js';

function prior(over: Partial<PriorPullInput> = {}): PriorPullInput {
  return {
    number: 1,
    title: 'Earlier change',
    author: 'octocat',
    at: new Date('2026-01-01T00:00:00.000Z'),
    paths: ['src/auth.ts'],
    ...over,
  };
}

describe('rankPriorPulls', () => {
  const changed = ['src/auth.ts', 'src/config.ts'];

  it('drops a prior PR that overlaps nothing', () => {
    expect(rankPriorPulls([prior({ paths: ['docs/README.md'] })], changed)).toEqual([]);
  });

  it('ranks by overlap size before recency', () => {
    const out = rankPriorPulls(
      [
        prior({ number: 9, at: new Date('2026-06-01T00:00:00.000Z'), paths: ['src/auth.ts'] }),
        prior({ number: 4, at: new Date('2026-01-01T00:00:00.000Z'), paths: changed }),
      ],
      changed,
    );
    expect(out.map((h) => h.pr_number)).toEqual([4, 9]);
  });

  it('breaks an overlap tie by recency, then by PR number', () => {
    const out = rankPriorPulls(
      [
        prior({ number: 2, at: new Date('2026-01-01T00:00:00.000Z') }),
        prior({ number: 7, at: new Date('2026-05-01T00:00:00.000Z') }),
        prior({ number: 8, at: new Date('2026-05-01T00:00:00.000Z') }),
      ],
      changed,
    );
    expect(out.map((h) => h.pr_number)).toEqual([8, 7, 2]);
  });

  it('caps at MAX_PRIOR_PRS', () => {
    const many = Array.from({ length: MAX_PRIOR_PRS + 4 }, (_v, i) => prior({ number: i + 1 }));
    expect(rankPriorPulls(many, changed)).toHaveLength(MAX_PRIOR_PRS);
  });

  it('reports each overlap once, sorted, even when the prior PR lists a path twice', () => {
    const out = rankPriorPulls(
      [prior({ paths: ['src/config.ts', 'src/auth.ts', 'src/auth.ts'] })],
      changed,
    );
    expect(out[0]!.files_overlap).toEqual(['src/auth.ts', 'src/config.ts']);
  });

  it('leaves notes empty and tolerates a PR with no timestamp', () => {
    const out = rankPriorPulls([prior({ at: null })], changed);
    expect(out[0]!.notes).toBe('');
    expect(out[0]!.merged_at).toBe('');
  });
});
