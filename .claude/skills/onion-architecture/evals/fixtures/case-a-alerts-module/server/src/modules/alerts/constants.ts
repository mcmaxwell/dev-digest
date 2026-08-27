import type { Severity } from '@devdigest/shared';

/** L09 — alerts module literals. */

/** JobRunner kind for the asynchronous delivery job. */
export const ALERT_JOB_KIND = 'alert-deliver';

/** Secret holding the GitHub PAT used to post the alert. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/** Ranking used to decide whether a closed review trips a rule. */
export const SEVERITY_RANK: Record<Severity, number> = {
  SUGGESTION: 1,
  WARNING: 2,
  CRITICAL: 3,
};

/** Delivery posts are not idempotent, so the job never auto-retries. */
export const ALERT_JOB_OPTS = { retries: 0, timeoutMs: 30_000 };
