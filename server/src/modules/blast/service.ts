import type {
  BlastIndexState,
  BlastSummaryMeta,
  PrBlastRadius,
  PrBlastResponse,
  Provider,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { withRetry, withTimeout } from '../../platform/resilience.js';
// Cross-module read through the documented composition seam: a module may
// construct another module's SERVICE (see .dependency-cruiser.cjs).
import { SettingsService } from '../settings/service.js';
import type { PrBlastSummaryRow } from './repository.js';
import { BlastRepository } from './repository.js';
import { buildBlast } from './build.js';
import { deriveIndexState } from './status.js';
import { buildBlastSummaryPrompt } from './prompt.js';
import { BLAST_SUMMARY_SCHEMA_NAME, BlastSummarySchema } from './schemas.js';
import {
  BFS_DEPTH,
  MAX_SUMMARY_CHARS,
  SUMMARY_LLM_MAX_RETRIES,
  SUMMARY_LLM_TIMEOUT_MS,
} from './constants.js';

/** Minimal structured logger (pino-compatible: (obj, msg)). */
type Logger = { info: (obj: unknown, msg?: string) => void };

/**
 * L04 - the blast radius of one PR.
 *
 * THE WHOLE READ IS FREE. Every fact served here was computed by the indexer
 * and is sitting in Postgres: symbols, resolved references, file ranks, import
 * edges, per-file endpoint/cron facts. No model is consulted, no clone is read,
 * and no index is rebuilt on the request path. The only LLM call in this module
 * is `summarize`, behind an explicit button.
 *
 * The ORDER of the first three steps in `load` is itself the contract:
 *
 *  1. Resolve the PR workspace-scoped, so an id from another workspace 404s
 *     before any repo data is touched.
 *  2. Read index health and derive the honest status.
 *  3. HARD GATE on `degraded` - return an empty envelope WITHOUT calling
 *     `getBlastRadius`, because that facade's fallback branch reads the clone
 *     and shells out to ripgrep. "The server must not rebuild an index during a
 *     request" is guaranteed by not entering the branch, not by hoping nobody
 *     does. The gate lives in the SERVICE, never in the route (L02's lesson).
 */
export class BlastService {
  private repo: BlastRepository;

  constructor(private container: Container) {
    // Built from container.db, NOT a container getter - tests construct services
    // with a bare `{ db }` container (see server/INSIGHTS.md).
    this.repo = new BlastRepository(container.db);
  }

  /** The PR's blast radius, plus whatever summary has already been generated. */
  async get(workspaceId: string, prId: string): Promise<PrBlastResponse> {
    return (await this.load(workspaceId, prId)).response;
  }

  /**
   * Generate (or regenerate) the impact summary, then return the WHOLE envelope
   * so the client can seed its cache in one tick.
   *
   * Refuses rather than spending a token when there is nothing to summarise: an
   * unusable index or a PR with no indexed symbols would produce a confident
   * paragraph about an empty list.
   */
  async summarize(
    workspaceId: string,
    prId: string,
    opts: { logger?: Logger } = {},
  ): Promise<PrBlastResponse> {
    const loaded = await this.load(workspaceId, prId);
    const { blast, index } = loaded.response;
    if (index.status === 'degraded') {
      throw new AppError(
        'blast_not_indexed',
        'This repository has no usable index yet, so there is no impact to summarise. Re-analyze the repository first.',
        409,
      );
    }
    if (blast.changed_symbols.length === 0) {
      throw new AppError(
        'blast_empty',
        'No indexed symbols were found in this PR’s changed files, so there is nothing to summarise.',
        409,
      );
    }

    const started = Date.now();
    const { provider, model } = await new SettingsService(this.container).resolveFeatureModel(
      workspaceId,
      // The registry already carries this feature ("assesses merge risks for a
      // pull request"), so no new FEATURE_MODELS entry and no settings UI change.
      'risk_brief',
    );
    const llm = await this.container.llm(provider as Provider);
    const { system, user } = buildBlastSummaryPrompt(blast, index);

    const res = await withRetry(
      () =>
        withTimeout(
          llm.completeStructured({
            model,
            schema: BlastSummarySchema,
            schemaName: BLAST_SUMMARY_SCHEMA_NAME,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          SUMMARY_LLM_TIMEOUT_MS,
        ),
      { retries: SUMMARY_LLM_MAX_RETRIES },
    );

    const text = clamp(res.data.summary.trim(), MAX_SUMMARY_CHARS);
    const row = await this.repo.upsert({
      prId,
      text,
      headSha: loaded.headSha,
      indexedSha: index.last_indexed_sha,
      provider,
      model,
    });

    // IDs, counts and cost only - never a character of the digest. This one line
    // plus the response IS the observability story for this call: it writes no
    // `agent_runs` row, for the same reason `IntentService` does not.
    opts.logger?.info(
      {
        prId,
        feature: 'risk_brief',
        call: 'blast_summary',
        provider,
        model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        symbols: blast.changed_symbols.length,
        indexStatus: index.status,
        durationMs: Date.now() - started,
      },
      'blast: summarized',
    );

    return {
      ...loaded.response,
      blast: { ...blast, summary: text },
      summary: rowToMeta(row, loaded.headSha, index.last_indexed_sha),
    };
  }

  // --- internals -----------------------------------------------------------

  private async load(
    workspaceId: string,
    prId: string,
  ): Promise<{ response: PrBlastResponse; headSha: string }> {
    // 1. TENANCY FIRST.
    const pull = await this.pullOr404(workspaceId, prId);
    const summaryRow = await this.repo.get(prId);

    // 2. Honest index health.
    const health = await this.container.repoIntel.getIndexHealth(pull.repoId);
    const index = deriveIndexState(health);
    const summary = summaryRow ? rowToMeta(summaryRow, pull.headSha, index.last_indexed_sha) : null;

    // 3. HARD GATE - see the class comment.
    if (index.status === 'degraded') {
      return this.envelope(empty(summaryRow?.text ?? ''), summary, index, 0, pull.headSha);
    }

    // The cheap path to the changed files: one indexed SELECT over `pr_files`.
    // NOT `PullsService.detail` (calls GitHub on every request) and NOT
    // `loadDiff` (runs a real `git diff`).
    const files = (await this.container.reviewRepo.getPrFiles(prId)).map((f) => f.path);
    if (files.length === 0) {
      return this.envelope(empty(summaryRow?.text ?? ''), summary, index, 0, pull.headSha);
    }

    const [result, reverse] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, files),
      // Skip the walk entirely when there is no graph to walk. `graph_failed` /
      // `soft_budget` in the index state is what explains the missing endpoints.
      health.edgesWritten > 0
        ? this.container.repoIntel.getReverseImporters(pull.repoId, files, BFS_DEPTH)
        : Promise.resolve([]),
    ]);

    // Facts are needed for every file either path reached, not just the callers:
    // a changed route file's own endpoint counts, and so does one two hops out.
    const factFiles = new Set<string>(files);
    for (const c of result.callers) factFiles.add(c.file);
    for (const level of reverse) for (const i of level.importers) factFiles.add(i.file);
    const facts = await this.container.repoIntel.getFileFactsFor(pull.repoId, [...factFiles]);

    const blast = buildBlast({ result, reverse, facts, summary: summaryRow?.text ?? '' });
    return this.envelope(blast, summary, index, files.length, pull.headSha);
  }

  private envelope(
    blast: PrBlastRadius,
    summary: BlastSummaryMeta | null,
    index: BlastIndexState,
    changedFiles: number,
    headSha: string,
  ): { response: PrBlastResponse; headSha: string } {
    return {
      response: {
        blast,
        summary,
        index,
        changed_files: changedFiles,
        computed_at: new Date().toISOString(),
      },
      headSha,
    };
  }

  /**
   * Resolve the PR through the reviews repository, which is the workspace-scoped
   * lookup. `pr_blast_summary` carries no workspace column, so this is where an
   * id from another workspace becomes a 404.
   */
  private async pullOr404(workspaceId: string, prId: string) {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}

/** The honest empty answer: no symbols, no downstream, whatever summary exists. */
function empty(summary: string): PrBlastRadius {
  return { changed_symbols: [], downstream: [], symbols_total: 0, summary };
}

/**
 * `stale` is derived on READ against BOTH shas. A summary rots when the PR moves
 * AND when the repo is re-indexed under it; one stored flag could not catch the
 * second, and a stale summary that still looks current is worse than none.
 */
function rowToMeta(
  row: PrBlastSummaryRow,
  headSha: string,
  indexedSha: string,
): BlastSummaryMeta {
  return {
    text: row.text,
    provider: row.provider ?? '',
    model: row.model ?? '',
    generated_at: row.generatedAt.toISOString(),
    stale: row.headSha !== headSha || row.indexedSha !== indexedSha,
  };
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
