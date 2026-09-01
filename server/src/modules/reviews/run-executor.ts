import { randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_FANOUT_CONCURRENCY, REVIEW_STRATEGY } from './constants.js';
import { skillToBlock, taskLine } from './helpers.js';
import { loadDiff } from '../_shared/diff-loader.js';
import {
  logPromptAssembly,
  REVIEW_SECTION_SOURCES,
  type PromptSectionInput,
} from '../../platform/prompt-log.js';
// Cross-module read through the documented composition seam: a module may
// construct another module's SERVICE (see .dependency-cruiser.cjs).
import { IntentService } from '../intent/service.js';
import { ProjectContextService } from '../project-context/service.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step(
        'Loading PR diff',
        () =>
          loadDiff(
            this.container,
            this.repo,
            { owner: repo.owner, name: repo.name },
            pull.base,
            pull.headSha,
            pull.id,
          ),
        { kind: 'tool' },
      );
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // One id for this whole user action, spanning the cheap classifier call and
    // every agent's review call. It is what lets someone reading the logs line
    // up two model calls that are minutes and several records apart, and it
    // travels to the provider as `sessionId` so their side groups identically.
    const correlationId = randomUUID();

    // L03 — derived intent. Shared pre-work like the diff: ONE classification per
    // review request, fanned out into every queued agent's prompt and Live Log.
    const intentBlock = await this.buildIntentBlock(
      workspaceId,
      pull,
      diff,
      runLog,
      correlationId,
      logger,
    );

    // L07 - the agents run in PARALLEL, at most REVIEW_FANOUT_CONCURRENCY at a
    // time. Ten agents therefore cost about four review latencies, not ten.
    //
    // Deliberately NOT routed through `container.jobs`: `JobRunner.enqueue`
    // wraps every handler in `withRetry` at a default of 2, so one throw after
    // a successful model call re-issues and re-bills every call the first
    // attempt made. The eval pipeline stays off the runner for the same reason.
    //
    // The per-agent try/catch lives INSIDE the task, so per-agent failure
    // isolation is preserved by construction: a rejected task settles on its
    // own and the queue keeps draining.
    const queue = new PQueue({ concurrency: REVIEW_FANOUT_CONCURRENCY });
    await Promise.all(
      jobs.map(({ agent, runId }) =>
        queue.add(async () => {
          const agentStart = Date.now();
          logger?.info(
            { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
            `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
          );
          try {
            const outcome = await this.runOneAgent(
              workspaceId,
              pull,
              repo,
              diff,
              intentBlock,
              agent,
              runId,
              runLog,
              correlationId,
              logger,
            );
            logger?.info(
              {
                runId,
                agent: agent.name,
                findings: outcome.findings.length,
                grounding: outcome.grounding,
                durationMs: Date.now() - agentStart,
              },
              `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
            );
          } catch (err) {
            // runOneAgent already persisted the failure/cancel (status + error +
            // trace) and completed the bus; here we only log at the run level.
            const cancelled = err instanceof RunCancelledError;
            logger?.[cancelled ? 'info' : 'error'](
              { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
              `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
            );
          }
        }),
      ),
    );
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    intentBlock: string | undefined,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    correlationId: string,
    logger?: Logger,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // L02 — linked skills. Enabled linked skills (in link order) become the
      // prompt's `## Skills / rules` blocks; a globally-disabled skill is
      // skipped for every agent without unlinking it.
      const skillBlocks = await this.buildSkillBlocks(agent.id, runLog);

      // L05 — attached project documents (the agent's own, plus the ones it
      // inherits from its enabled linked skills), read from THIS repository's
      // clone. Best-effort in the same way skills and intent are.
      const projectContext = await this.buildProjectContext(agent.id, repo, runLog);

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // L02 — resolved skill bodies; assemblePrompt omits the section when empty.
        ...(skillBlocks.length > 0 ? { skills: skillBlocks } : {}),
        // L05 — attached project documents, as TEXT. The engine never learns
        // that they are files; with none attached the prompt is byte-identical
        // to a pre-L05 run.
        ...(projectContext.bodies.length > 0 ? { specs: projectContext.bodies } : {}),
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // L03 — the pre-rendered `## Derived intent` block. Omitted when the PR
        // has no intent, in which case the prompt is byte-identical to pre-L03.
        ...(intentBlock ? { intent: intentBlock } : {}),
        task,
        // The correlation id doubles as the provider-side session id, so a
        // review and the intent call that fed it group together on both sides.
        sessionId: correlationId,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      // Metadata-only record of what went into this prompt. The content itself
      // is persisted in the run trace below; this is the part that is safe to
      // ship to a log aggregator. See platform/prompt-log.ts.
      logPromptAssembly(
        logger,
        this.container.config.promptLog,
        {
          correlationId,
          call: 'review',
          provider: agent.provider,
          model: agent.model,
          prId: pull.id,
          runId,
          agent: agent.name,
        },
        (
          [
            'system',
            'intent',
            'skills',
            'memory',
            'specs',
            'repo_map',
            'callers',
            'pr_description',
            'user',
          ] as const
        ).map<PromptSectionInput>((section) => ({
          section,
          source: REVIEW_SECTION_SOURCES[section] ?? 'unknown',
          text: outcome.assembly[section],
        })),
        (text) => this.container.tokenizer.count(text),
      );

      const keptFindings = outcome.review.findings;

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Persist the whole outcome ATOMICALLY -----------------------------
      // review + findings + the reviewed-SHA marker + the run's completion are
      // ONE unit: a crash between them would otherwise leave a review with no
      // findings, or a PR marked reviewed for a run still stuck in `running`.
      const { review, findingRows } = await this.repo.transaction(async (tx) => {
        const review = await this.repo.insertReview(
          {
            workspaceId,
            prId: pull.id,
            agentId: agent.id,
            runId,
            kind: 'review',
            verdict: outcome.review.verdict,
            summary: outcome.review.summary,
            score: outcome.review.score,
            model: agent.model,
          },
          tx,
        );
        const findingRows = await this.repo.insertFindings(review.id, keptFindings, tx);
        // Mark the commit this review ran against so the PR list can tell
        // reviewed / needs-review (head moved) / stale apart.
        await this.repo.markReviewed(pull.id, pull.headSha, tx);
        await this.repo.completeAgentRun(
          runId,
          {
            status: 'done',
            durationMs,
            tokensIn,
            tokensOut,
            costUsd,
            findingsCount: findingRows.length,
            grounding,
            score: outcome.review.score,
            blockers,
            error: null,
          },
          tx,
        );
        return { review, findingRows };
      });
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
        },
        prompt_assembly: {
          ...outcome.assembly,
          // Per-block token attribution for the skills slot ("what did skills
          // add to this prompt"). Tokenizer never throws (chars/4 fallback).
          skills_tokens:
            outcome.assembly.skills != null
              ? this.container.tokenizer.count(outcome.assembly.skills)
              : null,
          // L03 — same per-block attribution for the intent slot ("what did
          // intent add to this prompt").
          intent_tokens:
            outcome.assembly.intent != null
              ? this.container.tokenizer.count(outcome.assembly.intent)
              : null,
          // L05 — same per-block attribution for the project-context slot.
          specs_tokens:
            outcome.assembly.specs != null
              ? this.container.tokenizer.count(outcome.assembly.specs)
              : null,
        },
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        // L05 — one entry per document the run CONSIDERED, statuses included:
        // the omissions are as much a part of "what was read" as the hits.
        specs_read: projectContext.specsRead,
        // L03 — what the scope filter suppressed. The Live Log carries the same
        // drops, but it scrolls; this is the record that survives.
        scope_dropped: outcome.scopeDropped.map(({ finding, reason }) => ({
          severity: finding.severity,
          title: finding.title,
          file: finding.file,
          reason,
        })),
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * L02 — resolve the agent's linked skills into prompt-ready blocks: enabled
   * skills only, in link order, each prefixed with its name. Bodies from
   * non-`manual` sources (imports, community) are UNTRUSTED — someone else's
   * instructions inside this agent's prompt — so they are delimiter-wrapped;
   * the INJECTION_GUARD then treats them as data, not instructions.
   * Best-effort: a load failure degrades to a skill-less prompt, never a
   * failed run.
   */
  private async buildSkillBlocks(agentId: string, runLog: RunLogger): Promise<string[]> {
    let linked;
    try {
      linked = await this.agents.linkedSkills(agentId);
    } catch (err) {
      runLog.info(`skills: load failed — ${(err as Error).message}`);
      return [];
    }
    if (linked.length === 0) return [];
    const enabled = linked.filter((l) => l.skill.enabled);
    const skippedDisabled = linked.length - enabled.length;
    runLog.info(
      `skills: ${enabled.length} enabled skill(s) attached` +
        (skippedDisabled > 0 ? ` (${skippedDisabled} disabled skipped)` : ''),
    );
    return enabled.map(({ skill }) => skillToBlock(skill));
  }

  /**
   * L05 — resolve the agent's attached project documents into prompt-ready
   * bodies, plus the per-document record the trace persists.
   *
   * Assembly lives HERE, in the executor, rather than in the reviews service:
   * `executor.executeRuns` is the single entry point every review path goes
   * through, so a CI-sourced run assembles project context by exactly the same
   * rules as a studio run — by placement, not by a second code path.
   *
   * Best-effort like skills and intent: any failure degrades to a
   * document-less prompt, which is byte-identical to a pre-L05 run, and never
   * to a failed review.
   */
  private async buildProjectContext(
    agentId: string,
    repo: typeof schema.repos.$inferSelect,
    runLog: RunLogger,
  ): Promise<{ bodies: string[]; specsRead: RunTrace['specs_read'] }> {
    try {
      const service = new ProjectContextService(this.container);
      const result = await service.assembleForRun({
        agentId,
        repo: { id: repo.id, owner: repo.owner, name: repo.name },
        onLog: (msg) => runLog.info(msg),
      });
      if (result.bodies.length > 0) {
        runLog.info(`project context: ${result.bodies.length} document(s) attached`);
      }
      return result;
    } catch (err) {
      runLog.info(`project context: load failed — ${(err as Error).message}`);
      return { bodies: [], specsRead: [] };
    }
  }

  /**
   * L03 — resolve the PR's derived intent into the prompt's `## Derived intent`
   * block, classifying it first when there is none or when the head has moved
   * since the stored one was built.
   *
   * Freshness comes from `PrIntent.stale`, which the intent module already
   * derives by comparing the stored head against the PR's current one. Reading
   * the repository directly would be a second, workspace-unscoped route into
   * `pr_intent` (the table has no `workspace_id`; the guard lives in
   * `IntentService`), and it would re-implement a comparison that already has
   * an owner.
   *
   * Best-effort in the same way skills and repo-intel are: a classifier failure
   * (no key, provider down, bad JSON) degrades to an intent-less prompt — which
   * is byte-identical to the pre-L03 prompt — never to a failed review. The
   * failure is still surfaced in the Live Log, so it is never silent.
   */
  private async buildIntentBlock(
    workspaceId: string,
    pull: PullRow,
    diff: UnifiedDiff,
    runLog: RunLogger,
    correlationId: string,
    logger?: Logger,
  ): Promise<string | undefined> {
    const service = new IntentService(this.container);
    try {
      const stored = await service.get(workspaceId, pull.id);
      const current = stored != null && !stored.stale;
      const intent = current
        ? stored
        : await service.classify(workspaceId, pull.id, {
            diff,
            correlationId,
            onEvent: (msg) => runLog.info(msg),
            ...(logger ? { logger } : {}),
          });
      if (!intent) return undefined;
      if (current) {
        runLog.info(`intent: reusing stored intent for ${pull.headSha.slice(0, 8)}`);
      }
      return service.renderBlock(intent);
    } catch (err) {
      runLog.info(`intent: classification failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
