import { and, count, desc, eq, inArray, isNotNull, lt, max, sum } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { AgentRunsPage, RunSummary, RunTrace, SeverityCounts } from '@devdigest/shared';
import { rollupSeverities } from '../../_shared/severity.js';

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));

  // Per-severity finding counts for the timeline's severity badges.
  // `reviews.run_id` links each run to the review it produced; runs without a
  // review (failed/cancelled) stay null, a clean review yields all-zero counts.
  const severityByRun = new Map<string, SeverityCounts>();
  const reviewRows = await db
    .select({ id: t.reviews.id, runId: t.reviews.runId })
    .from(t.reviews)
    .where(
      and(
        eq(t.reviews.workspaceId, workspaceId),
        eq(t.reviews.prId, prId),
        eq(t.reviews.kind, 'review'),
        isNotNull(t.reviews.runId),
      ),
    );
  if (reviewRows.length > 0) {
    const findingRows = await db
      .select({ reviewId: t.findings.reviewId, severity: t.findings.severity })
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewRows.map((rv) => rv.id)));
    const grouped = new Map<string, { severity: string }[]>();
    for (const f of findingRows) {
      const list = grouped.get(f.reviewId) ?? [];
      list.push(f);
      grouped.set(f.reviewId, list);
    }
    for (const rv of reviewRows) {
      severityByRun.set(rv.runId!, rollupSeverities(grouped.get(rv.id) ?? []));
    }
  }

  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    // L07 - non-null for a run that belongs to a multi-agent run, which is what
    // lets the timeline group N rows sharing one timestamp into one entry
    // without a second request.
    multi_agent_run_id: run.multiAgentRunId,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    cost_usd: run.costUsd,
    findings_count: run.findingsCount,
    severity_counts: severityByRun.get(run.id) ?? null,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * One page of ONE agent's runs, newest first - the agent editor's Runs tab.
 *
 * The `id` tiebreak is not decoration: every fan-out creates its rows in one
 * pass, so two runs routinely share a `ran_at` to the microsecond, and without
 * a second sort key Postgres is free to return them in a different order on
 * every read.
 *
 * `has_more` comes from selecting one row past the limit rather than a second
 * COUNT query. `before` is exclusive, so a load-more never repeats a row.
 */
export async function listRunsForAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
  opts: { limit: number; before?: string },
): Promise<AgentRunsPage> {
  const where = [eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.agentId, agentId)];
  if (opts.before) where.push(lt(t.agentRuns.ranAt, new Date(opts.before)));

  const rows = await db
    .select({
      run: t.agentRuns,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
    })
    .from(t.agentRuns)
    // LEFT join: `agent_runs.pr_id` is ON DELETE set null, so a run outlives its
    // pull request and must still appear in the list.
    .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
    .where(and(...where))
    .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  return {
    runs: rows.slice(0, opts.limit).map(({ run, prNumber, prTitle }) => ({
      run_id: run.id,
      ran_at: run.ranAt.toISOString(),
      pr_id: run.prId,
      pr_number: prNumber ?? null,
      pr_title: prTitle ?? null,
      status: run.status,
      error: run.error,
      findings_count: run.findingsCount,
      blockers: run.blockers,
      score: run.score,
      duration_ms: run.durationMs,
      cost_usd: run.costUsd,
      source: run.source,
    })),
    has_more: hasMore,
  };
}

/**
 * Delete one agent run. Workspace-scoped. `reviews.run_id` and `run_traces.run_id`
 * both cascade from `agent_runs`, and `findings` cascade from `reviews`, so this
 * ONE statement removes the whole run — no manual compensation, no window where
 * a run is gone but its findings linger in the Review Runs list.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/**
 * Total LLM spend per PR for the PR list's COST column: sum of `cost_usd` across
 * ALL runs (re-reviews accumulate). Runs with unknown pricing are skipped, so a
 * PR with no priced runs is simply absent from the result.
 */
export async function totalCostByPull(
  db: Db,
  prIds: string[],
): Promise<{ prId: string; total: number }[]> {
  if (prIds.length === 0) return [];
  const rows = await db
    .select({ prId: t.agentRuns.prId, total: sum(t.agentRuns.costUsd) })
    .from(t.agentRuns)
    .where(and(inArray(t.agentRuns.prId, prIds), isNotNull(t.agentRuns.costUsd)))
    .groupBy(t.agentRuns.prId);
  // Drizzle's sum() returns a STRING (SQL numeric); prId is non-null thanks to
  // the inArray filter.
  return rows.flatMap((r) =>
    r.prId != null && r.total != null ? [{ prId: r.prId, total: Number(r.total) }] : [],
  );
}

export interface AgentSetStats {
  runsCount: number;
  lastRunAt: Date | null;
  findingsCount: number;
  acceptedCount: number;
  dismissedCount: number;
}

/**
 * Aggregate run + review-finding stats over a set of agents (the skill-stats
 * read: a skill's usage is attributed via the agents it is linked to).
 * Finding counts follow the roll-up rule for run aggregates: `kind='review'`
 * AND `run_id IS NOT NULL` only (see server/INSIGHTS.md).
 */
export async function statsForAgents(db: Db, agentIds: string[]): Promise<AgentSetStats> {
  const empty: AgentSetStats = {
    runsCount: 0,
    lastRunAt: null,
    findingsCount: 0,
    acceptedCount: 0,
    dismissedCount: 0,
  };
  if (agentIds.length === 0) return empty;

  const [runs] = await db
    .select({ n: count(), last: max(t.agentRuns.ranAt) })
    .from(t.agentRuns)
    .where(inArray(t.agentRuns.agentId, agentIds));

  // count(column) counts non-null values — accepted/dismissed in one pass.
  const [f] = await db
    .select({
      total: count(),
      accepted: count(t.findings.acceptedAt),
      dismissed: count(t.findings.dismissedAt),
    })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
    .where(
      and(
        inArray(t.reviews.agentId, agentIds),
        eq(t.reviews.kind, 'review'),
        isNotNull(t.reviews.runId),
      ),
    );

  return {
    runsCount: Number(runs?.n ?? 0),
    lastRunAt: runs?.last ?? null,
    findingsCount: Number(f?.total ?? 0),
    acceptedCount: Number(f?.accepted ?? 0),
    dismissedCount: Number(f?.dismissed ?? 0),
  };
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/**
 * Create an agent_runs row in `running` state; returns its id (= the runId).
 *
 * Takes a `DbOrTx` because L07 creates the grouping row and its N member runs
 * in ONE transaction; every existing caller passes nothing and gets today's
 * behaviour. `multiAgentRunId` is likewise absent for a single-agent run.
 */
export async function createAgentRun(
  db: DbOrTx,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    multiAgentRunId?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      multiAgentRunId: values.multiAgentRunId ?? null,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

export async function completeAgentRun(
  db: DbOrTx,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    /** USD cost of the run's LLM calls; null when pricing is unknown. */
    costUsd: number | null;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}
