import { z } from 'zod';
import { Severity } from './findings.js';
import { RunStatus } from './trace.js';
import { FindingRecord } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`. The routes they cross:
 *   - POST /pulls/:id/multi-agent-run   MultiAgentRunRequest -> MultiAgentRun
 *   - GET  /multi-agent-runs/:id        MultiAgentRun (header + columns + clusters)
 *   - GET  /repos/:id/multi-agent-runs  MultiAgentRunSummary[] (headers only)
 *   - GET  /agents/run-estimates        AgentRunEstimate[]
 *   - GET  /agents/:id/runs             AgentRunsPage
 * plus the shapes inside them:
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/**
 * One agent's result column in the multi-agent review.
 *
 * `findings` carries the FULL `FindingRecord`, not a reduced shape: the tabs
 * view mounts the same finding card the pull request page does, so a second
 * shape would mean a second request (or a second contract) to get back the
 * rationale and the accept/dismiss state the card already renders. It is also
 * the rationale a cluster cell shows and the confidence the cluster title
 * tie-break reads.
 *
 * `status` carries all four `agent_runs.status` values - a user can cancel one
 * agent mid-run, and a three-value enum would fail validation on that row.
 */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  /**
   * The run's recorded failure reason, shown IN PLACE OF a score and a findings
   * list on a failed agent (AC-39). Without it a failed agent is
   * indistinguishable on screen from one that simply found nothing.
   */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(FindingRecord),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/**
 * One agent's stance on a contended file:line.
 *
 * Three states, not two. `'did_not_flag'` is an agent that RAN and reported
 * nothing there; `'no_opinion'` is an agent whose run failed or was cancelled
 * and therefore never had the chance. The single `'ignored'` this replaces
 * could not tell those apart.
 *
 * `note` is the flagging finding's own rationale, truncated to one line, and is
 * `null` for both non-flagging stances - an agent that did not flag something
 * wrote nothing about it, and inventing a sentence would take a second model
 * pass over the other agents' findings.
 */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  verdict: z.union([Severity, z.literal('did_not_flag'), z.literal('no_opinion')]),
  note: z.string().nullable(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  /**
   * The start line of the finding that supplied this cluster's title.
   * Clustering matches on RANGES; only the label crosses the wire, so no range
   * ever needs to.
   */
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /multi-agent-runs/:id. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  pr_title: z.string().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  /**
   * Derived on read from the member runs, never stored: `running` while any
   * agent run is, `failed` when every terminal one failed, else `done`. A
   * stored status would be a second source of truth that can disagree with them.
   */
  status: z.enum(['running', 'done', 'failed']),
  /** The LARGEST of the agent runs' durations - they ran in parallel. */
  total_duration_ms: z.number().int(),
  /** The SUM of the KNOWN agent-run costs. */
  total_cost_usd: z.number().nullable(),
  /**
   * True when at least one agent run recorded no cost, so the total is a floor
   * rather than the whole bill. Without it a run with an unpriced agent reads
   * as silently cheap.
   */
  total_cost_partial: z.boolean(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/**
 * One row of a repository's multi-agent run list (GET /repos/:id/multi-agent-runs).
 *
 * HEADER ONLY, on purpose. `MultiAgentRun` carries every column's full
 * findings, so reusing it for a list would ship every finding of every past run
 * to a screen that shows none of them. The status, duration and cost are
 * derived by exactly the same rules the single-run read uses.
 */
export const MultiAgentRunSummary = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullable(),
  pr_title: z.string().nullable(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  status: z.enum(['running', 'done', 'failed']),
  total_duration_ms: z.number().int().nullable(),
  total_cost_usd: z.number().nullable(),
  total_cost_partial: z.boolean(),
  /** Findings across every member run - the list's one outcome number. */
  findings_count: z.number().int(),
});
export type MultiAgentRunSummary = z.infer<typeof MultiAgentRunSummary>;

/**
 * Body of POST /pulls/:id/multi-agent-run.
 *
 * `.min(2)` puts "a multi-agent run needs at least two agents" at the boundary:
 * a one-agent request is a 422 from the schema, never a hand-written check in
 * a handler.
 */
export const MultiAgentRunRequest = z.object({
  agent_ids: z.array(z.string().uuid()).min(2),
});
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

/**
 * One agent's pre-run estimate, from ITS OWN recorded history - the median
 * duration and median cost over its last ten successful runs. `samples: 0` (and
 * two nulls) is an agent that has never succeeded, which the configure screen
 * leaves out of the estimate and marks it partial.
 */
export const AgentRunEstimate = z.object({
  agent_id: z.string(),
  median_duration_ms: z.number().nullable(),
  median_cost_usd: z.number().nullable(),
  samples: z.number().int(),
});
export type AgentRunEstimate = z.infer<typeof AgentRunEstimate>;

// ---------------------------------------------------------------------------
// Agent run log (L07 companion) - GET /agents/:id/runs
// ---------------------------------------------------------------------------

/**
 * One row of ONE agent's own run log.
 *
 * Deliberately not `RunSummary`: that shape is for the opposite screen. The PR
 * page knows the pull request and needs the agent, so `RunSummary` carries the
 * agent; this list knows the agent and needs the pull request, and it needs
 * `source`, which `RunSummary` does not carry at all.
 */
export const AgentRunSummary = z.object({
  run_id: z.string(),
  /** `agent_runs.ran_at` is NOT NULL, so this is always present. */
  ran_at: z.string(),
  /** Null once the run's pull request has been deleted (`pr_id` is set null). */
  pr_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  pr_title: z.string().nullable(),
  status: RunStatus.nullable(),
  /** Failure reason, shown on the row so a failed run needs no drawer. */
  error: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
  score: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** Studio run or CI run. Nothing writes `ci` yet; the column already exists. */
  source: z.enum(['local', 'ci']),
});
export type AgentRunSummary = z.infer<typeof AgentRunSummary>;

/**
 * One page of an agent's run log. `has_more` is derived by reading one row past
 * the limit, so the caller never has to count the whole table.
 */
export const AgentRunsPage = z.object({
  runs: z.array(AgentRunSummary),
  has_more: z.boolean(),
});
export type AgentRunsPage = z.infer<typeof AgentRunsPage>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
