import { pgTable, uuid, text, integer, doublePrecision, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

/**
 * One user action that fanned one pull request out to two or more agents (L07).
 * Declared BEFORE `agent_runs` because that table now references it.
 */
export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    /**
     * L07 - the multi-agent run this run belongs to; null for a single-agent
     * run. Single-valued in one direction, which is the whole requirement:
     * nothing wants one agent run to appear in two multi-agent runs, so a
     * junction table would be wider than what is asked for.
     *
     * `set null`, not `cascade`: `pr_id` above is already `set null` so a run
     * outlives its pull request, and a cascade here would contradict that by
     * destroying runs when their grouping row goes.
     */
    multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, {
      onDelete: 'set null',
    }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** USD cost of the run's LLM calls (real API cost when the provider reports
     *  it, else a pricing-table estimate); null when unknown. */
    costUsd: doublePrecision('cost_usd'),
    // TS-level enum only (stays plain `text` in SQL) — mirrors the RunStatus
    // contract so the run history is typed end to end.
    status: text('status', { enum: ['running', 'done', 'failed', 'cancelled'] }),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
  },
  (t) => ({
    prIdx: index('agent_runs_pr_idx').on(t.prId, t.ranAt), // timeline + active runs
    // Postgres does not auto-index a FK column, and this one IS the read path
    // for "the agent runs of this multi-agent run".
    multiIdx: index('agent_runs_multi_idx').on(t.multiAgentRunId),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

