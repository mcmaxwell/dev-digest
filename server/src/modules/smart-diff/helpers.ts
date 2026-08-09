import type { FindingRow } from '../../db/rows.js';

/**
 * Pure transforms over what `container.reviewRepo` returns. They live here
 * rather than in `service.ts` so the module's only Container-aware file stays
 * free of logic, matching every sibling module (intent, reviews, skills, …)
 * and letting `test/smart-diff.test.ts` cover them without Postgres.
 */

/** One review row plus its findings, as `reviewRepo.reviewsForPull` returns them. */
export type ReviewWithFindings = {
  review: { id: string; agentId: string | null; kind: string };
  findings: FindingRow[];
};

/**
 * Each AGENT's latest review, unioned — the same rule `worstLatestScoreByPr`
 * applies to the PR list's score (`modules/pulls/status.ts`), and for the same
 * reason: a failing Security review must not be hidden behind a later clean run
 * from another agent.
 *
 * Grouping by RUN instead is wrong, and wrong in the worst direction. Running a
 * review over N agents creates N runs, each with its own review row, so "the
 * newest run" is one agent's verdict: when that agent happens to find nothing,
 * every other agent's findings vanish from the diff while the PR list still
 * counts them — a file quietly loses its marks and looks clean.
 *
 * `reviewsForPull` is newest-first, so the first row seen per agent is that
 * agent's current verdict and older ones are superseded. A review whose agent
 * was deleted (`agentId` null) counts as its own agent, keyed by review id.
 */
export function latestReviewFindings(rows: readonly ReviewWithFindings[]): FindingRow[] {
  const seenAgents = new Set<string>();
  const out: FindingRow[] = [];
  for (const row of rows) {
    if (row.review.kind !== 'review') continue;
    const agentKey = row.review.agentId ?? `review:${row.review.id}`;
    if (seenAgents.has(agentKey)) continue;
    seenAgents.add(agentKey);
    out.push(...row.findings);
  }
  return out;
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
