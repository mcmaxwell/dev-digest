import type { SeverityCounts } from '@devdigest/shared';

/** L10 — score computation. Pure: counts + churn in, 0..100 out. */

const WEIGHT = { critical: 12, warning: 4, suggestion: 1 };
const CHURN_WEIGHT = 0.5;

export class HealthScorer {
  score(counts: SeverityCounts, churnFiles: number): number {
    const penalty =
      counts.critical * WEIGHT.critical +
      counts.warning * WEIGHT.warning +
      counts.suggestion * WEIGHT.suggestion +
      churnFiles * CHURN_WEIGHT;
    return Math.max(0, Math.min(100, Math.round(100 - penalty)));
  }
}
