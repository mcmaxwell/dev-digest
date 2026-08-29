import type { PrHistoryItem } from '@devdigest/shared';
import { MAX_PRIOR_PRS } from './constants.js';
import type { PriorPullInput } from './types.js';

/**
 * L05 — prior pull requests of the same repository whose changed files overlap
 * this one's. PURE, and DETERMINISTIC: no model is involved, so this half of the
 * brief is trustworthy even when the model call fails entirely.
 *
 * RANKING. Overlap size first — the whole question is "who else has touched
 * this code" — then recency, then PR number, so the order is total and a
 * re-render can never reshuffle two equally-overlapping PRs.
 *
 * `merged_at` IS NOT A MERGE TIME. `pull_requests` stores `opened_at` and
 * `updated_at` and nothing else, so the field is filled with the most recent
 * activity timestamp available. `PrHistoryItem` is a shipped contract in
 * `contracts/brief.ts` which this feature must not edit (AC-53), so the honest
 * move is to say so here rather than to invent a column.
 *
 * `notes` stays EMPTY. It is the one free-text field on the item, nothing
 * deterministic fills it, and a sentence composed on the server could not be
 * translated anyway — the card renders the overlap count through next-intl.
 */
export function rankPriorPulls(
  priors: readonly PriorPullInput[],
  changedPaths: readonly string[],
  limit = MAX_PRIOR_PRS,
): PrHistoryItem[] {
  const changed = new Set(changedPaths);

  const scored = priors
    .map((prior) => ({
      prior,
      overlap: [...new Set(prior.paths)].filter((p) => changed.has(p)).sort(),
    }))
    .filter((row) => row.overlap.length > 0);

  scored.sort(
    (a, b) =>
      b.overlap.length - a.overlap.length ||
      time(b.prior.at) - time(a.prior.at) ||
      b.prior.number - a.prior.number,
  );

  return scored.slice(0, limit).map(({ prior, overlap }) => ({
    pr_number: prior.number,
    title: prior.title,
    merged_at: prior.at ? prior.at.toISOString() : '',
    author: prior.author,
    files_overlap: overlap,
    notes: '',
  }));
}

function time(at: Date | null): number {
  return at ? at.getTime() : 0;
}
