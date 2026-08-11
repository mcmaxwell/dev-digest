/**
 * "Each AGENT's latest review, unioned" - a local copy of the rule.
 *
 * THIS IS THE THIRD COPY. The canonical one is
 * `server/src/modules/smart-diff/helpers.ts:32` (`latestReviewFindings`), and
 * the client has its own. Importing the server's would mean aliasing into
 * `server/src/modules/`, and that file pulls `FindingRow` out of `db/rows.ts`,
 * i.e. Drizzle row types - precisely what this package exists not to touch.
 * The mitigation is `test/latest-reviews.test.ts`, whose cases are lifted from
 * `server/test/smart-diff.test.ts`, plus the note in INSIGHTS.md naming all
 * three files. If you change the rule, change it in all three.
 *
 * Grouping by RUN instead is wrong in the worst direction: running a review
 * over N agents creates N runs, so "the newest run" is one agent's verdict, and
 * when that agent happens to find nothing every other agent's findings vanish.
 */

export interface ReviewLike {
  id: string;
  agent_id?: string | null;
  kind: string;
}

/**
 * `rows` must be NEWEST FIRST - `GET /pulls/:id/reviews` orders by
 * `created_at DESC`, so the first row seen for an agent is its current verdict.
 * A review whose agent was deleted (`agent_id` null) counts as its own agent,
 * keyed by review id, so two of them are never collapsed into one.
 */
export function latestReviewPerAgent<T extends ReviewLike>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (row.kind !== 'review') continue;
    const key = row.agent_id ?? `review:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
