/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  worstLatestScoreByPr,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';
import { rollupSeverities } from '../src/modules/_shared/severity.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe('worstLatestScoreByPr', () => {
  // Rows are newest-first, matching the route's ORDER BY created_at DESC.
  it('multi-agent: the worst latest score wins — a newer clean run does not mask a failing agent', () => {
    const scores = worstLatestScoreByPr([
      { id: 'r3', prId: 'pr1', agentId: 'perf', score: 90 }, // newest overall
      { id: 'r2', prId: 'pr1', agentId: 'sec', score: 38 },
      { id: 'r1', prId: 'pr1', agentId: 'general', score: 64 },
    ]);
    expect(scores.get('pr1')).toBe(38);
  });

  it("an agent's older reviews are superseded by its latest", () => {
    const scores = worstLatestScoreByPr([
      { id: 'r2', prId: 'pr1', agentId: 'sec', score: 85 }, // sec re-reviewed, now clean
      { id: 'r1', prId: 'pr1', agentId: 'sec', score: 10 }, // superseded — ignored
    ]);
    expect(scores.get('pr1')).toBe(85);
  });

  it('deleted-agent reviews (agentId null) each count as their own agent', () => {
    const scores = worstLatestScoreByPr([
      { id: 'r2', prId: 'pr1', agentId: null, score: 70 },
      { id: 'r1', prId: 'pr1', agentId: null, score: 30 }, // NOT superseded by r2
    ]);
    expect(scores.get('pr1')).toBe(30);
  });

  it('score-less latest reviews are skipped; all score-less → null; no reviews → absent', () => {
    const scores = worstLatestScoreByPr([
      { id: 'r2', prId: 'pr1', agentId: 'sec', score: null },
      { id: 'r1', prId: 'pr1', agentId: 'perf', score: 55 },
      { id: 'r3', prId: 'pr2', agentId: 'sec', score: null },
    ]);
    expect(scores.get('pr1')).toBe(55);
    expect(scores.get('pr2')).toBeNull(); // reviewed, but no score to show
    expect(scores.has('pr3')).toBe(false); // never reviewed
  });

  it('groups PRs independently', () => {
    const scores = worstLatestScoreByPr([
      { id: 'r2', prId: 'pr1', agentId: 'sec', score: 40 },
      { id: 'r1', prId: 'pr2', agentId: 'sec', score: 95 },
    ]);
    expect(scores.get('pr1')).toBe(40);
    expect(scores.get('pr2')).toBe(95);
  });
});
