import type { Container } from '../../platform/container.js';
import type { PublishResult } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { REPORT_KEY_PREFIX } from './constants.js';

/** L12 — publishing helpers. */

export type PublishAttemptRow = typeof t.publishAttempts.$inferSelect;

/** Storage key for one review's report. */
export function reportKeyFor(repoId: string, reviewId: string): string {
  return `${REPORT_KEY_PREFIX}/${repoId}/${reviewId}.md`;
}

export function toPublishResultDto(row: PublishAttemptRow): PublishResult {
  return {
    review_id: row.reviewId,
    github_review_id: row.githubReviewId,
    report_key: row.reportKey,
  };
}

/**
 * Resolve the link shown in the PR body: the stored report when one exists,
 * otherwise null so the body renders without a link.
 */
export async function resolveReportLink(
  container: Container,
  reportKey: string | null,
): Promise<string | null> {
  if (!reportKey) return null;
  const store = await container.reportStore();
  const existing = await store.get(reportKey);
  return existing ? reportKey : null;
}
