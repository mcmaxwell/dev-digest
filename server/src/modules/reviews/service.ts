import type { Container } from '../../platform/container.js';
import type {
  AgentColumn,
  AgentRunEstimate,
  AgentRunsPage,
  FindingActionKind,
  MultiAgentRun,
  MultiAgentRunSummary,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { findingRowToDto, reviewToDto } from './helpers.js';
import {
  byAgentOrder,
  conflictsFrom,
  deriveStatus,
  estimateFor,
  totalCost,
  totalDurationMs,
  type AgentFindings,
  type MemberOutcome,
} from './multi-agent.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /**
   * One page of ONE agent's runs, newest first - the agent editor's Runs tab.
   *
   * The agent lookup is not redundant with the workspace-scoped query: without
   * it an unknown (or another workspace's) agent id would return an empty page,
   * which reads as "this agent has never run" rather than as "no such agent".
   */
  async listRunsForAgent(
    workspaceId: string,
    agentId: string,
    opts: { limit: number; before?: string },
  ): Promise<AgentRunsPage> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.repo.listRunsForAgent(workspaceId, agentId, opts);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  // ===========================================================================
  // L07 - multi-agent runs
  // ===========================================================================

  /**
   * Start one multi-agent run: the grouping row plus one agent run per chosen
   * agent, then the SAME fire-and-forget fan-out a single-agent review uses.
   *
   * The transaction boundary is the service's because there is a business
   * decision between the writes - the grouping row's id is what every member
   * run carries, and a half-applied state would leave orphan runs that no
   * screen can group. Execution starts only AFTER the commit, so the executor
   * can never read a row that is about to be rolled back.
   */
  async startMultiAgentRun(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRun> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Resolve every agent BEFORE any write: an unknown id must not leave a
    // half-populated multi-agent run behind. Duplicates collapse, so ticking
    // one agent twice cannot bill for it twice.
    const unique = [...new Set(agentIds)];
    const agents: AgentRow[] = [];
    for (const agentId of unique) {
      const agent = await this.agents.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError(`Agent not found: ${agentId}`);
      agents.push(agent);
    }
    if (agents.length < 2) {
      throw new AppError('invalid_run_request', 'Select at least two agents', 422);
    }
    // The order the agents run in is the order they are shown in - see
    // `byAgentOrder`, and `AgentsRepository.listEnabled`, which has none.
    const targets = [...agents].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    // One multi-agent run in flight per pull request, and the refusal names the
    // one holding the slot so the user can go and look at it.
    const inFlight = await this.repo.activeMultiAgentRunForPull(workspaceId, prId);
    if (inFlight) {
      throw new AppError(
        'multi_agent_run_in_flight',
        `A multi-agent run of this pull request is still running (${inFlight.id})`,
        409,
      );
    }

    const { multiAgentRunId, jobs } = await this.repo.transaction(async (tx) => {
      const multiAgentRunId = await this.repo.createMultiAgentRun({ workspaceId, prId }, tx);
      const jobs: { agent: AgentRow; runId: string }[] = [];
      for (const agent of targets) {
        const runId = await this.repo.createAgentRun(
          {
            workspaceId,
            agentId: agent.id,
            prId,
            provider: agent.provider,
            model: agent.model,
            multiAgentRunId,
          },
          tx,
        );
        jobs.push({ agent, runId });
      }
      return { multiAgentRunId, jobs };
    });

    // Fire-and-forget, exactly as `runReview` does: the response returns the
    // run id now and the client reads the persisted state as agents finish.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error(
        { prId, multiAgentRunId, err: (err as Error).message },
        'multi-agent review: background execution crashed',
      );
    });

    // Every column is `running`: nothing has executed yet by construction.
    return {
      id: multiAgentRunId,
      pr_id: prId,
      pr_number: pull.number,
      pr_title: pull.title,
      ran_at: new Date().toISOString(),
      agent_count: jobs.length,
      status: 'running',
      total_duration_ms: 0,
      total_cost_usd: null,
      total_cost_partial: true,
      columns: jobs.map(({ agent, runId }) => ({
        run_id: runId,
        agent_id: agent.id,
        agent_name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: 'running' as const,
        error: null,
        verdict: null,
        score: null,
        summary: null,
        duration_ms: null,
        cost_usd: null,
        findings: [],
      })),
      conflicts: [],
    };
  }

  /**
   * The whole results screen in ONE read: header, columns and clusters.
   *
   * The clusters are computed here from findings that already exist, through
   * the pure functions in `multi-agent.ts` - this method issues no model call,
   * and the `multi-agent-clustering-is-pure` rule is what keeps that true.
   */
  async getMultiAgentRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const header = await this.repo.getMultiAgentRun(workspaceId, id);
    if (!header) throw new NotFoundError('Multi-agent run not found');

    const members = byAgentOrder(
      (await this.repo.runsForMultiAgentRun(id)).map((m) => ({
        ...m,
        run_id: m.runId,
        // An agent deleted since the run keeps a name on the column, because a
        // nameless column cannot be compared with anything.
        agent_name: m.agentName ?? 'Deleted agent',
      })),
    );

    const columns: AgentColumn[] = members.map((m) => ({
      run_id: m.runId,
      agent_id: m.agentId ?? m.runId,
      agent_name: m.agent_name,
      provider: m.provider,
      model: m.model,
      status: (m.status ?? 'failed') as AgentColumn['status'],
      error: m.error,
      verdict: m.verdict,
      score: m.score,
      summary: m.summary,
      duration_ms: m.durationMs,
      cost_usd: m.costUsd,
      findings: m.findings.map(findingRowToDto),
    }));

    const byAgent: AgentFindings[] = columns.map((c) => ({
      agent_id: c.agent_id,
      agent_name: c.agent_name,
      status: c.status,
      findings: c.findings,
    }));
    const outcomes: MemberOutcome[] = columns.map((c) => ({
      status: c.status,
      duration_ms: c.duration_ms,
      cost_usd: c.cost_usd,
    }));

    return {
      id: header.id,
      pr_id: header.prId,
      pr_number: header.prNumber,
      pr_title: header.prTitle,
      ran_at: header.ranAt.toISOString(),
      agent_count: columns.length,
      status: deriveStatus(outcomes),
      total_duration_ms: totalDurationMs(outcomes),
      ...totalCost(outcomes),
      columns,
      conflicts: conflictsFrom(byAgent),
    };
  }

  /**
   * A repository's recent multi-agent runs, newest first - the landing list.
   * Header rows only: no column, no cluster and no finding crosses this read.
   */
  async listMultiAgentRunsForRepo(
    workspaceId: string,
    repoId: string,
    limit: number,
  ): Promise<MultiAgentRunSummary[]> {
    const rows = await this.repo.listMultiAgentRunsForRepo(workspaceId, repoId, { limit });
    return rows.map((r) => {
      const outcomes: MemberOutcome[] = r.members.map((m) => ({
        status: (m.status ?? 'failed') as AgentColumn['status'],
        duration_ms: m.durationMs,
        cost_usd: m.costUsd,
      }));
      const duration = totalDurationMs(outcomes);
      return {
        id: r.id,
        pr_id: r.prId,
        pr_number: r.prNumber,
        pr_title: r.prTitle,
        ran_at: r.ranAt.toISOString(),
        agent_count: r.members.length,
        status: deriveStatus(outcomes),
        // 0 here means "nothing has finished yet", which is not a duration.
        total_duration_ms: duration > 0 ? duration : null,
        ...totalCost(outcomes),
        findings_count: r.members.reduce((n, m) => n + (m.findingsCount ?? 0), 0),
      };
    });
  }

  /**
   * Every agent's pre-run estimate, from recorded history only - no model call
   * and no run started. One request for the whole configure screen, so toggling
   * a checkbox issues none.
   */
  async agentRunEstimates(workspaceId: string): Promise<AgentRunEstimate[]> {
    const agents = await this.agents.listEnabled(workspaceId);
    const runs = await this.repo.recentSuccessfulRunsByAgent(workspaceId);
    const byAgent = new Map<string, { duration_ms: number | null; cost_usd: number | null }[]>();
    for (const r of runs) {
      byAgent.set(r.agentId, [
        ...(byAgent.get(r.agentId) ?? []),
        { duration_ms: r.durationMs, cost_usd: r.costUsd },
      ]);
    }
    // Every enabled agent gets a row, including one that has never succeeded:
    // its `samples: 0` is what marks the estimate partial rather than absent.
    return agents.map((a) => estimateFor(a.id, byAgent.get(a.id) ?? []));
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
