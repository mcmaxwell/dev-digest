import type { SeverityCounts } from '@devdigest/shared';

/**
 * Shared severity rollup — pure, no DB. Lives in `_shared` because BOTH the
 * pulls module (PR-list FINDINGS badges) and the reviews module (per-run
 * breakdown in `repository/run.repo.ts`) need it; keeping it in either module
 * would force a cross-module import.
 */

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.critical += 1;
    else if (r.severity === 'WARNING') c.warning += 1;
    else if (r.severity === 'SUGGESTION') c.suggestion += 1;
  }
  return c;
}
