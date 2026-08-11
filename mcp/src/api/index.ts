import { request } from './http.js';
import * as s from './schemas.js';

/**
 * The PORT every tool handler talks to. `src/server.ts` takes one of these as
 * an argument and NOTHING constructs a real one except `src/index.ts`, which is
 * what lets the whole hermetic test lane hand over a plain object literal
 * instead of mocking a module path. The dependency-cruiser rule
 * `tools-go-through-the-api-port` keeps `src/tools/**` pointed at this file.
 */
export interface ApiClient {
  listRepos(): Promise<s.Repo[]>;
  listAgents(): Promise<s.Agent[]>;
  pullByNumber(repoId: string, prNumber: number): Promise<s.PrDetail>;
  startReview(prId: string, agentId: string): Promise<s.ReviewRunResponse>;
  listRuns(prId: string): Promise<s.RunSummary[]>;
  activeRuns(prId: string): Promise<s.ActiveRun[]>;
  reviewsForPull(prId: string): Promise<s.Review[]>;
  conventions(repoId: string): Promise<s.ConventionsPage>;
}

export interface ApiClientConfig {
  apiUrl: string;
  timeoutMs: number;
}

/**
 * `detailByNumber` can go out to GitHub for the diff on a cold import, which is
 * far slower than any other read here, so it gets its own ceiling instead of
 * dragging the default up for everyone.
 */
const PR_DETAIL_TIMEOUT_MS = 30_000;

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { apiUrl, timeoutMs } = config;
  return {
    listRepos: () => request(apiUrl, '/repos', s.RepoList, { timeoutMs }),
    listAgents: () => request(apiUrl, '/agents', s.AgentList, { timeoutMs }),
    pullByNumber: (repoId, prNumber) =>
      request(apiUrl, `/repos/${encodeURIComponent(repoId)}/pulls/${prNumber}`, s.PrDetail, {
        timeoutMs: PR_DETAIL_TIMEOUT_MS,
      }),
    startReview: (prId, agentId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/review`, s.ReviewRunResponse, {
        method: 'POST',
        body: { agentId },
        timeoutMs,
      }),
    listRuns: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/runs`, s.RunSummaryList, { timeoutMs }),
    activeRuns: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/runs/active`, s.ActiveRunList, {
        timeoutMs,
      }),
    reviewsForPull: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/reviews`, s.ReviewList, { timeoutMs }),
    conventions: (repoId) =>
      request(apiUrl, `/repos/${encodeURIComponent(repoId)}/conventions`, s.ConventionsPage, {
        timeoutMs,
      }),
  };
}

export { ApiError, ApiShapeError, ApiTimeoutError, ApiUnreachableError } from './http.js';
export {
  createResolvers,
  resolveAgentIn,
  resolveRepoIn,
  CACHE_TTL_MS,
  type AgentResolution,
  type RepoResolution,
  type Resolvers,
  type ResolverSources,
} from './resolve.js';
export type {
  ActiveRun,
  Agent,
  ConventionCandidate,
  ConventionEvidence,
  ConventionScan,
  ConventionStatus,
  ConventionsPage,
  PrDetail,
  Repo,
  Review,
  ReviewFinding,
  ReviewRunResponse,
  RunStatus,
  RunSummary,
  Severity,
  SeverityCounts,
} from './schemas.js';
