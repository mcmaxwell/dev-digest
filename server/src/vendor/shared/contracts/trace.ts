import { z } from 'zod';
import { Severity, SeverityCounts } from './findings.js';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PromptAssembly = z.object({
  system: z.string(),
  skills: z.string().nullish(),
  /** Token count of the skills block (tokenizer estimate); null when absent. */
  skills_tokens: z.number().int().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (T1.3); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (T3); null when absent. Enables per-slot token
      attribution in the run trace. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  /** L03 — the pre-rendered `## Derived intent` block; null when absent. */
  intent: z.string().nullish(),
  /** Token count of the intent block (tokenizer estimate); null when absent. */
  intent_tokens: z.number().int().nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  // USD cost of the run's LLM calls; null when pricing is unknown.
  cost_usd: z.number().nullable(),
  findings: z.number().int(),
  grounding: z.string(),
});
export type RunStats = z.infer<typeof RunStats>;

/**
 * L03 — one entry per finding the scope filter suppressed.
 *
 * The filter is never allowed to be invisible: a drop also emits a Live Log
 * line and appends a sentence to the review summary, and this is the record
 * that survives after the log scrolls away. A CRITICAL never appears here,
 * because it is never dropped.
 */
export const ScopeDropped = z.object({
  severity: Severity,
  title: z.string(),
  file: z.string(),
  reason: z.string(),
});
export type ScopeDropped = z.infer<typeof ScopeDropped>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  scope_dropped: z.array(ScopeDropped).nullish(),
  log: z.array(RunLogLine),
});
export type RunTrace = z.infer<typeof RunTrace>;

/** Lifecycle of one agent run — the domain of `agent_runs.status`. */
export const RunStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: RunStatus.nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  // USD cost of the run; null on failed/cancelled runs or unknown pricing.
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  // Per-severity breakdown of the run's review findings; null when the run
  // produced no review (failed/cancelled) or predates severity rollups.
  severity_counts: SeverityCounts.nullish(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
