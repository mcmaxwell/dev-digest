import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews` and `findings`, and persists the observability rows
 * `agent_runs` + `run_traces` (one trace doc per run). Workspace scoping is
 * enforced via the PR (which carries workspace_id).
 *
 * `pr_intent` is NOT here: L03 gave it its own owning repository in
 * `modules/intent`, reached only through `IntentService` (the table has no
 * `workspace_id`, so the service IS the tenancy boundary).
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull). This class composes them
 * so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  /**
   * Run `fn` inside one transaction. The BOUNDARY is chosen by the caller
   * (service / run executor); repository methods that accept a `DbOrTx` join
   * whatever handle they are given.
   */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  /**
   * Prior PRs of the same repo whose changed files overlap `paths`, newest
   * first. Read by `modules/brief`, which owns no `pr_files` query of its own.
   */
  overlappingPulls(
    repoId: string,
    prId: string,
    paths: string[],
    limit: number,
  ): Promise<pullRepo.OverlappingPull[]> {
    return pullRepo.overlappingPulls(this.db, repoId, prId, paths, limit);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }, tx: DbOrTx = this.db): Promise<ReviewRow> {
    return reviewRepo.insertReview(tx, values);
  }

  insertFindings(reviewId: string, findings: Finding[], tx: DbOrTx = this.db): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(tx, reviewId, findings);
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  // ---- PR-list aggregates (read by the pulls module via container.reviewRepo)

  /** Scoring inputs for a batch of PRs, newest first, `kind='review'` only. */
  reviewSummariesForPulls(
    prIds: string[],
  ): Promise<{ id: string; prId: string; agentId: string | null; score: number | null }[]> {
    return reviewRepo.reviewSummariesForPulls(this.db, prIds);
  }

  /** Raw finding severities for a batch of reviews (caller groups + rolls up). */
  findingSeveritiesForReviews(
    reviewIds: string[],
  ): Promise<{ reviewId: string; severity: string }[]> {
    return reviewRepo.findingSeveritiesForReviews(this.db, reviewIds);
  }

  /** Total LLM spend per PR across all runs (unpriced runs omitted). */
  totalCostByPull(prIds: string[]): Promise<{ prId: string; total: number }[]> {
    return runRepo.totalCostByPull(this.db, prIds);
  }

  /** Aggregate run + finding stats for a set of agents (skill statistics). */
  statsForAgents(agentIds: string[]): Promise<runRepo.AgentSetStats> {
    return runRepo.statsForAgents(this.db, agentIds);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, runId);
  }

  /** On boot: any run still 'running' is orphaned (its process died / restarted),
   *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  completeAgentRun(
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
    tx: DbOrTx = this.db,
  ): Promise<void> {
    return runRepo.completeAgentRun(tx, runId, values);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string, tx: DbOrTx = this.db): Promise<void> {
    return pullRepo.markReviewed(tx, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, runId);
  }
}
