import { reviewPullRequest } from '@devdigest/reviewer-core';
import {
  AgentVersionConfig,
  type EvalCaseBody,
  type EvalCaseRecord,
  type EvalDashboardIndex,
  type EvalRunRecord,
  type EvalSuiteCompare,
  type EvalSuiteRunDetail,
  type EvalSuiteRunRecord,
  type Provider,
  type UnifiedDiff,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentRow } from '../../db/rows.js';
import { skillToBlock } from '../_shared/skills.js';
import { EvalRepository, type EvalCaseRow } from './repository.js';
import {
  EVAL_RUN_CONCURRENCY,
  EVAL_TASK,
  MAX_CASES_PER_RUN,
  MAX_EVAL_DIFF_CHARS,
} from './constants.js';
import { aggregate, averageRepeats, pairCases, scoreCase, type CaseScore } from './scoring.js';
import { metricDeltas, parseExpectations, toCaseDto, toRunDto, toSuiteRunDto } from './helpers.js';

/** How many runs of an owner the history and the trend read. */
const RUN_HISTORY_LIMIT = 50;
/** How many runs the workspace-wide dashboard lists. */
const RECENT_RUNS_LIMIT = 20;

/** One case's execution: what it scored, what it cost, what the agent said. */
interface CaseOutcome {
  row: EvalCaseRow;
  score: CaseScore;
  durationMs: number;
  costUsd: number | null;
  actualOutput: unknown;
}

/**
 * L06 - the eval harness.
 *
 * A run executes the agent over its whole case set with FIXED inputs: the
 * system prompt, the model, the strategy and the enabled linked skills, plus
 * the case's own diff. Nothing else. No repo-intel, no derived intent, no
 * project context, no PR body - not because they would not help a review, but
 * because they are exactly the inputs that differ between two moments in time,
 * and a harness whose inputs move cannot attribute a metric change to the
 * prompt. Enriching an eval run is a non-goal, not an omission.
 *
 * Scoring is pure code in `scoring.ts` and never calls a model.
 */
export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  // ---- cases ------------------------------------------------------------

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRecord[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listCases(workspaceId, agentId);
    const latest = await this.repo.latestRunByCase(rows.map((r) => r.id));
    return rows.map((r) => toCaseDto(r, latest.get(r.id)));
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRecord | undefined> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) return undefined;
    const latest = await this.repo.latestRunByCase([row.id]);
    return toCaseDto(row, latest.get(row.id));
  }

  async createCase(
    workspaceId: string,
    agentId: string,
    body: EvalCaseBody,
  ): Promise<EvalCaseRecord | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    this.assertRunnableDiff(body.input_diff, body.name);
    const row = await this.repo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: body.name,
      inputDiff: body.input_diff,
      inputFiles: body.input_files ?? null,
      inputMeta: body.input_meta ?? null,
      expectedOutput: body.expected_output ?? { expectations: [] },
      notes: body.notes ?? null,
    });
    return toCaseDto(row, undefined);
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    body: EvalCaseBody,
  ): Promise<EvalCaseRecord | undefined> {
    this.assertRunnableDiff(body.input_diff, body.name);
    const row = await this.repo.updateCase(workspaceId, caseId, {
      name: body.name,
      inputDiff: body.input_diff,
      inputFiles: body.input_files ?? null,
      inputMeta: body.input_meta ?? null,
      expectedOutput: body.expected_output ?? { expectations: [] },
      notes: body.notes ?? null,
    });
    if (!row) return undefined;
    const latest = await this.repo.latestRunByCase([row.id]);
    return toCaseDto(row, latest.get(row.id));
  }

  deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  /**
   * A case whose diff parses to no files can never score anything but zero:
   * the citation gate drops every finding, because no file in the diff matches.
   * Caught at authoring time, where the message can name the case, rather than
   * at run time as an unexplained row of zeroes.
   */
  private assertRunnableDiff(diff: string, name: string): void {
    if ((diff ?? '').length > MAX_EVAL_DIFF_CHARS) {
      throw new ValidationError(
        `Eval case "${name}" has a ${diff.length}-character diff; the limit is ${MAX_EVAL_DIFF_CHARS}. A case is replayed on every run of the set, so an oversized diff costs on every run, not once.`,
      );
    }
    const parsed = parseUnifiedDiff(diff ?? '');
    if (parsed.files.length === 0) {
      throw new ValidationError(
        `Eval case "${name}" has no parseable unified diff - it would score zero on every metric regardless of the agent.`,
      );
    }
  }

  // ---- running ----------------------------------------------------------

  /**
   * Run every case in an agent's set and persist ONE suite run.
   *
   * All-or-nothing: a case that fails to execute (provider error, unparseable
   * diff) aborts the run and persists nothing. A partially-measured run stored
   * alongside fully-measured ones is how a regression harness starts lying -
   * its metrics would be compared against a different denominator without
   * anything on screen saying so.
   */
  async runSuite(
    workspaceId: string,
    agentId: string,
    repeats: number,
  ): Promise<EvalSuiteRunRecord | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const cases = await this.repo.listCases(workspaceId, agentId);
    if (cases.length === 0) {
      throw new AppError('eval_empty_set', 'This agent has no eval cases to run.', 422);
    }
    if (cases.length > MAX_CASES_PER_RUN) {
      throw new AppError(
        'eval_set_too_large',
        `This agent has ${cases.length} eval cases; a single run is capped at ${MAX_CASES_PER_RUN}.`,
        422,
      );
    }

    const started = Date.now();
    const outcomes = await this.executeCases(agent, cases, repeats);
    const suite = aggregate(outcomes.map((o) => o.score));
    const durationMs = Date.now() - started;
    const costUsd = outcomes.reduce<number | null>(
      (sum, o) => (sum == null || o.costUsd == null ? null : sum + o.costUsd),
      0,
    );

    // The suite row and its per-case rows are ONE unit: a crash between them
    // would leave a run whose metrics no case can account for.
    const row = await this.repo.transaction(async (tx) => {
      const suiteRow = await this.repo.insertSuiteRun(
        {
          workspaceId,
          ownerKind: 'agent',
          ownerId: agentId,
          agentVersion: agent.version,
          model: agent.model,
          recall: suite.recall,
          precision: suite.precision,
          citationAccuracy: suite.citation_accuracy,
          tracesPassed: suite.traces_passed,
          tracesTotal: suite.traces_total,
          repeats,
          durationMs,
          costUsd,
        },
        tx,
      );
      for (const o of outcomes) {
        await this.repo.insertRun(
          {
            caseId: o.row.id,
            suiteRunId: suiteRow.id,
            actualOutput: o.actualOutput,
            pass: o.score.pass,
            recall: o.score.recall,
            precision: o.score.precision,
            citationAccuracy: o.score.citation_accuracy,
            durationMs: o.durationMs,
            costUsd: o.costUsd,
          },
          tx,
        );
      }
      return suiteRow;
    });

    return toSuiteRunDto(row);
  }

  /** Run one case on its own (the play button in the case list). */
  async runOneCase(workspaceId: string, caseId: string): Promise<EvalRunRecord | undefined> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) return undefined;
    const agent = await this.container.agentsRepo.getById(workspaceId, row.ownerId);
    if (!agent) throw new NotFoundError('Agent for this eval case not found');

    const [outcome] = await this.executeCases(agent, [row], 1);
    const o = outcome!;
    const runRow = await this.repo.insertRun({
      caseId: row.id,
      actualOutput: o.actualOutput,
      pass: o.score.pass,
      recall: o.score.recall,
      precision: o.score.precision,
      citationAccuracy: o.score.citation_accuracy,
      durationMs: o.durationMs,
      costUsd: o.costUsd,
    });
    return toRunDto(runRow, row.name);
  }

  /**
   * Execute a set of cases with bounded concurrency.
   *
   * Concurrency changes only the wall clock: every case is independent and
   * scoring is order-free. It is bounded because an unbounded fan-out over a
   * provider turns a measurement into a rate-limit retry storm.
   */
  private async executeCases(
    agent: AgentRow,
    cases: EvalCaseRow[],
    repeats: number,
  ): Promise<CaseOutcome[]> {
    const llm = await this.container.llm(agent.provider as Provider);
    const linked = await this.container.agentsRepo.linkedSkills(agent.id);
    const skills = linked.filter((l) => l.skill.enabled).map(({ skill }) => skillToBlock(skill));

    const outcomes: CaseOutcome[] = new Array(cases.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= cases.length) return;
        outcomes[i] = await this.executeCase(agent, cases[i]!, llm, skills, repeats);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(EVAL_RUN_CONCURRENCY, cases.length) }, worker),
    );
    return outcomes;
  }

  private async executeCase(
    agent: AgentRow,
    row: EvalCaseRow,
    llm: Awaited<ReturnType<Container['llm']>>,
    skills: string[],
    repeats: number,
  ): Promise<CaseOutcome> {
    const expectations = parseExpectations(row.expectedOutput);
    let diff: UnifiedDiff;
    try {
      diff = parseUnifiedDiff(row.inputDiff ?? '');
    } catch (err) {
      throw new AppError(
        'eval_case_unparseable',
        `Eval case "${row.name}": could not parse its diff - ${(err as Error).message}`,
        422,
      );
    }

    const started = Date.now();
    const scores: CaseScore[] = [];
    let costUsd: number | null = 0;
    let lastOutput: unknown = null;

    for (let i = 0; i < repeats; i++) {
      let outcome;
      try {
        outcome = await reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          strategy: agent.strategy,
          diff,
          llm,
          ...(skills.length > 0 ? { skills } : {}),
          task: EVAL_TASK,
          // No temperature override, no sessionId, no enrichment slots: this
          // request must be reproducible from the agent's stored config alone.
        });
      } catch (err) {
        throw new AppError(
          'eval_case_failed',
          `Eval case "${row.name}" failed to run: ${(err as Error).message}`,
          502,
        );
      }
      scores.push(
        scoreCase(expectations, outcome.review.findings, outcome.dropped.length),
      );
      costUsd = costUsd == null || outcome.costUsd == null ? null : costUsd + outcome.costUsd;
      lastOutput = {
        findings: outcome.review.findings,
        dropped: outcome.dropped.map((d) => ({ file: d.finding.file, reason: d.reason })),
        grounding: outcome.grounding,
        verdict: outcome.review.verdict,
      };
    }

    return {
      row,
      score: averageRepeats(scores),
      durationMs: Date.now() - started,
      costUsd,
      actualOutput: lastOutput,
    };
  }

  // ---- history and comparison -------------------------------------------

  async listRuns(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalSuiteRunRecord[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listSuiteRuns(workspaceId, agentId, RUN_HISTORY_LIMIT);
    return rows.map(toSuiteRunDto);
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalSuiteRunDetail | undefined> {
    const row = await this.repo.getSuiteRun(workspaceId, runId);
    if (!row) return undefined;
    const cases = await this.repo.runsForSuite(row.id);
    return {
      run: toSuiteRunDto(row),
      cases: cases.map((c) => toRunDto(c, c.caseName)),
    };
  }

  /**
   * Two runs of one agent, paired case by case.
   *
   * The prompts come from the `agent_versions` snapshots the two runs recorded,
   * not from the agent's current row - the point of the view is what the prompt
   * WAS when each run happened.
   */
  async compare(
    workspaceId: string,
    leftId: string,
    rightId: string,
  ): Promise<EvalSuiteCompare | undefined> {
    const [leftRow, rightRow] = await Promise.all([
      this.repo.getSuiteRun(workspaceId, leftId),
      this.repo.getSuiteRun(workspaceId, rightId),
    ]);
    if (!leftRow || !rightRow) return undefined;
    if (leftRow.ownerId !== rightRow.ownerId) {
      throw new ValidationError('Cannot compare runs of two different agents.');
    }

    const [leftCases, rightCases] = await Promise.all([
      this.repo.runsForSuite(leftRow.id),
      this.repo.runsForSuite(rightRow.id),
    ]);
    const left = toSuiteRunDto(leftRow);
    const right = toSuiteRunDto(rightRow);

    return {
      left,
      right,
      delta: metricDeltas(left, right),
      case_deltas: pairCases(
        leftCases.map((c) => ({ case_id: c.caseId, case_name: c.caseName, pass: c.pass })),
        rightCases.map((c) => ({ case_id: c.caseId, case_name: c.caseName, pass: c.pass })),
      ),
      left_prompt: await this.promptFor(leftRow.ownerId, leftRow.agentVersion),
      right_prompt: await this.promptFor(rightRow.ownerId, rightRow.agentVersion),
    };
  }

  /** The system prompt as it was at a given config version, or null if unrecorded. */
  private async promptFor(agentId: string, version: number | null): Promise<string | null> {
    if (version == null) return null;
    const row = await this.container.agentsRepo.getVersion(agentId, version);
    if (!row) return null;
    const parsed = AgentVersionConfig.safeParse(row.configJson);
    return parsed.success ? parsed.data.system_prompt : null;
  }

  // ---- dashboard ---------------------------------------------------------

  async dashboard(workspaceId: string): Promise<EvalDashboardIndex> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    const summaries = await Promise.all(
      agents.map(async (agent) => {
        const [cases, runs] = await Promise.all([
          this.repo.listCases(workspaceId, agent.id),
          this.repo.listSuiteRuns(workspaceId, agent.id, RUN_HISTORY_LIMIT),
        ]);
        return {
          agent_id: agent.id,
          agent_name: agent.name,
          model: agent.model,
          cases_total: cases.length,
          last_run: runs.length > 0 ? toSuiteRunDto(runs[0]!) : null,
          // Oldest-first, so a sparkline reads left to right like the trend chart.
          trend: [...runs]
            .reverse()
            .map((r) => (r.tracesTotal ? (r.tracesPassed ?? 0) / r.tracesTotal : 0)),
        };
      }),
    );
    const recent = await this.repo.recentSuiteRuns(workspaceId, RECENT_RUNS_LIMIT);
    return {
      agents: summaries,
      recent_runs: recent.map((r) => ({ ...toSuiteRunDto(r), agent_name: r.agentName })),
    };
  }
}
