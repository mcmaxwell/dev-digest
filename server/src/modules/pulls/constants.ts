/**
 * Diff stats are absent from GitHub's PR-LIST payload, so freshly-imported PRs
 * land with zeroed size. We backfill them from the per-PR detail endpoint, but
 * each backfill is its own HTTP call — cap how many one list request pays for
 * and let the periodic refetch chip away at the remainder.
 */
export const DIFF_STAT_BACKFILL_LIMIT = 10;
