import type { PrDigest, SeverityCounts } from '@devdigest/shared';

/** L09 — digest pure helpers. */

export function toPrDigestDto(
  prId: string,
  reviewCount: number,
  counts: SeverityCounts,
  tunedCategories: string[],
): PrDigest {
  return {
    pr_id: prId,
    review_count: reviewCount,
    counts,
    tuned_categories: [...new Set(tunedCategories)].sort(),
  };
}
