/** L12 — publishing module literals. */

export const PUBLISH_JOB_KIND = 'publish-review';

/** Publishing a PR review is not idempotent, so the job never auto-retries. */
export const PUBLISH_JOB_OPTS = { retries: 0, timeoutMs: 45_000 };

/** How long a report link stays valid. */
export const REPORT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Key prefix for stored reports. */
export const REPORT_KEY_PREFIX = 'reviews';
