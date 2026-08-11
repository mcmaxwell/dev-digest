import * as z from 'zod';

/**
 * Narrow parsers for the slice of the DevDigest API this server reads.
 *
 * These are deliberately NOT `@devdigest/shared`: those contracts are zod 3 and
 * this package is zod 4 (see AGENTS.md). The upside of owning them is more than
 * version hygiene - zod strips unknown keys by default, so a field that is not
 * listed here CANNOT reach a tool result. That is what makes "an agent's
 * `system_prompt` never leaves the API" a property of the type, not of a review
 * comment: `Agent` below simply has no such key.
 *
 * Everything the renderers do not strictly need is `nullish()`, so the API
 * gaining or nulling a field degrades a line of output instead of failing a
 * whole tool call.
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const SeverityCounts = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;

/** GET /repos - note the absence of `clone_path`, an absolute path on this machine. */
export const Repo = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string().nullish(),
});
export type Repo = z.infer<typeof Repo>;

/** GET /agents - note the absence of `system_prompt` and `output_schema`. */
export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  version: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

/** GET /repos/:id/pulls/:number - only the fields a review header needs. */
export const PrDetail = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string().nullish(),
  status: z.string().nullish(),
  head_sha: z.string().nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

export const RunStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

/**
 * One row of GET /pulls/:id/runs. This single read carries both the terminal
 * signal AND the whole response header (duration, cost, counts, score), which is
 * why the wait loop polls it instead of subscribing to the SSE run bus.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  model: z.string().nullish(),
  status: RunStatus.nullish(),
  error: z.string().nullish(),
  duration_ms: z.number().nullish(),
  cost_usd: z.number().nullish(),
  findings_count: z.number().int().nullish(),
  severity_counts: SeverityCounts.nullish(),
  score: z.number().int().nullish(),
});
export type RunSummary = z.infer<typeof RunSummary>;

/** GET /pulls/:id/runs/active. */
export const ActiveRun = z.object({
  run_id: z.string(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  ran_at: z.string().nullish(),
});
export type ActiveRun = z.infer<typeof ActiveRun>;

/** A finding as GET /pulls/:id/reviews returns it. `id` is dropped on purpose:
 *  none of the five tools consumes a finding id and a uuid costs ~36 chars each. */
export const ReviewFinding = z.object({
  severity: Severity,
  category: z.string().nullish(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int().nullish(),
  rationale: z.string().nullish(),
  suggestion: z.string().nullish(),
  confidence: z.number().nullish(),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

/** One persisted review (GET /pulls/:id/reviews returns them NEWEST FIRST). */
export const Review = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullish(),
  run_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  kind: z.string(),
  verdict: z.string().nullish(),
  summary: z.string().nullish(),
  score: z.number().int().nullish(),
  model: z.string().nullish(),
  created_at: z.string().nullish(),
  findings: z.array(ReviewFinding).default([]),
});
export type Review = z.infer<typeof Review>;

/**
 * POST /pulls/:id/review. `reviews` is intentionally not parsed: the route
 * always answers with an EMPTY array because `ReviewService.runReview` fires the
 * executor as `void this.executor.executeRuns(...)`
 * (server/src/modules/reviews/service.ts:133). The run id is the only usable
 * output, and the result is read later through GET /pulls/:id/reviews.
 */
export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(
    z.object({
      run_id: z.string(),
      agent_id: z.string(),
      agent_name: z.string(),
    }),
  ),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionEvidence = z.object({
  path: z.string(),
  line: z.number().int(),
  snippet: z.string().nullish(),
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

export const ConventionCandidate = z.object({
  id: z.string(),
  category: z.string(),
  rule: z.string(),
  rationale: z.string().nullish(),
  evidence: z.array(ConventionEvidence).default([]),
  confidence: z.number().nullish(),
  /** MEASURED conformance (0..1), or null when the candidate shipped no probe. */
  adherence: z.number().nullish(),
  support: z.number().int().nullish(),
  violations: z.number().int().nullish(),
  origin: z.string().nullish(),
  status: ConventionStatus,
  edited: z.boolean().nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionScan = z.object({
  id: z.string(),
  status: z.enum(['running', 'done', 'error']),
  sha: z.string().nullish(),
  model: z.string().nullish(),
  sample_count: z.number().int().nullish(),
  candidate_count: z.number().int().nullish(),
  error: z.string().nullish(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** GET /repos/:id/conventions - returns EVERY candidate, `rejected` included.
 *  Filtering is this package's job (see src/tools/get-conventions.ts). */
export const ConventionsPage = z.object({
  scan: ConventionScan.nullish(),
  candidates: z.array(ConventionCandidate).default([]),
});
export type ConventionsPage = z.infer<typeof ConventionsPage>;

export const RepoList = z.array(Repo);
export const AgentList = z.array(Agent);
export const RunSummaryList = z.array(RunSummary);
export const ActiveRunList = z.array(ActiveRun);
export const ReviewList = z.array(Review);
