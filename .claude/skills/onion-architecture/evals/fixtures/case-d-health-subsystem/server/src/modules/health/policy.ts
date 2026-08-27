import type { HealthScore } from '@devdigest/shared';

/** L10 — the gate other features ask before acting on a health score. */

const BLOCK_BELOW = 40;
const WARN_BELOW = 70;

export type HealthVerdict = 'ok' | 'warn' | 'block';

export class HealthPolicy {
  verdict(health: HealthScore): HealthVerdict {
    if (health.score < BLOCK_BELOW) return 'block';
    if (health.score < WARN_BELOW) return 'warn';
    return 'ok';
  }

  /** Whether a PR may be auto-approved given the repo's current health. */
  allowsAutoApprove(health: HealthScore): boolean {
    return this.verdict(health) === 'ok' && health.counts.critical === 0;
  }
}
