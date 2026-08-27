import type { AlertRule } from '@devdigest/shared';
import type { Severity, SeverityCounts } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { SEVERITY_RANK } from './constants.js';

/**
 * L09 — alerts pure helpers. Pure functions only — no I/O, no DB, no container.
 */

export type AlertRuleRow = typeof t.alertRules.$inferSelect;

export function toAlertRuleDto(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    repo_id: row.repoId,
    min_severity: row.minSeverity,
    channel: row.channel,
    last_fired_at: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
  };
}

/** True when the review's worst severity reaches the rule's threshold. */
export function tripsRule(worst: Severity, minSeverity: Severity): boolean {
  return SEVERITY_RANK[worst] >= SEVERITY_RANK[minSeverity];
}

/** The worst severity present in a rollup, or null when the review is clean. */
export function worstOf(counts: SeverityCounts): Severity | null {
  if (counts.critical > 0) return 'CRITICAL';
  if (counts.warning > 0) return 'WARNING';
  if (counts.suggestion > 0) return 'SUGGESTION';
  return null;
}

export function formatAlertBody(fullName: string, counts: SeverityCounts): string {
  return [
    `DevDigest review on ${fullName}`,
    `${counts.critical} critical · ${counts.warning} warning · ${counts.suggestion} suggestion`,
  ].join('\n');
}
