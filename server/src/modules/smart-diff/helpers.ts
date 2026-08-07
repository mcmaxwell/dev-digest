import type { FindingRow } from '../../db/rows.js';

/**
 * Pure transforms over what `container.reviewRepo` returns. They live here
 * rather than in `service.ts` so the module's only Container-aware file stays
 * free of logic, matching every sibling module (intent, reviews, skills, …)
 * and letting `test/smart-diff.test.ts` cover them without Postgres.
 */

/** One review row plus its findings, as `reviewRepo.reviewsForPull` returns them. */
export type ReviewWithFindings = {
  review: { runId: string | null; kind: string };
  findings: FindingRow[];
};

/**
 * The findings of the LATEST review only — an older run's findings describe an
 * older head and would mark lines the reviewer already dealt with.
 *
 * `reviewsForPull` is newest-first. When the newest review belongs to an
 * `agent_run` we keep every review from that same run, so a future multi-agent
 * run (L07) contributes all of its agents' findings rather than one agent's.
 * A review with no `run_id` predates run tracking (the seeded review is one),
 * and stands alone.
 */
export function latestReviewFindings(rows: readonly ReviewWithFindings[]): FindingRow[] {
  const reviews = rows.filter((r) => r.review.kind === 'review');
  const newest = reviews[0];
  if (!newest) return [];
  const inLatest = newest.review.runId
    ? reviews.filter((r) => r.review.runId === newest.review.runId)
    : [newest];
  return inLatest.flatMap((r) => r.findings);
}

/**
 * Findings → `path → line numbers`, keyed by the finding's `start_line`. It is
 * derived from the FINDING, never from the patch, so files whose `pr_files.patch`
 * is null (imported before the diff was fetched) still report their flagged
 * lines and still sort to the top of their group.
 *
 * Dismissed findings are excluded: the user has ruled on them, and letting one
 * keep a file expanded would make dismissing a finding feel like it did nothing.
 * Accepted findings stay — an accepted finding is work still to be done.
 */
export function findingLinesByPath(findings: readonly FindingRow[]): Map<string, number[]> {
  const byPath = new Map<string, number[]>();
  for (const f of findings) {
    if (f.dismissedAt) continue;
    const list = byPath.get(f.file);
    if (list) list.push(f.startLine);
    else byPath.set(f.file, [f.startLine]);
  }
  return byPath;
}
