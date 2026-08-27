import type { HealthTrendPoint } from '@devdigest/shared';

/** L10 — trend shaping over a series of daily samples. */

export class HealthTrend {
  /** Collapse multiple samples per day to that day's worst score. */
  daily(points: HealthTrendPoint[]): HealthTrendPoint[] {
    const worst = new Map<string, number>();
    for (const p of points) {
      const seen = worst.get(p.day);
      if (seen === undefined || p.score < seen) worst.set(p.day, p.score);
    }
    return [...worst.entries()]
      .map(([day, score]) => ({ day, score }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  /** Percentage-point change between the first and last day in the window. */
  delta(points: HealthTrendPoint[]): number {
    if (points.length < 2) return 0;
    return points[points.length - 1]!.score - points[0]!.score;
  }
}
