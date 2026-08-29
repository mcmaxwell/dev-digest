import { randomUUID } from 'node:crypto';
import type {
  BriefDegradedReason,
  BriefHistoryEntry,
  BriefView,
  GitHubClient,
  PrHistoryItem,
  Provider,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import { logPromptAssembly, type StructuredLogger } from '../../platform/prompt-log.js';
import { buildFileMap } from '../_shared/hunk-map.js';
import { loadDiff } from '../_shared/diff-loader.js';
// Cross-module reads through the documented composition seam: a module may
// construct another module's SERVICE, and may import its `constants.ts`
// (see .dependency-cruiser.cjs `no-cross-module-imports`).
import { BlastService } from '../blast/service.js';
import { IntentService } from '../intent/service.js';
import { SettingsService } from '../settings/service.js';
import { LINKED_ISSUE_RE, SPEC_FILE_CANDIDATES } from '../intent/constants.js';
import { BriefRepository, type PrBriefRow } from './repository.js';
import { buildCandidates } from './candidates.js';
import { groundBrief, noneDropped } from './ground.js';
import { rankPriorPulls } from './history.js';
import { buildBriefPrompt, type CallerDigestEntry } from './prompt.js';
import { BRIEF_SCHEMA_NAME, BriefDraftSchema } from './schemas.js';
import {
  MAX_BRIEF_HISTORY,
  MAX_PROSE_CHARS,
  MAX_PROSE_SENTENCES,
  MAX_SCHEMA_REPAIRS,
  MODEL_TIMEOUT_MS,
  PRIOR_PR_CANDIDATES,
  PROMPT_MAX_ISSUE_CHARS,
  PROMPT_TOKEN_CEILING,
} from './constants.js';
import type { BriefTrace } from './types.js';

/**
 * L05 — the PR Brief.
 *
 * An APPLICATION-LAYER COMPOSER. It owns one use case and two tables, and every
 * fact it needs already exists somewhere else: `BlastService` for reach and the
 * index verdict, `IntentService` for the derived intent, `_shared/diff-loader`
 * for the diff, `container.reviewRepo` for the PR and the prior-PR overlap,
 * `container.github()` / `container.git` for the issue and the spec files. It
 * adds no port, issues no raw `fetch`, and dereferences no URL (AC-12).
 *
 * ONE MODEL CALL PER GENERATION, and it is the ONLY thing here that spends
 * money. Four gates run before it, each of which persists a deterministic,
 * readable brief with an explicit reason and returns 200 rather than an error:
 * a degraded index (nothing to ground against), a missing clone, a PR with no
 * files, and a failed call. `withRetry` is deliberately absent — a retry
 * wrapper re-issues a paid call, which is the anti-pattern L06 documented.
 *
 * NO `agent_runs` ROW IS EVER CREATED (AC-3, AC-51). The brief is not an agent
 * run: putting one in `/pulls/:id/runs` would inflate the PR's run history and
 * its `total_cost_usd`. Its cost lives in `pr_brief.trace` and in one log line,
 * for the same reason `IntentService`'s does.
 */
export class BriefService {
  private repo: BriefRepository;

  /**
   * One generation per PR at a time. A second request AWAITS the first's result
   * rather than issuing a second paid call — the shape
   * `OnboardingService.requestGeneration` uses, minus the 409, because the
   * second click here should show the brief, not an error.
   *
   * Claimed before any I/O beyond the tenancy check. (The tenancy check must
   * come first regardless: sharing an in-flight promise across workspaces would
   * hand one workspace another's brief.) Do not describe this as a TOCTOU fix —
   * nothing yields between the `has` and the `set`, so there is no race to win;
   * it exists to refuse the second click before it spends anything.
   */
  private inFlight = new Map<string, Promise<BriefView>>();

  constructor(private container: Container) {
    // Built from container.db, NOT a container getter — tests construct services
    // with a bare `{ db }` container (see server/INSIGHTS.md).
    this.repo = new BriefRepository(container.db);
  }

  /**
   * The stored brief, or null. NEVER generates and never spends a token (AC-4,
   * AC-5, AC-26): staleness is shown, regeneration is always an explicit click.
   */
  async get(workspaceId: string, prId: string): Promise<BriefView | null> {
    const pull = await this.pullOr404(workspaceId, prId);
    const row = await this.repo.get(prId);
    if (!row) return null;

    // The index state is read fresh rather than replayed from the row: it is
    // half of the staleness verdict, and it is what the card renders its own
    // trustworthiness from.
    const { index } = await new BlastService(this.container).get(workspaceId, prId);
    return this.rowToView(row, pull.headSha, index.last_indexed_sha, index, await this.timeline(prId));
  }

  /**
   * Generate (or regenerate) the brief and return it.
   *
   * Always a replacement: a brief is a statement about one head SHA, so a re-run
   * supersedes rather than merges. The superseded reading is not lost — it is in
   * `pr_brief_history`, which is append-only.
   */
  async generate(
    workspaceId: string,
    prId: string,
    opts: { logger?: StructuredLogger } = {},
  ): Promise<BriefView> {
    // 1. TENANCY FIRST — before the single-flight map is even consulted.
    await this.pullOr404(workspaceId, prId);

    const running = this.inFlight.get(prId);
    if (running) return running;

    const promise = this.runGeneration(workspaceId, prId, opts).finally(() => {
      this.inFlight.delete(prId);
    });
    this.inFlight.set(prId, promise);
    return promise;
  }

  // --- the generation ------------------------------------------------------

  private async runGeneration(
    workspaceId: string,
    prId: string,
    opts: { logger?: StructuredLogger },
  ): Promise<BriefView> {
    const started = Date.now();
    const correlationId = randomUUID();
    const pull = await this.pullOr404(workspaceId, prId);
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');
    const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };

    const blastResponse = await new BlastService(this.container).get(workspaceId, prId);
    const { blast, index } = blastResponse;
    const changedFiles = (await this.container.reviewRepo.getPrFiles(prId)).map((f) => f.path);

    // The prior-PR list is DETERMINISTIC, so it is computed before the gates and
    // carried into every degraded answer too: a brief that could not call a
    // model still knows who else touched these files.
    const priors = rankPriorPulls(
      await this.container.reviewRepo.overlappingPulls(
        pull.repoId,
        prId,
        changedFiles,
        PRIOR_PR_CANDIDATES,
      ),
      changedFiles,
    );

    const degrade = (reason: BriefDegradedReason) =>
      this.persistDegraded({
        prId,
        headSha: pull.headSha,
        index,
        priors,
        reason,
        durationMs: Date.now() - started,
        logger: opts.logger,
        correlationId,
      });

    // 2. HARD GATES, each of them BEFORE any spend.
    if (index.status === 'degraded') return degrade('index_degraded');
    if (!repoRow.clonePath || !(await this.cloneReachable(ref))) return degrade('clone_unavailable');
    if (changedFiles.length === 0) return degrade('no_files');

    // 3. Facts. Nothing here dereferences a URL: the linked issue goes through
    // `GitHubClient` for THIS repository only, and the spec candidates go
    // through `GitClient.readFile` against the clone (AC-12).
    const diff = await loadDiff(
      this.container,
      this.container.reviewRepo,
      ref,
      pull.base,
      pull.headSha,
      prId,
    );
    const intent = await new IntentService(this.container).get(workspaceId, prId);
    const linkedIssue = await this.resolveLinkedIssue(ref, pull.body);
    const specs = await this.readSpecFiles(ref);

    const callerFiles = unique(
      blast.downstream.flatMap((d) => d.callers.map((c) => c.file)),
    );
    const endpoints = unique(blast.downstream.flatMap((d) => d.endpoints_affected));
    const crons = unique(blast.downstream.flatMap((d) => d.crons_affected));

    // The digest carries caller PATHS and nothing else. `BlastCaller.line` is a
    // position in the default branch at `last_indexed_sha`, so it is projected
    // away here and never enters the prompt or the candidate set (AC-16).
    const callers: CallerDigestEntry[] = blast.downstream.map((d) => ({
      symbol: d.symbol,
      files: unique(d.callers.map((c) => c.file)),
      callerTotal: d.caller_total,
    }));

    const candidates = buildCandidates({ changedFiles, callerFiles, endpoints, crons, diff });

    const prompt = buildBriefPrompt(
      {
        pr: { number: pull.number, title: pull.title, body: pull.body },
        linkedIssue,
        intentBlock: intent ? new IntentService(this.container).renderBlock(intent) : null,
        changedFiles,
        callerFiles,
        fileMap: buildFileMap(diff),
        callers,
        endpoints,
        crons,
        specs,
        priorPulls: priors.map((p) => ({ number: p.pr_number, title: p.title })),
        index,
      },
      (text) => this.container.tokenizer.count(text),
      PROMPT_TOKEN_CEILING,
    );

    const { provider, model } = await new SettingsService(this.container).resolveFeatureModel(
      workspaceId,
      // The registry already carries this feature ("assesses merge risks for a
      // pull request"), the same id the blast summary resolves.
      'risk_brief',
    );

    // 4. Metadata-only record of the prompt, emitted BEFORE the call so it
    // survives a provider failure. Content goes to `pr_brief.trace`, never here.
    logPromptAssembly(
      opts.logger,
      this.container.config.promptLog,
      { correlationId, call: 'brief', provider, model, prId },
      [
        { section: 'system', source: 'brief rules + DATA_GUARD', text: prompt.system },
        ...prompt.sections,
      ],
      (text) => this.container.tokenizer.count(text),
    );

    // 5. EXACTLY ONE call. Not wrapped in `withRetry` — that re-issues a paid
    // call. Schema repairs go through the provider's own loop, bounded at
    // `MAX_SCHEMA_REPAIRS + 1` attempts.
    let res;
    try {
      const llm = await this.container.llm(provider as Provider);
      res = await withTimeout(
        llm.completeStructured({
          model,
          schema: BriefDraftSchema,
          schemaName: BRIEF_SCHEMA_NAME,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          maxRetries: MAX_SCHEMA_REPAIRS,
        }),
        MODEL_TIMEOUT_MS,
      );
    } catch {
      return this.persistDegraded({
        prId,
        headSha: pull.headSha,
        index,
        priors,
        reason: 'model_failed',
        durationMs: Date.now() - started,
        logger: opts.logger,
        correlationId,
        provider,
        model,
        prompt,
      });
    }

    // 6. The model is untrusted because it was fed untrusted text: everything it
    // named is intersected back with the candidate set before it can render.
    const grounded = groundBrief(res.data, candidates);

    const view: BriefView = {
      prose: {
        what: clampProse(grounded.prose.what),
        why: clampProse(grounded.prose.why),
      },
      risk_level: grounded.risk_level,
      risks: grounded.risks,
      review_focus: grounded.review_focus,
      history: priors,
      brief_history: [],
      dropped: grounded.dropped,
      meta: {
        provider,
        model,
        head_sha: pull.headSha,
        indexed_sha: index.last_indexed_sha,
        generated_at: new Date().toISOString(),
        stale: false,
      },
      index,
      status: 'ok',
      degraded_reason: null,
    };

    const trace: BriefTrace = {
      system: prompt.system,
      user: prompt.user,
      provider,
      model,
      blocks_kept: prompt.kept,
      blocks_dropped: prompt.dropped,
      prompt_tokens_measured: prompt.tokens,
      tokens_in: res.tokensIn,
      tokens_out: res.tokensOut,
      cost_usd: res.costUsd,
      duration_ms: Date.now() - started,
    };

    const stored = await this.persist(prId, view, trace);

    // 7. IDs, counts and PROVIDER-REPORTED cost only. Never a character of the
    // prompt, and never the locally measured token count presented as spend —
    // measured-versus-billed was 5x on this codebase (server/INSIGHTS.md).
    opts.logger?.info(
      {
        prId,
        correlationId,
        feature: 'risk_brief',
        call: 'brief',
        schemaName: BRIEF_SCHEMA_NAME,
        provider,
        model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        promptTokensMeasured: prompt.tokens,
        blocksDropped: prompt.dropped,
        risks: view.risks.length,
        reviewFocus: view.review_focus.length,
        dropped: view.dropped,
        riskLevel: view.risk_level,
        indexStatus: index.status,
        durationMs: Date.now() - started,
      },
      'brief: generated',
    );

    return this.rowToView(stored, pull.headSha, index.last_indexed_sha, index, await this.timeline(prId));
  }

  /**
   * The deterministic answer, for every path that must not call a model.
   *
   * The prose is left EMPTY on purpose. Everything a degraded brief can honestly
   * say is already in `degraded_reason`, and that is an enum the client renders
   * through next-intl — a sentence composed here could not be translated, which
   * is the same reason `BlastIndexReason` is an enum rather than English.
   */
  private async persistDegraded(args: {
    prId: string;
    headSha: string;
    index: BriefView['index'];
    priors: PrHistoryItem[];
    reason: BriefDegradedReason;
    durationMs: number;
    logger?: StructuredLogger;
    correlationId: string;
    provider?: string;
    model?: string;
    prompt?: { system: string; user: string; kept: string[]; dropped: string[]; tokens: number };
  }): Promise<BriefView> {
    const view: BriefView = {
      prose: { what: '', why: '' },
      risk_level: 'low',
      risks: [],
      review_focus: [],
      history: args.priors,
      brief_history: [],
      dropped: noneDropped(),
      meta: {
        provider: args.provider ?? '',
        model: args.model ?? '',
        head_sha: args.headSha,
        indexed_sha: args.index.last_indexed_sha,
        generated_at: new Date().toISOString(),
        stale: false,
      },
      index: args.index,
      status: 'degraded',
      degraded_reason: args.reason,
    };

    const trace: BriefTrace = {
      system: args.prompt?.system ?? '',
      user: args.prompt?.user ?? '',
      provider: args.provider ?? '',
      model: args.model ?? '',
      blocks_kept: args.prompt?.kept ?? [],
      blocks_dropped: args.prompt?.dropped ?? [],
      prompt_tokens_measured: args.prompt?.tokens ?? 0,
      duration_ms: args.durationMs,
      degraded_reason: args.reason,
    };

    const stored = await this.persist(args.prId, view, trace);
    args.logger?.info(
      {
        prId: args.prId,
        correlationId: args.correlationId,
        feature: 'risk_brief',
        call: 'brief',
        degradedReason: args.reason,
        modelCalls: args.reason === 'model_failed' ? 1 : 0,
        indexStatus: args.index.status,
        durationMs: args.durationMs,
      },
      'brief: degraded',
    );

    return this.rowToView(
      stored,
      args.headSha,
      args.index.last_indexed_sha,
      args.index,
      await this.timeline(args.prId),
    );
  }

  /**
   * The current row and one timeline entry, in ONE transaction (AC-43, AC-48).
   *
   * Both writes belong to the same business operation: a brief that is stored
   * without its history entry has silently lost a generation, and an entry
   * without its brief describes a reading nobody can read.
   */
  private persist(prId: string, view: BriefView, trace: BriefTrace): Promise<PrBriefRow> {
    return this.repo.transaction(async (tx) => {
      const row = await this.repo.upsert(
        {
          prId,
          json: view,
          headSha: view.meta.head_sha,
          indexedSha: view.meta.indexed_sha,
          provider: view.meta.provider,
          model: view.meta.model,
          status: view.status,
          degradedReason: view.degraded_reason,
          trace,
        },
        tx,
      );
      await this.repo.appendHistory(
        {
          prId: row.prId,
          headSha: view.meta.head_sha,
          riskLevel: view.risk_level,
          what: view.prose.what,
        },
        tx,
      );
      return row;
    });
  }

  // --- reads ---------------------------------------------------------------

  private async timeline(prId: string): Promise<BriefHistoryEntry[]> {
    const rows = await this.repo.history(prId, MAX_BRIEF_HISTORY);
    return rows.map((r) => ({
      head_sha: r.headSha,
      generated_at: r.generatedAt.toISOString(),
      risk_level: (r.riskLevel === 'high' || r.riskLevel === 'medium' ? r.riskLevel : 'low'),
      what: r.what,
    }));
  }

  /**
   * The stored payload, with the three things that must never be replayed from
   * it: the index state, the timeline, and `stale`.
   *
   * `stale` is derived on READ against BOTH shas. A brief rots when the PR moves
   * AND when the repo is re-indexed under it; one stored flag could not catch
   * the second, and a stale brief that still looks current is worse than none
   * (AC-24). A row with no recorded head predates the tracking and counts stale.
   */
  private rowToView(
    row: PrBriefRow,
    currentHeadSha: string,
    currentIndexedSha: string,
    index: BriefView['index'],
    briefHistory: BriefHistoryEntry[],
  ): BriefView {
    const stored = row.json as BriefView;
    return {
      ...stored,
      brief_history: briefHistory,
      index,
      meta: {
        ...stored.meta,
        stale:
          !row.headSha ||
          row.headSha !== currentHeadSha ||
          row.indexedSha !== currentIndexedSha,
      },
    };
  }

  // --- fact gathering ------------------------------------------------------

  /**
   * The `closes #123` link, matched with the SAME pattern the intent layer uses
   * so "linked issue" means one thing across the product.
   *
   * A failure is recorded with a status and NO content (AC-11): a brief must be
   * able to say "there is an issue I could not read", which is different from
   * "this PR links nothing" and caps what `why` may assert.
   */
  private async resolveLinkedIssue(
    ref: RepoRef,
    body: string | null,
  ): Promise<{ ref: string; status: 'ok' | 'absent' | 'unreachable'; text: string | null }> {
    const number = (body ?? '').match(LINKED_ISSUE_RE)?.[1];
    if (!number) return { ref: 'none', status: 'absent', text: null };
    const label = `#${number}`;
    const github = await this.githubOrNull();
    if (!github) return { ref: label, status: 'unreachable', text: null };
    try {
      const issue = await github.getIssue(ref, Number(number));
      const text = `${issue.title}\n\n${(issue.body ?? '').slice(0, PROMPT_MAX_ISSUE_CHARS)}`.trim();
      return { ref: label, status: 'ok', text };
    } catch {
      return { ref: label, status: 'unreachable', text: null };
    }
  }

  /**
   * The standing spec/plan candidates, read from the clone through the existing
   * port. Only reported when they EXIST — L03's rule, kept so a repository
   * without a SPEC.md does not spend prompt on five absences.
   *
   * `MockGitClient.readFile` (and some git ports) resolve a MISSING path to `''`
   * rather than rejecting, so blank content is treated as absent.
   */
  private async readSpecFiles(ref: RepoRef): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = [];
    for (const path of SPEC_FILE_CANDIDATES) {
      const raw = await this.container.git.readFile(ref, path).catch(() => null);
      if (raw && raw.trim().length > 0) out.push({ path, text: raw });
    }
    return out;
  }

  /** A clone that is gone at generation time is `clone_unavailable`, not a crash. */
  private async cloneReachable(ref: RepoRef): Promise<boolean> {
    try {
      return Boolean(await this.container.git.currentHead(ref));
    } catch {
      return false;
    }
  }

  /** No token configured is not an error here — it makes the issue `unreachable`. */
  private async githubOrNull(): Promise<GitHubClient | null> {
    try {
      return await this.container.github();
    } catch {
      return null;
    }
  }

  /**
   * Resolve the PR through the reviews repository, which is the workspace-scoped
   * lookup. Neither `pr_brief` nor `pr_brief_history` carries a workspace
   * column, so this is where an id from another workspace becomes a 404 (AC-49).
   */
  private async pullOr404(workspaceId: string, prId: string) {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v && v.length > 0))];
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A sentence-terminating mark: `.`, `!` or `?` (a run of them counts once, so an
 * ellipsis typed as three dots is one) that is followed by whitespace or by the
 * end of the text.
 *
 * The trailing look-ahead is what keeps a file path out of the count. This prose
 * is ABOUT paths — `src/config.ts` carries a dot that terminates nothing, and a
 * bare `[.!?]` count would cut the sentence in half at it.
 */
const SENTENCE_END = /[.!?]+(?=\s|$)/g;

/**
 * The stored form of one prose field: at most three sentences (AC-21), then at
 * most `MAX_PROSE_CHARS` characters.
 *
 * Both halves TRUNCATE. Rejecting a fourth sentence would turn a wordy model
 * into a failed generation, and this brief has four degraded gates already —
 * none of them exists for prose being long. The sentence cap runs first so the
 * character cap measures what is actually kept.
 *
 * Exported for `service.test.ts`: the clamp is a pure function and its own unit,
 * and reaching it through `generate()` would cost a model call and a database.
 */
export function clampProse(text: string): string {
  const trimmed = text.trim();
  let seen = 0;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    if (++seen === MAX_PROSE_SENTENCES) {
      return clamp(trimmed.slice(0, match.index + match[0].length), MAX_PROSE_CHARS);
    }
  }
  return clamp(trimmed, MAX_PROSE_CHARS);
}
