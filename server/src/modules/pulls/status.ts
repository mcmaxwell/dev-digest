import type { PrStatus } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 *
 * `rollupSeverities` used to live here too; it moved to `_shared/severity.ts`
 * because the reviews module needs it as well.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

/**
 * PR-list SCORE: take each agent's LATEST review, return the WORST (lowest)
 * score per PR — a failing Security review must not be hidden behind a later
 * clean run from another agent. `rows` MUST be newest-first (the route orders
 * by created_at desc). A review whose agent was deleted (agentId null) still
 * counts as its own "agent" (keyed by review id). Latest reviews without a
 * score are skipped; a PR whose latest reviews are all score-less maps to null
 * (reviewed, no score) — PRs with no reviews are absent from the map.
 */
export function worstLatestScoreByPr(
  rows: { id: string; prId: string; agentId: string | null; score: number | null }[],
): Map<string, number | null> {
  const seenAgents = new Map<string, Set<string>>();
  const worst = new Map<string, number | null>();
  for (const rv of rows) {
    const agentKey = rv.agentId ?? `review:${rv.id}`;
    let seen = seenAgents.get(rv.prId);
    if (!seen) {
      seen = new Set();
      seenAgents.set(rv.prId, seen);
    }
    if (seen.has(agentKey)) continue; // an older review of this agent — superseded
    seen.add(agentKey);
    const current = worst.get(rv.prId);
    if (rv.score == null) {
      if (!worst.has(rv.prId)) worst.set(rv.prId, null);
    } else {
      worst.set(rv.prId, current == null ? rv.score : Math.min(current, rv.score));
    }
  }
  return worst;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}
