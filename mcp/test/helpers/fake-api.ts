import type { ApiClient } from '../../src/api/index.js';
import * as s from '../../src/api/schemas.js';
import agentsJson from '../fixtures/agents.json' with { type: 'json' };
import blastJson from '../fixtures/blast-482.json' with { type: 'json' };
import conventionsJson from '../fixtures/conventions.json' with { type: 'json' };
import prJson from '../fixtures/pr-482.json' with { type: 'json' };
import reposJson from '../fixtures/repos.json' with { type: 'json' };
import reviewsJson from '../fixtures/reviews.json' with { type: 'json' };
import runsJson from '../fixtures/runs.json' with { type: 'json' };

/**
 * The whole hermetic lane rests on `createServer({ api })` taking the HTTP
 * client as an argument: there is nothing to mock by module path, only an
 * object to hand over.
 *
 * The fixtures are parsed through the REAL `src/api/schemas.ts` parsers, so a
 * fake behaves exactly like the live client - including dropping every field
 * those parsers do not list. That is what makes the `system_prompt` leak test
 * meaningful rather than decorative: the fixture carries the canary, and the
 * only thing standing between it and a tool result is the production schema.
 *
 * HAND-WRITTEN, matching the server contracts in
 * `server/src/vendor/shared/contracts/` field for field. Re-capture them from a
 * live seeded stack (`curl localhost:3001/agents | jq`) when one is running.
 */

export const RAW_FIXTURES = {
  agents: agentsJson,
  blast: blastJson,
  repos: reposJson,
  pull: prJson,
  reviews: reviewsJson,
  runs: runsJson,
  conventions: conventionsJson,
};

export const fixtures = {
  agents: s.AgentList.parse(agentsJson),
  repos: s.RepoList.parse(reposJson),
  pull: s.PrDetail.parse(prJson),
  reviews: s.ReviewList.parse(reviewsJson),
  runs: s.RunSummaryList.parse(runsJson),
  conventions: s.ConventionsPage.parse(conventionsJson),
  blast: s.PrBlast.parse(blastJson),
};

export const REPO_FULL_NAME = 'acme/payments-api';
export const PR_NUMBER = 482;
export const PR_ID = fixtures.pull.id!;
export const SECURITY_RUN_ID = 'a2000000-4444-4b00-9000-000000000002';

/** Anything not overridden throws, so a test that reaches an endpoint it did
 *  not plan for fails loudly instead of silently returning `undefined`. */
function unexpected(method: string): never {
  throw new Error(`fakeApi: ${method} was not stubbed for this test`);
}

export function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
  const base: ApiClient = {
    listRepos: async () => fixtures.repos,
    listAgents: async () => fixtures.agents,
    pullByNumber: async () => fixtures.pull,
    startReview: async () => unexpected('startReview'),
    listRuns: async () => fixtures.runs,
    activeRuns: async () => [],
    reviewsForPull: async () => fixtures.reviews,
    conventions: async () => fixtures.conventions,
    blastRadius: async () => fixtures.blast,
    reviewDiff: async () => unexpected('reviewDiff'),
  };
  return { ...base, ...over };
}
