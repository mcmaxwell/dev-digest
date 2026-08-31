import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { FindingRow } from '../../../db/rows.js';

/**
 * L07 - the `multi_agent_runs` aggregate, split by aggregate alongside
 * `review.repo.ts`, `run.repo.ts` and `pull.repo.ts`.
 *
 * The table lives in the `reviews` module because a multi-agent run is a
 * grouping of `agent_runs` rows, and those are this module's. A separate module
 * would have to write another module's table, which is exactly what
 * `queries-live-in-repositories` forbids.
 *
 * Every query here is workspace-scoped.
 */

export interface MultiAgentRunRow {
  id: string;
  prId: string;
  ranAt: Date;
  prNumber: number | null;
  prTitle: string | null;
}

/** One member run of a multi-agent run, with everything a column needs. */
export interface MultiAgentMemberRun {
  runId: string;
  agentId: string | null;
  /** The agent's CURRENT name; null once the agent has been deleted. */
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: 'running' | 'done' | 'failed' | 'cancelled' | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  score: number | null;
  reviewId: string | null;
  verdict: string | null;
  summary: string | null;
  findings: FindingRow[];
}

/** Create the grouping row. Takes a handle: the service opens the transaction. */
export async function createMultiAgentRun(
  db: DbOrTx,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/** One multi-agent run's header, joined to its pull request for the label. */
export async function getMultiAgentRun(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      ranAt: t.multiAgentRuns.ranAt,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
    })
    .from(t.multiAgentRuns)
    .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
  return row ? { ...row, prNumber: row.prNumber ?? null, prTitle: row.prTitle ?? null } : undefined;
}

/**
 * Every agent run of one multi-agent run, with its review and that review's
 * findings - the whole results screen in ONE read, so the screen never issues a
 * request per agent.
 *
 * The review join keeps the standing roll-up rule for run aggregates:
 * `kind = 'review'` AND `run_id IS NOT NULL`, so a `summary` row can never be
 * mistaken for an agent's verdict.
 */
export async function runsForMultiAgentRun(
  db: Db,
  multiAgentRunId: string,
): Promise<MultiAgentMemberRun[]> {
  const rows = await db
    .select({
      run: t.agentRuns,
      agentName: t.agents.name,
      reviewId: t.reviews.id,
      verdict: t.reviews.verdict,
      summary: t.reviews.summary,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .leftJoin(
      t.reviews,
      and(
        eq(t.reviews.runId, t.agentRuns.id),
        eq(t.reviews.kind, 'review'),
        isNotNull(t.reviews.runId),
      ),
    )
    .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));

  const reviewIds = rows.flatMap((r) => (r.reviewId ? [r.reviewId] : []));
  const findingsByReview = new Map<string, FindingRow[]>();
  if (reviewIds.length > 0) {
    const findingRows = await db
      .select()
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewIds));
    for (const f of findingRows) {
      findingsByReview.set(f.reviewId, [...(findingsByReview.get(f.reviewId) ?? []), f]);
    }
  }

  return rows.map(({ run, agentName, reviewId, verdict, summary }) => ({
    runId: run.id,
    agentId: run.agentId,
    agentName: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    score: run.score,
    reviewId: reviewId ?? null,
    verdict: verdict ?? null,
    summary: summary ?? null,
    findings: reviewId ? (findingsByReview.get(reviewId) ?? []) : [],
  }));
}

/** One row of a repository's multi-agent run list, before the derivation. */
export interface MultiAgentRunListRow {
  id: string;
  prId: string;
  ranAt: Date;
  prNumber: number | null;
  prTitle: string | null;
  members: {
    status: 'running' | 'done' | 'failed' | 'cancelled' | null;
    durationMs: number | null;
    costUsd: number | null;
    findingsCount: number | null;
  }[];
}

/**
 * A repository's recent multi-agent runs, newest first (amendment 01 - the
 * landing page). Scoped to the repository THROUGH `pull_requests`, because
 * `multi_agent_runs` carries only the pull request.
 *
 * Returns the member runs' scalars and nothing else: the caller derives the
 * status, duration and cost with the same pure helpers the single-run read
 * uses, and no finding ever crosses this boundary.
 *
 * The `id` tiebreak matters for the same reason it does everywhere else here -
 * two runs of one repository can share a `ran_at`.
 */
export async function listMultiAgentRunsForRepo(
  db: Db,
  workspaceId: string,
  repoId: string,
  opts: { limit: number },
): Promise<MultiAgentRunListRow[]> {
  const runs = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      ranAt: t.multiAgentRuns.ranAt,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
    })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(
      and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.pullRequests.repoId, repoId)),
    )
    .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
    .limit(opts.limit);

  if (runs.length === 0) return [];

  // One follow-up read for every member run of the whole page, not one per run.
  const memberRows = await db
    .select({
      multiAgentRunId: t.agentRuns.multiAgentRunId,
      status: t.agentRuns.status,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
      findingsCount: t.agentRuns.findingsCount,
    })
    .from(t.agentRuns)
    .where(inArray(t.agentRuns.multiAgentRunId, runs.map((r) => r.id)));

  const byRun = new Map<string, MultiAgentRunListRow['members']>();
  for (const m of memberRows) {
    if (!m.multiAgentRunId) continue;
    byRun.set(m.multiAgentRunId, [
      ...(byRun.get(m.multiAgentRunId) ?? []),
      {
        status: m.status,
        durationMs: m.durationMs,
        costUsd: m.costUsd,
        findingsCount: m.findingsCount,
      },
    ]);
  }

  return runs.map((r) => ({ ...r, members: byRun.get(r.id) ?? [] }));
}

/**
 * The multi-agent run of this pull request that still has a `running` agent
 * run, if any. One multi-agent run in flight per pull request, and the refusal
 * has to be able to NAME the one that is holding the slot.
 */
export async function activeMultiAgentRunForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ id: string; ranAt: Date } | undefined> {
  const [row] = await db
    .select({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt })
    .from(t.multiAgentRuns)
    .innerJoin(t.agentRuns, eq(t.agentRuns.multiAgentRunId, t.multiAgentRuns.id))
    .where(
      and(
        eq(t.multiAgentRuns.workspaceId, workspaceId),
        eq(t.multiAgentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    )
    .orderBy(desc(t.multiAgentRuns.ranAt))
    .limit(1);
  return row;
}

/** How many recent successful runs per agent the estimate is allowed to read. */
export const ESTIMATE_WINDOW = 10;

/**
 * The last `ESTIMATE_WINDOW` SUCCESSFUL runs of every agent in the workspace,
 * for the pre-run estimate.
 *
 * The window is closed in SQL with `row_number() OVER (PARTITION BY agent_id)`
 * rather than by fetching every run and slicing in JavaScript, so the read is
 * bounded by the number of agents rather than by the history. Built with the
 * query builder plus `.as('ranked')` - the shape `getResolvedCallersTopN`
 * already uses here - so only the `row_number()` expression is raw.
 */
export async function recentSuccessfulRunsByAgent(
  db: Db,
  workspaceId: string,
): Promise<{ agentId: string; durationMs: number | null; costUsd: number | null }[]> {
  const ranked = db
    .select({
      agentId: t.agentRuns.agentId,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
      rn: sql<number>`row_number() over (
        partition by ${t.agentRuns.agentId}
        order by ${t.agentRuns.ranAt} desc, ${t.agentRuns.id} desc
      )`.as('rn'),
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.status, 'done'),
        isNotNull(t.agentRuns.agentId),
      ),
    )
    .as('ranked');

  const rows = await db
    .select({ agentId: ranked.agentId, durationMs: ranked.durationMs, costUsd: ranked.costUsd })
    .from(ranked)
    .where(lte(ranked.rn, ESTIMATE_WINDOW));

  // `agent_id` is non-null thanks to the isNotNull filter above; narrow it here
  // so the caller never has to.
  return rows.flatMap((r) =>
    r.agentId != null
      ? [{ agentId: r.agentId, durationMs: r.durationMs, costUsd: r.costUsd }]
      : [],
  );
}
