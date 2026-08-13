import { randomUUID } from 'node:crypto';
import {
  Onboarding,
  type OnboardingDegradedReason,
  type OnboardingGeneration,
  type OnboardingPage,
  type OnboardingSection,
  type OnboardingUsage,
  type Provider,
  type RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import { renderPrompt } from '../../platform/prompts.js';
import {
  logPromptAssembly,
  scrubSecrets,
  type StructuredLogger,
} from '../../platform/prompt-log.js';
// Cross-module read through the documented composition seam: a module may
// construct another module's SERVICE (see .dependency-cruiser.cjs).
import { SettingsService } from '../settings/service.js';
import { OnboardingRepository } from './repository.js';
import {
  COMMIT_DISTANCE_MAX_COUNT,
  EXCERPT_CUTOFF_INDEXED_FILES,
  FACT_FILES,
  GENERATE_JOB_KIND,
  GOOD_FIRST_ISSUE_LABEL,
  JOB_TIMEOUT_MS,
  MARKER_PATTERN,
  MAX_EXCERPT_FILES,
  MAX_EXCERPT_LINES,
  MAX_HEURISTIC_FILES,
  MAX_ISSUES,
  MAX_PATH_PROBES,
  MAX_RANKED_FILES,
  MAX_SCHEMA_REPAIRS,
  MODEL_TIMEOUT_MS,
  PROMPT_TOKEN_CEILING,
  REPO_MAP_BUDGETS,
} from './constants.js';
import { extractFacts, isPresent } from './facts.js';
import {
  criticalCandidates,
  heuristicCandidates,
  readingCandidates,
} from './candidates.js';
import { assemblePrompt, capExcerpts } from './prompt.js';
import { ONBOARDING_SCHEMA_NAME, OnboardingDraft } from './schemas.js';
import { collectDraftPaths, verifyDraft } from './verify.js';
import { deterministicSections, mergeSections } from './skeleton.js';
import type {
  AssembledPrompt,
  CandidateSets,
  CollectedFacts,
  Excerpt,
  FactFile,
  InFlight,
  IssueRow,
  MarkerRow,
} from './types.js';

/**
 * L06 — the onboarding tour: facts DevDigest already holds, plus EXACTLY ONE
 * structured model call, turned into five fixed sections, verified against the
 * clone at the generation commit, and persisted with its provenance and cost.
 *
 * Three properties this class exists to hold:
 *
 *  - **One call per generation.** No `withRetry` around `completeStructured`
 *    (that would re-issue the whole call), and the job registers at
 *    `retries: 0` so the queue cannot re-run a handler that already spent
 *    money.
 *  - **No path resolves to a bare error.** A missing index, unavailable issues,
 *    a failed model call and an unparseable stored document all resolve to a
 *    readable tour with a stated reason.
 *  - **Nothing the client says is a path.** The read list is a module constant
 *    and every other path comes from `repo-intel` or from the model and is then
 *    checked against the clone, so the path-traversal class is removed by
 *    construction rather than defended against.
 *
 * Tenancy is this layer's job: `onboarding` has no `workspace_id`, so every
 * entry point resolves its repository through
 * `container.reposRepo.getById(workspaceId, repoId)` first.
 */
export class OnboardingService {
  private repo: OnboardingRepository;

  /**
   * One generation in flight per repository, on the SINGLE service instance the
   * routes plugin constructs. In memory rather than a `running` row on purpose:
   * any table with a `running` status needs a boot reaper, and a crashed
   * generation would otherwise leave a row that permanently blocks the feature.
   * The cost is that the guard is per process — named here so the tradeoff is
   * visible rather than assumed.
   */
  private inFlight = new Map<string, InFlight>();

  constructor(
    private container: Container,
    private logger?: StructuredLogger,
  ) {
    // Built from container.db, NOT a container getter — tests construct
    // services with a bare `{ db }` container (see server/INSIGHTS.md).
    this.repo = new OnboardingRepository(container.db);
  }

  /**
   * Register the generation job. `retries: 0` is load-bearing, not tidiness:
   * the runner otherwise wraps every handler in `withRetry` at 2, so any throw
   * AFTER a successful model call would re-run the handler — and re-issue the
   * call — up to three times per click, breaking AC-12 one layer above the
   * layer where this plan bans exactly that.
   */
  registerGenerateJobHandler(): void {
    this.container.jobs.register(
      GENERATE_JOB_KIND,
      async (payload) => {
        const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
        await this.generate(workspaceId, repoId);
      },
      { timeoutMs: JOB_TIMEOUT_MS, retries: 0 },
    );
  }

  // ---- read path ----------------------------------------------------------

  /**
   * The whole page in one read: the stored tour, whether the clone exists,
   * whether a generation is running, and how far the head has moved.
   *
   * Budgeted at 300 ms, which is why `git.log` runs ONLY when the sha has
   * actually moved, and even then with an explicit `maxCount`.
   */
  async read(workspaceId: string, repoId: string): Promise<OnboardingPage> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const currentHead = repo.clonePath ? await this.currentHeadOrNull(ref) : null;
    const row = await this.repo.get(repoId);
    const tour = row ? this.parseStoredTour(repoId, row.json) : null;

    let stale = false;
    let commitsBehind: number | null = null;
    if (tour && currentHead && currentHead !== tour.head_sha) {
      stale = true;
      commitsBehind = await this.commitsBehind(ref, tour.head_sha);
    }

    return {
      repo_id: repoId,
      clone: currentHead ? 'ready' : 'absent',
      tour,
      generation: this.generationState(repoId),
      current_head_sha: currentHead,
      stale,
      commits_behind: commitsBehind,
    };
  }

  /**
   * Claim the single-flight slot and enqueue a generation, then return the page
   * immediately — the generation is NOT awaited in the request, which is why
   * AC-39's phase is polled rather than streamed.
   *
   * The slot is claimed HERE rather than inside the handler so a second request
   * arriving while the first is still QUEUED is refused too, instead of being
   * queued behind it. It is released when the job settles, whatever way it
   * settles.
   */
  async requestGeneration(workspaceId: string, repoId: string): Promise<OnboardingPage> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    if (!repo.clonePath || !(await this.currentHeadOrNull(ref))) {
      throw new AppError(
        'clone_missing',
        'The repository has no clone on disk yet — a tour cannot be generated',
        409,
      );
    }
    if (this.inFlight.has(repoId)) {
      throw new AppError(
        'generation_in_progress',
        'A tour generation is already running for this repository',
        409,
      );
    }

    const slot: InFlight = {
      promise: Promise.resolve(),
      phase: 'facts',
      startedAt: new Date().toISOString(),
    };
    this.inFlight.set(repoId, slot);

    try {
      const job = await this.container.jobs.enqueue(workspaceId, GENERATE_JOB_KIND, {
        workspaceId,
        repoId,
      });
      slot.promise = job.done.catch(() => undefined);
      void slot.promise.finally(() => this.inFlight.delete(repoId));
    } catch (err) {
      // Nothing will ever run, so nothing must ever be blocked by it.
      this.inFlight.delete(repoId);
      throw err;
    }

    return this.read(workspaceId, repoId);
  }

  // ---- generation ---------------------------------------------------------

  /**
   * Generate, verify and persist one tour. Never throws for a modelling
   * failure: a failed call persists the deterministic skeleton as `degraded`,
   * which is what the page renders and what a Retry replaces.
   */
  async generate(workspaceId: string, repoId: string): Promise<void> {
    const started = Date.now();
    const correlationId = randomUUID();
    const repo = await this.requireRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const collected = await this.collectFacts(repoId, ref);
    const base = deterministicSections({
      facts: collected.facts,
      candidates: collected.candidates,
      rankPercentile: (p) => collected.rankPercentile.get(p) ?? null,
    });

    const { provider, model } = await new SettingsService(this.container).resolveFeatureModel(
      workspaceId,
      'onboarding',
    );

    const reasons = [...collected.reasons];
    let sections = base;
    let usage: OnboardingUsage | null = null;
    let droppedRows = 0;
    let droppedSteps = 0;
    let assembled: AssembledPrompt | null = null;
    let failure: string | null = null;

    try {
      this.setPhase(repoId, 'model');
      assembled = await this.assembleWithinBudget(repoId, collected, repo.fullName);

      const system = await this.renderSystemPrompt();
      // Metadata-only, emitted BEFORE the call so it survives a provider
      // failure. `logPromptAssembly` takes text and returns only measurements,
      // so no file content and no model output can reach a log by construction.
      logPromptAssembly(
        this.logger,
        this.container.config.promptLog,
        { correlationId, call: 'onboarding', provider, model },
        [{ section: 'system', source: 'prompts/onboarding.system.md', text: system }, ...assembled.sections],
        (text) => this.container.tokenizer.count(text),
      );

      const llm = await this.container.llm(provider as Provider);
      // EXACTLY ONE call. Deliberately NOT wrapped in `withRetry`: that would
      // re-issue the whole call and break the one-call property this feature
      // exists to demonstrate. The provider's own repair loop runs
      // `maxRetries + 1` attempts, which bounds `attempts` at 3.
      const res = await withTimeout(
        llm.completeStructured({
          model,
          schema: OnboardingDraft,
          schemaName: ONBOARDING_SCHEMA_NAME,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: assembled.user },
          ],
          maxRetries: MAX_SCHEMA_REPAIRS,
        }),
        MODEL_TIMEOUT_MS,
      );

      this.setPhase(repoId, 'verifying');
      const known = await this.probePaths(ref, collected, res.data);
      const verified = verifyDraft(res.data, {
        exists: (p) => known.has(p),
        repoFullName: repo.fullName,
        headSha: collected.headSha,
        readingCandidates: new Set(collected.candidates.reading),
        criticalCandidates: new Set(collected.candidates.critical),
        rankPercentile: (p) => collected.rankPercentile.get(p) ?? null,
        markers: collected.candidates.markers,
        issueNumbers: new Set(collected.candidates.issues.map((i) => i.number)),
        usedGraph: collected.candidates.usedGraph,
      });

      sections = mergeSections(base, verified.sections, collected.candidates.usedGraph);
      droppedRows = verified.droppedRows;
      droppedSteps = verified.droppedSteps;
      usage = {
        calls: 1,
        provider,
        model: res.model,
        tokens_in: res.tokensIn,
        tokens_out: res.tokensOut,
        cost_usd: res.costUsd,
        attempts: res.attempts,
        duration_ms: Date.now() - started,
      };
    } catch (err) {
      // A failure, a timeout, or output that could not be repaired: the
      // deterministic skeleton IS the tour, and the page offers Retry.
      failure = scrubSecrets(err instanceof Error ? err.message : String(err));
      reasons.push('model_failed');
      usage = {
        calls: 1,
        provider,
        model,
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
        attempts: 1,
        duration_ms: Date.now() - started,
      };
    }

    const deduped = [...new Set(reasons)];
    const document: Onboarding = {
      repo_id: repoId,
      status: deduped.length > 0 ? 'degraded' : 'ready',
      degraded_reasons: deduped,
      head_sha: collected.headSha,
      index_sha: collected.indexSha,
      files_indexed: collected.filesIndexed,
      files_skipped: collected.filesSkipped,
      excerpts_used: assembled?.excerptsUsed ?? 0,
      dropped_rows: droppedRows,
      dropped_steps: droppedSteps,
      generated_at: new Date().toISOString(),
      sections,
      usage,
    };

    // The ONLY write, and it happens at the end — which is what keeps the
    // previous tour readable throughout a regeneration and replaces it
    // atomically when the new one lands.
    await this.repo.upsert(repoId, {
      document,
      headSha: document.head_sha,
      status: document.status,
    });

    // One structured line per generation. Ids, counts and measurements only —
    // never a character of file content or model output. Free-text from a
    // provider goes through `scrubSecrets` first.
    this.logger?.info(
      {
        repoId,
        correlationId,
        feature: 'onboarding',
        provider,
        model,
        attempts: usage?.attempts ?? 0,
        promptTokens: assembled?.tokens ?? 0,
        excerptsUsed: document.excerpts_used,
        sections: sections.map((s) => ({ kind: s.kind, status: s.status })),
        reasons: deduped,
        droppedRows,
        droppedSteps,
        durationMs: usage?.duration_ms ?? Date.now() - started,
        ...(failure ? { error: failure } : {}),
      },
      'onboarding: tour generated',
    );
  }

  // ---- deterministic fact collection --------------------------------------

  /**
   * The deterministic pass, in the order the phases are reported.
   *
   * Nothing here can fail a generation. A file that will not read drops that
   * one fact; an unavailable index drops to the heuristic; unavailable issues
   * record a reason and continue.
   */
  private async collectFacts(repoId: string, ref: RepoRef): Promise<CollectedFacts> {
    const reasons: OnboardingDegradedReason[] = [];

    // --- facts: the head FIRST, so every link is pinned to the commit the
    // rest of this pass reads (AC-5).
    this.setPhase(repoId, 'facts');
    const headSha = await this.container.git.currentHead(ref);

    const files: FactFile[] = [];
    for (const path of FACT_FILES) {
      files.push({ path, content: await this.readFileOrBlank(ref, path) });
    }
    const facts = extractFacts(files);

    // --- graph
    this.setPhase(repoId, 'graph');
    const indexState = await this.container.repoIntel.getIndexState(repoId).catch(() => null);
    const filesIndexed = indexState?.filesIndexed ?? 0;
    const filesSkipped = indexState?.filesSkipped ?? 0;
    const indexSha = indexState?.lastIndexedSha ?? null;
    if (!indexState || filesIndexed === 0 || indexState.status === 'failed') {
      reasons.push('no_index');
    } else if (indexState.status === 'partial' || indexState.status === 'degraded') {
      reasons.push('partial_index');
    }
    const tooLarge = filesIndexed > EXCERPT_CUTOFF_INDEXED_FILES;
    if (tooLarge) reasons.push('repo_too_large');

    const [topFiles, chains] = await Promise.all([
      this.container.repoIntel.getTopFilesByRank(repoId, MAX_RANKED_FILES).catch(() => []),
      this.container.repoIntel.getCriticalPaths(repoId).catch(() => []),
    ]);

    // The import graph is what `getTopFilesByRank` needs; an empty result is
    // exactly the unindexed condition the heuristic exists for.
    const usedGraph = topFiles.length > 0;
    const listing = usedGraph
      ? []
      : await this.container.git
          .listFiles(ref, { limit: MAX_HEURISTIC_FILES })
          .catch(() => [] as string[]);
    const pool = usedGraph ? topFiles : heuristicCandidates(listing, MAX_RANKED_FILES);

    const reading = usedGraph
      ? readingCandidates(topFiles)
      : readingCandidates(pool);
    const critical = usedGraph
      ? criticalCandidates(chains, topFiles)
      : criticalCandidates([pool], pool);

    // Without this read, `rank_percentile` would persist null forever.
    const rankPercentile = new Map<string, number>();
    const rankPaths = [...new Set([...reading, ...critical])];
    if (usedGraph && rankPaths.length > 0) {
      const rows = await this.container.repoIntel
        .getFileRank(repoId, rankPaths)
        .catch(() => []);
      for (const row of rows) rankPercentile.set(row.path, row.percentile);
    }

    // --- markers: filtered to the candidate file set, which is what applies
    // the junk-path filter without importing `isJunkPath` (it is module-local
    // to repo-intel and not an exempt cross-module import). The price is that a
    // `TODO` below the ranking cut is invisible.
    this.setPhase(repoId, 'markers');
    const inPool = new Set(pool);
    const markers: MarkerRow[] = (
      await this.container.codeIndex.grep(ref, MARKER_PATTERN).catch(() => [])
    ).filter((m) => inPool.has(m.path));

    // --- issues
    this.setPhase(repoId, 'issues');
    let issues: IssueRow[] = [];
    try {
      const github = await this.container.github();
      issues = await github.listIssues(ref, {
        labels: [GOOD_FIRST_ISSUE_LABEL],
        limit: MAX_ISSUES,
      });
    } catch {
      // Any throw, including the ConfigError a missing GITHUB_TOKEN raises.
      reasons.push('issues_unavailable');
    }

    // --- excerpts: none at all above the size cutoff (AC-10).
    const excerpts: Excerpt[] = [];
    if (!tooLarge) {
      for (const path of pool.slice(0, MAX_EXCERPT_FILES)) {
        const content = await this.readFileOrBlank(ref, path);
        if (isPresent(content)) excerpts.push({ path, content });
      }
    }

    const candidates: CandidateSets = { reading, critical, markers, issues, usedGraph };
    const knownPaths = new Set<string>([
      ...facts.present,
      ...pool,
      ...markers.map((m) => m.path),
      ...excerpts.map((e) => e.path),
    ]);

    return {
      headSha,
      facts,
      candidates,
      excerpts: capExcerpts(excerpts, MAX_EXCERPT_FILES, MAX_EXCERPT_LINES),
      knownPaths,
      rankPercentile,
      filesIndexed,
      filesSkipped,
      indexSha,
      reasons,
    };
  }

  /**
   * The budget ladder (AC-11). `assemblePrompt` drops excerpts, last-ranked
   * first; this loop is the other half — each rung RE-FETCHES the repo map at a
   * smaller budget rather than truncating the string it already has, because a
   * truncated skeleton is a broken skeleton.
   */
  private async assembleWithinBudget(
    repoId: string,
    collected: CollectedFacts,
    repoFullName: string,
  ): Promise<AssembledPrompt> {
    let last: AssembledPrompt | null = null;
    for (const budget of REPO_MAP_BUDGETS) {
      const map =
        budget > 0
          ? await this.container.repoIntel
              .getRepoMap(repoId, budget)
              .then((r) => (r.degraded ? '' : r.text))
              .catch(() => '')
          : '';
      last = assemblePrompt(
        {
          repoFullName,
          headSha: collected.headSha,
          facts: collected.facts,
          repoMap: map,
          excerpts: collected.excerpts,
          candidates: collected.candidates,
          filesIndexed: collected.filesIndexed,
          filesSkipped: collected.filesSkipped,
        },
        (text) => this.container.tokenizer.count(text),
        PROMPT_TOKEN_CEILING,
      );
      if (last.tokens <= PROMPT_TOKEN_CEILING) return last;
    }
    return last!;
  }

  /**
   * Resolve every path the draft mentions against the clone, ONCE, so the
   * verification pass itself stays pure. Paths we already know exist (fact
   * files, ranked candidates, marker files) skip the probe entirely.
   */
  private async probePaths(
    ref: RepoRef,
    collected: CollectedFacts,
    draft: OnboardingDraft,
  ): Promise<Set<string>> {
    const known = new Set(collected.knownPaths);
    const unknown = collectDraftPaths(draft)
      .filter((p) => !known.has(p))
      .slice(0, MAX_PATH_PROBES);
    for (const path of unknown) {
      if (isPresent(await this.readFileOrBlank(ref, path))) known.add(path);
    }
    return known;
  }

  // ---- internals ----------------------------------------------------------

  /** Workspace-scoped repository resolution — the tenancy gate for every entry. */
  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  /**
   * A read that fails drops that ONE fact. Blank counts as absent as well as a
   * throw: `MockGitClient.readFile` resolves a missing path to `''` rather than
   * rejecting, so "it threw" is not the only failure shape.
   */
  private async readFileOrBlank(ref: RepoRef, path: string): Promise<string> {
    try {
      return await this.container.git.readFile(ref, path);
    } catch {
      return '';
    }
  }

  /** No clone, or a clone we cannot read a head from, is the prerequisite state. */
  private async currentHeadOrNull(ref: RepoRef): Promise<string | null> {
    try {
      const head = await this.container.git.currentHead(ref);
      return head.trim().length > 0 ? head : null;
    } catch {
      return null;
    }
  }

  /**
   * How far the head has moved past the tour's commit, or null when that commit
   * is not reachable — a depth-1 clone that has never been resynced holds one
   * commit of history, and the header names both shas instead of a number
   * rather than putting a GitHub round trip on a 300 ms read path.
   */
  private async commitsBehind(ref: RepoRef, tourSha: string): Promise<number | null> {
    try {
      const log = await this.container.git.log(ref, undefined, {
        maxCount: COMMIT_DISTANCE_MAX_COUNT,
      });
      const idx = log.findIndex((c) => c.sha === tourSha);
      return idx === -1 ? null : idx;
    } catch {
      return null;
    }
  }

  /**
   * A stored document that no longer parses must not become an error page
   * (AC-63). It becomes a minimal degraded tour instead, which the user can
   * regenerate.
   */
  private parseStoredTour(repoId: string, json: unknown): Onboarding {
    const parsed = Onboarding.safeParse(json);
    if (parsed.success) return parsed.data;
    return {
      repo_id: repoId,
      status: 'degraded',
      degraded_reasons: ['model_failed'],
      head_sha: '',
      index_sha: null,
      files_indexed: 0,
      files_skipped: 0,
      excerpts_used: 0,
      dropped_rows: 0,
      dropped_steps: 0,
      generated_at: new Date(0).toISOString(),
      sections: this.emptySections(),
      usage: null,
    };
  }

  private emptySections(): OnboardingSection[] {
    return deterministicSections({
      facts: {
        present: [],
        envKeys: [],
        scripts: [],
        services: [],
        stack: [],
        readme: null,
        contributing: null,
      },
      candidates: { reading: [], critical: [], markers: [], issues: [], usedGraph: true },
      rankPercentile: () => null,
    });
  }

  private generationState(repoId: string): OnboardingGeneration {
    const slot = this.inFlight.get(repoId);
    if (!slot) return { status: 'idle', phase: null, started_at: null };
    return { status: 'running', phase: slot.phase, started_at: slot.startedAt };
  }

  private setPhase(repoId: string, phase: NonNullable<OnboardingGeneration['phase']>): void {
    const slot = this.inFlight.get(repoId);
    if (slot) slot.phase = phase;
  }

  /** English only — no language control ships with this feature. */
  private renderSystemPrompt(): Promise<string> {
    return renderPrompt('onboarding.system.md', { language: 'English' });
  }
}
