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
  blastRadius(prId: string): Promise<s.PrBlast>;
  /** POST /reviews/diff - the pre-push CLI's review of a working-tree diff. */
  reviewDiff(body: {
    diff: string;
    agent?: string;
    severity_min?: s.Severity;
    fail_on?: s.Severity;
    source: 'cli';
  }): Promise<s.DiffReview>;
}

export interface ApiClientConfig {
  apiUrl: string;
  timeoutMs: number;
  /** Program name for the one-line-per-call stderr log. Defaults to the MCP server. */
  label?: string;
}

/**
 * `detailByNumber` can go out to GitHub for the diff on a cold import, which is
 * far slower than any other read here, so it gets its own ceiling instead of
 * dragging the default up for everyone.
 */
const PR_DETAIL_TIMEOUT_MS = 30_000;

/**
 * A diff review is a real LLM call: 30 to 180 seconds is normal and a slow model
 * can go further. The ordinary 15s read timeout would abandon a review the user
 * has already been billed for, so this gets its own, generous ceiling.
 */
const REVIEW_DIFF_TIMEOUT_MS = 300_000;

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { apiUrl, timeoutMs, label } = config;
  return {
    listRepos: () => request(apiUrl, '/repos', s.RepoList, { timeoutMs, label }),
    listAgents: () => request(apiUrl, '/agents', s.AgentList, { timeoutMs, label }),
    pullByNumber: (repoId, prNumber) =>
      request(apiUrl, `/repos/${encodeURIComponent(repoId)}/pulls/${prNumber}`, s.PrDetail, {
        timeoutMs: PR_DETAIL_TIMEOUT_MS,
        label,
      }),
    startReview: (prId, agentId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/review`, s.ReviewRunResponse, {
        method: 'POST',
        body: { agentId },
        timeoutMs,
        label,
      }),
    listRuns: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/runs`, s.RunSummaryList, { timeoutMs, label }),
    activeRuns: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/runs/active`, s.ActiveRunList, {
        timeoutMs,
        label,
      }),
    reviewsForPull: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/reviews`, s.ReviewList, { timeoutMs, label }),
    conventions: (repoId) =>
      request(apiUrl, `/repos/${encodeURIComponent(repoId)}/conventions`, s.ConventionsPage, {
        timeoutMs,
        label,
      }),
    // A pure index read on the server - no model call, no clone - so the default
    // timeout is right; it is nothing like the cold-import PR detail read above.
    blastRadius: (prId) =>
      request(apiUrl, `/pulls/${encodeURIComponent(prId)}/blast`, s.PrBlast, { timeoutMs, label }),
    reviewDiff: (body) =>
      request(apiUrl, '/reviews/diff', s.DiffReview, {
        method: 'POST',
        body,
        timeoutMs: REVIEW_DIFF_TIMEOUT_MS,
        label,
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
  BlastCaller,
  BlastChangedSymbol,
  BlastDownstream,
  BlastIndex,
  ConventionCandidate,
  ConventionEvidence,
  ConventionScan,
  ConventionStatus,
  ConventionsPage,
  DiffReview,
  DiffReviewFinding,
  PrBlast,
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
