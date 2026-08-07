import type { GitHubClient, PrIntent, Provider, UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { randomUUID } from 'node:crypto';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { logPromptAssembly } from '../../platform/prompt-log.js';
import { loadDiff } from '../_shared/diff-loader.js';
// Cross-module read through the documented composition seam: a module may
// construct another module's SERVICE (see .dependency-cruiser.cjs).
import { SettingsService } from '../settings/service.js';
import { INTENT_LLM_MAX_RETRIES, INTENT_LLM_TIMEOUT_MS } from './constants.js';
import { capConfidence, loggableSources, renderIntentBlock, rowToDto } from './helpers.js';
import { buildIntentPrompt } from './prompt.js';
import { IntentRepository } from './repository.js';
import { INTENT_SCHEMA_NAME, IntentClassificationSchema } from './schemas.js';
import { resolveSources } from './sources.js';
import type { IntentTrace, ResolvedSource } from './types.js';

/** Minimal structured logger (pino-compatible: (obj, msg)). */
type Logger = { info: (obj: unknown, msg?: string) => void };

export interface ClassifyOptions {
  /** The already-loaded diff. Supplied by the review run so it is loaded once. */
  diff?: UnifiedDiff;
  /** Live-log sink (the review run's SSE logger). */
  onEvent?: (msg: string) => void;
  logger?: Logger;
  /**
   * Ties this call to the review that triggered it. Supplied by the run
   * executor; generated here when the classifier is invoked on its own from
   * `POST /pulls/:id/intent`.
   */
  correlationId?: string;
}

/**
 * L03 — the intent layer.
 *
 * One cheap LLM call that reads PR METADATA ONLY (title, body, linked issue,
 * referenced spec, and a file map with hunk headers — never diff bodies) and
 * states what the PR is for. Deliberately its own module rather than part of
 * `reviews`: it needs GitHub, git, settings and an LLM call of its own, and it
 * is not in `reviewer-core` because that package is pure.
 *
 * It runs INLINE, not through `JobRunner`. One flash call has no 450s worst
 * case, so it needs neither a per-kind timeout budget nor a boot reaper — unlike
 * the conventions scan, which needs both.
 *
 * It gets NO `agent_runs` row: that would pollute `/pulls/:id/runs`, the run
 * history UI, and `total_cost_usd`. Its cost lives in `pr_intent.trace`.
 */
export class IntentService {
  private repo: IntentRepository;

  constructor(private container: Container) {
    // Built from container.db, NOT a container getter — tests construct services
    // with a bare `{ db }` container (see server/INSIGHTS.md).
    this.repo = new IntentRepository(container.db);
  }

  /** The PR's stored intent, with `stale` derived against its current head. */
  async get(workspaceId: string, prId: string): Promise<PrIntent | null> {
    const pull = await this.pullOr404(workspaceId, prId);
    const row = await this.repo.get(prId);
    return row ? rowToDto(row, pull.headSha) : null;
  }

  /** Render the reviewer prompt's `## Derived intent` body (see helpers). */
  renderBlock(intent: PrIntent): string {
    return renderIntentBlock(intent);
  }

  /**
   * Classify (or re-classify) one PR and persist the result.
   *
   * Always overwrites: an intent is a statement about a specific head, so a
   * re-run is a replacement, never a merge.
   */
  async classify(
    workspaceId: string,
    prId: string,
    opts: ClassifyOptions = {},
  ): Promise<PrIntent> {
    const started = Date.now();
    const pull = await this.pullOr404(workspaceId, prId);
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');
    const ref = { owner: repoRow.owner, name: repoRow.name };

    const diff =
      opts.diff ??
      (await loadDiff(
        this.container,
        this.container.reviewRepo,
        ref,
        pull.base,
        pull.headSha,
        prId,
      ));
    const sources = await resolveSources({
      pull: { title: pull.title, body: pull.body },
      repo: ref,
      diff,
      github: await this.githubOrNull(),
      git: this.container.git,
    });

    const { provider, model } = await new SettingsService(this.container).resolveFeatureModel(
      workspaceId,
      'review_intent',
    );
    const llm = await this.container.llm(provider as Provider);
    const { system, user } = buildIntentPrompt(sources);
    const correlationId = opts.correlationId ?? randomUUID();

    // Metadata-only record of the classifier's prompt, emitted BEFORE the call
    // so it survives a provider failure. One row per resolved source, because
    // "which sources did it actually get" is the question this call raises.
    logPromptAssembly(
      opts.logger,
      this.container.config.promptLog,
      { correlationId, call: 'intent', provider, model, prId },
      [
        { section: 'system', source: 'intent classifier rules', text: system },
        ...sources.map((s) => ({
          section: `source:${s.kind}`,
          source: `${s.ref} (${s.status})`,
          text: s.content,
        })),
      ],
      (text) => this.container.tokenizer.count(text),
    );

    const res = await withRetry(
      () =>
        withTimeout(
          llm.completeStructured({
            model,
            schema: IntentClassificationSchema,
            schemaName: INTENT_SCHEMA_NAME,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          INTENT_LLM_TIMEOUT_MS,
        ),
      { retries: INTENT_LLM_MAX_RETRIES },
    );

    // The model's confidence is an upper bound to be lowered against what we
    // could actually read, never a measurement to be trusted.
    const confidence = capConfidence(res.data.confidence, sources);
    const trace: IntentTrace = {
      system,
      user,
      provider,
      model,
      tokens_in: res.tokensIn,
      tokens_out: res.tokensOut,
      cost_usd: res.costUsd,
      raw_confidence: res.data.confidence,
      duration_ms: Date.now() - started,
    };

    const row = await this.repo.upsert({
      prId,
      summary: res.data.summary.trim(),
      inScope: res.data.in_scope,
      outOfScope: res.data.out_of_scope,
      riskAreas: res.data.risk_areas,
      sources: sources.map(({ content: _content, ...rest }) => rest),
      confidence,
      provider,
      model,
      headSha: pull.headSha,
      trace,
    });

    // IDs and statuses only — never a character of source text. The full prompt
    // is in `pr_intent.trace`, which is DB-only and never reaches stdout.
    opts.logger?.info(
      {
        prId,
        correlationId,
        feature: 'review_intent',
        provider,
        model,
        promptTokens: res.tokensIn,
        sources: loggableSources(sources),
        confidence,
      },
      'intent: classified',
    );
    opts.onEvent?.(this.liveLogLine(provider, model, res.tokensIn, confidence, sources));

    return rowToDto(row, pull.headSha);
  }

  // --- internals -----------------------------------------------------------

  /**
   * Resolve the PR through the reviews repository, which is the workspace-scoped
   * lookup. `pr_intent` itself carries no workspace column, so this is where an
   * id from another workspace is turned into a 404.
   */
  private async pullOr404(workspaceId: string, prId: string) {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  /** No token configured is not an error here — it makes issue lookups `unreachable`. */
  private async githubOrNull(): Promise<GitHubClient | null> {
    try {
      return await this.container.github();
    } catch {
      return null;
    }
  }

  /** One Live Log line, so the two model calls of a review are visibly distinct. */
  private liveLogLine(
    provider: string,
    model: string,
    tokens: number,
    confidence: string,
    sources: ResolvedSource[],
  ): string {
    const unreachable = sources.filter((s) => s.status === 'unreachable').length;
    return (
      `intent: classified with ${provider}/${model} (≈${tokens} tok, ` +
      `confidence=${confidence}, ${sources.length} source(s), ${unreachable} unreachable)`
    );
  }
}
