import { describe, expect, it } from 'vitest';
import { latestReviewPerAgent } from '../src/rules/latest-reviews.js';

/**
 * The cases below are lifted from `server/test/smart-diff.test.ts` (the
 * `latestReviewFindings` describe block), only reshaped from the server's
 * `{ review, findings }` row to this package's flat `Review` DTO.
 *
 * They exist because this is the THIRD copy of the rule - canonical at
 * `server/src/modules/smart-diff/helpers.ts:32`, a second in the client, this
 * one here. Keeping the fixture identical is what makes a divergence show up
 * instead of quietly changing what an editor agent is told about a PR.
 */

let seq = 0;
const review = (agentId: string | null, kind = 'review', file = 'x.ts') => ({
  id: `rev-${seq++}`,
  agent_id: agentId,
  kind,
  file,
});

describe('latestReviewPerAgent', () => {
  it('supersedes an agent’s older review with its newest one', () => {
    const rows = [review('sec', 'review', 'new.ts'), review('sec', 'review', 'old.ts')];
    expect(latestReviewPerAgent(rows).map((r) => r.file)).toEqual(['new.ts']);
  });

  // The regression that made a reviewed PR show no marks at all: running N
  // agents creates N separate runs, so keying on the newest RUN threw away
  // every other agent's findings whenever the last one to finish found nothing.
  it('keeps every agent, so a later clean run cannot hide another agent', () => {
    const rows = [
      review('general', 'review', 'clean.ts'),
      review('security', 'review', 'auth.ts'),
      review('perf', 'review', 'query.ts'),
    ];
    expect(latestReviewPerAgent(rows).map((r) => r.file)).toEqual([
      'clean.ts',
      'auth.ts',
      'query.ts',
    ]);
  });

  it('treats a review whose agent was deleted as its own agent', () => {
    const rows = [review(null, 'review', 'a.ts'), review(null, 'review', 'b.ts')];
    // Two deleted-agent reviews are NOT the same agent, so neither is dropped.
    expect(latestReviewPerAgent(rows).map((r) => r.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('ignores summary rows', () => {
    const rows = [review('sec', 'summary', 'nope.ts'), review('sec', 'review', 'a.ts')];
    expect(latestReviewPerAgent(rows).map((r) => r.file)).toEqual(['a.ts']);
  });

  it('is empty when the PR has never been reviewed', () => {
    expect(latestReviewPerAgent([])).toEqual([]);
  });
});
