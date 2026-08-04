import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionSkillDraft,
  ConventionsPage,
  Provider,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError } from '../../platform/errors.js';
import { withRetry, withTimeout } from '../../platform/resilience.js';
// Cross-module read through the documented composition seam: a module may
// construct another module's SERVICE (see .dependency-cruiser.cjs).
import { SettingsService } from '../settings/service.js';
import { scoreAdherence } from './adherence.js';
import { deriveConfigRules } from './config-rules.js';
import {
  COMMIT_SAMPLE_COUNT,
  CONFIG_FILES,
  CONFIG_SAMPLE_CAP,
  CONVENTIONS_EXTRACT_JOB_KIND,
  CONVENTIONS_JOB_TIMEOUT_MS,
  DOC_FILES,
  DOC_SAMPLE_COUNT,
  EXTRACTION_CATEGORIES,
  EXTRACTION_CONCURRENCY,
  LLM_MAX_RETRIES,
  LLM_TIMEOUT_MS,
  SOURCE_PER_DIR_CAP,
  SOURCE_SAMPLE_COUNT,
  TEST_SAMPLE_COUNT,
} from './constants.js';
import { dedupeCandidates, dropGeneric, ruleKeyFor } from './dedupe.js';
import { buildSkillDrafts, toCandidateDto, toScanDto } from './helpers.js';
import { buildExtractionPrompt, buildSelectionPrompt } from './prompt.js';
import { ConventionsRepository } from './repository.js';
import {
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  CONVENTION_FILE_SELECTION_SCHEMA_NAME,
  ConventionExtractionSchema,
  ConventionFileSelectionSchema,
} from './schemas.js';
import { fitBudget, toSampleFile } from './sampling.js';
import type { DraftCandidate, SampleFile, SampleSet } from './types.js';
import { verifyCandidates } from './verify.js';

/**
 * Conventions extractor (L02).
 *
 * Pipeline, in order — each stage exists to fix a specific failure of the naive
 * "top-N files → one LLM call" version:
 *
 *   sample (strata)      → the naive sample only sees one layer of the repo
 *   config rules         → deterministic candidates the model cannot hallucinate
 *   select + fan out     → one narrow call per category finds far more than one broad call
 *   dedupe               → the fan-out otherwise restates the same rule N times
 *   verify evidence      → drops claims the clone does not actually contain
 *   score adherence      → separates "a real rule" from "some files happen to agree"
 *   drop generic         → removes advice true of every TypeScript repo
 *   drop rejected        → the user already said no; do not ask again
 *
 * The whole thing runs in a background job, so a slow provider never holds an
 * HTTP connection open.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    // Built from container.db, NOT a container getter — tests construct the
    // service with a bare `{ db }` container (see server/INSIGHTS.md).
    this.repo = new ConventionsRepository(container.db);
  }

  /** Register the extraction job handler (called once at plugin load). */
  registerJobHandler(): void {
    this.container.jobs.register(
      CONVENTIONS_EXTRACT_JOB_KIND,
      async (payload) => {
        const { workspaceId, repoId, scanId } = payload as {
          workspaceId: string;
          repoId: string;
          scanId: string;
        };
        await this.runExtraction(workspaceId, repoId, scanId);
      },
      { timeoutMs: CONVENTIONS_JOB_TIMEOUT_MS },
    );
  }

  // --- reads ---------------------------------------------------------------

  /** Boot-time reaper — see `ConventionsRepository.reapStaleScans`. */
  async reapStaleScans(): Promise<number> {
    return this.repo.reapStaleScans();
  }

  async getPage(workspaceId: string, repoId: string): Promise<ConventionsPage> {
    const [scan, rows] = await Promise.all([
      this.repo.latestScan(workspaceId, repoId),
      this.repo.listCandidates(workspaceId, repoId),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: rows.map(toCandidateDto),
    };
  }

  /**
   * Open a scan row and enqueue the work. Returns the scan so the UI can poll.
   * The one-scan-per-repo invariant lives HERE, not in the route — the handler
   * stays a single service call and the 409 travels as an ordinary AppError.
   */
  async startScan(
    workspaceId: string,
    repoId: string,
  ): Promise<{ scanId: string; jobId: string | null }> {
    if (await this.repo.isScanRunning(workspaceId, repoId)) {
      throw new AppError('scan_in_progress', 'A conventions scan is already running', 409);
    }
    const scan = await this.repo.createScan(workspaceId, repoId);
    let jobId: string | null = null;
    try {
      const job = await this.container.jobs.enqueue(workspaceId, CONVENTIONS_EXTRACT_JOB_KIND, {
        workspaceId,
        repoId,
        scanId: scan.id,
      });
      jobId = job.id;
    } catch (err) {
      // No handler / DB hiccup: close the scan as failed rather than leaving the
      // page spinning on a `running` row that nothing will ever finish.
      await this.repo.updateScan(scan.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      });
    }
    return { scanId: scan.id, jobId };
  }

  // --- writes --------------------------------------------------------------

  /**
   * Accept / reject / edit one candidate.
   *
   * An edit deliberately does NOT recompute `rule_key`. The key is the rule's
   * IDENTITY across scans, not its wording — recomputing it makes the next scan
   * fail to recognise the rule it already proposed, so the model's original
   * phrasing reappears as a second, pending card next to the user's edited one.
   * Keeping the key stable is what lets the upsert preserve both the verdict and
   * the user's wording.
   */
  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: { status?: 'pending' | 'accepted' | 'rejected'; rule?: string; category?: string },
  ): Promise<ConventionCandidate | undefined> {
    const trimmed = patch.rule?.trim();
    const row = await this.repo.updateCandidate(workspaceId, id, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(trimmed ? { rule: trimmed, edited: true } : {}),
    });
    return row ? toCandidateDto(row) : undefined;
  }

  /**
   * Render accepted candidates into an editable skill draft. Persists NOTHING —
   * saving goes through the ordinary `POST /skills`, so the generated skill is
   * versioned, importable and linkable exactly like a hand-written one.
   *
   * Only `accepted` rows are rendered, whatever ids the client posts: a stale
   * cache (or a hand-crafted request) must never bake a rejected or pending
   * rule into a skill an agent will then enforce.
   */
  async skillDraft(
    workspaceId: string,
    repoId: string,
    candidateIds: string[],
    mode: 'merged' | 'per_category',
  ): Promise<ConventionSkillDraft[]> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    const rows = await this.repo.listByIds(workspaceId, candidateIds);
    const scoped = rows.filter((r) => r.repoId === repoId && r.status === 'accepted');
    return buildSkillDrafts(repo?.name ?? 'repo', scoped.map(toCandidateDto), mode);
  }

  // --- the pipeline --------------------------------------------------------

  /** The job body. Never throws — failures land on the scan row. */
  async runExtraction(workspaceId: string, repoId: string, scanId: string): Promise<void> {
    try {
      const repo = await this.container.reposRepo.getById(workspaceId, repoId);
      if (!repo?.clonePath) {
        await this.repo.updateScan(scanId, {
          status: 'error',
          error: 'repo_not_cloned',
          finishedAt: new Date(),
        });
        return;
      }
      const ref: RepoRef = { owner: repo.owner, name: repo.name };

      const { provider, model } = await new SettingsService(this.container).resolveFeatureModel(
        workspaceId,
        'conventions',
      );
      const state = await this.container.repoIntel.getIndexState(repoId);
      const sha = state.lastIndexedSha || (await this.currentHead(ref));

      const samples = await this.collectSamples(repoId, ref);
      await this.repo.updateScan(scanId, {
        provider,
        model,
        sha: sha || null,
        sampleCount: samples.files.length,
      });

      const rejected = await this.repo.rejectedRules(workspaceId, repoId);
      const rejectedKeys = new Set(rejected.map((r) => r.ruleKey));

      const configCandidates = deriveConfigRules(
        samples.files.filter((f) => f.kind === 'config'),
      );
      const llmCandidates = await this.extractWithLlm(
        samples,
        provider as Provider,
        model,
        rejected.map((r) => r.rule),
      );

      const fileContents = new Map(samples.files.map((f) => [f.path, f.content]));
      let candidates = dedupeCandidates([...configCandidates, ...llmCandidates]);
      candidates = verifyCandidates(candidates, fileContents);
      candidates = await scoreAdherence(candidates, this.container.codeIndex, ref);
      candidates = dropGeneric(candidates);
      candidates = candidates.filter((c) => !rejectedKeys.has(c.ruleKey));

      // Stamp the commit the snippets were verified at onto each evidence item.
      // The scan row's sha is not enough: candidates survive later scans via
      // upsert, so a page-level sha would mislabel evidence an older scan found.
      if (sha) {
        candidates = candidates.map((c) => ({
          ...c,
          evidence: c.evidence.map((e) => ({ ...e, sha })),
        }));
      }

      await this.repo.transaction(async (tx) => {
        await this.repo.upsertCandidates(workspaceId, repoId, scanId, candidates, tx);
        await this.repo.updateScan(
          scanId,
          { status: 'done', candidateCount: candidates.length, finishedAt: new Date() },
          tx,
        );
      });
    } catch (err) {
      await this.repo.updateScan(scanId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      });
    }
  }

  private async currentHead(ref: RepoRef): Promise<string> {
    try {
      return await this.container.git.currentHead(ref);
    } catch {
      return '';
    }
  }

  /**
   * Deterministic sampling — no model involved.
   *
   * Four strata rather than one top-N list. Rank alone returns files from
   * whichever layer happens to score highest, so every rule ends up describing
   * that layer; the per-directory cap spreads the source stratum, and tests /
   * configs / docs each contribute conventions that rank-based sampling can
   * never reach (test naming, lint policy, already-written house rules).
   */
  private async collectSamples(repoId: string, ref: RepoRef): Promise<SampleSet> {
    const files: SampleFile[] = [];

    for (const path of CONFIG_FILES.slice(0, CONFIG_SAMPLE_CAP)) {
      const raw = await this.readFile(ref, path);
      if (raw !== null) files.push(toSampleFile(path, 'config', raw));
    }

    let docs = 0;
    for (const path of DOC_FILES) {
      if (docs >= DOC_SAMPLE_COUNT) break;
      const raw = await this.readFile(ref, path);
      if (raw === null) continue;
      files.push(toSampleFile(path, 'doc', raw));
      docs += 1;
    }

    const [sourcePaths, testPaths] = await Promise.all([
      this.container.repoIntel.getRankedSample(repoId, {
        n: SOURCE_SAMPLE_COUNT,
        kind: 'source',
        perDirCap: SOURCE_PER_DIR_CAP,
      }),
      this.container.repoIntel.getRankedSample(repoId, {
        n: TEST_SAMPLE_COUNT,
        kind: 'tests',
      }),
    ]);

    for (const { path } of sourcePaths) {
      const raw = await this.readFile(ref, path);
      if (raw !== null) files.push(toSampleFile(path, 'source', raw));
    }
    for (const { path } of testPaths) {
      const raw = await this.readFile(ref, path);
      if (raw !== null) files.push(toSampleFile(path, 'test', raw));
    }

    const [repoMap, commitSubjects] = await Promise.all([
      this.container.repoIntel
        .getRepoMap(repoId)
        .then((m) => (m.degraded ? '' : m.text))
        .catch(() => ''),
      this.recentCommitSubjects(ref),
    ]);

    return { files: fitBudget(files), repoMap, commitSubjects };
  }

  /**
   * Read one file from the clone. A missing file and an EMPTY file are both
   * "nothing to sample" — some git ports resolve a missing path to `''` rather
   * than rejecting, and an empty slice would otherwise occupy a stratum slot
   * without contributing a single line.
   */
  private async readFile(ref: RepoRef, path: string): Promise<string | null> {
    const raw = await this.container.git.readFile(ref, path).catch(() => null);
    return raw && raw.trim().length > 0 ? raw : null;
  }

  private async recentCommitSubjects(ref: RepoRef): Promise<string[]> {
    try {
      const log = await this.container.git.log(ref);
      return log.slice(0, COMMIT_SAMPLE_COUNT).map((c) => c.message.split('\n')[0]!.trim());
    } catch {
      return [];
    }
  }

  /**
   * Two-step dialogue: the model first picks which files reveal each category,
   * then one scoped call per category extracts from just those files. Passes run
   * concurrently and independently — a category that fails (bad JSON, timeout,
   * rate limit) costs its own findings, never the whole scan.
   */
  private async extractWithLlm(
    samples: SampleSet,
    provider: Provider,
    model: string,
    rejectedRules: string[],
  ): Promise<DraftCandidate[]> {
    if (samples.files.length === 0) return [];

    let llm;
    try {
      llm = await this.container.llm(provider);
    } catch {
      return []; // no key configured — the config-derived rules still stand
    }

    const selection = await this.selectFiles(llm, samples, model);
    const byPath = new Map(samples.files.map((f) => [f.path, f]));

    const results: DraftCandidate[][] = [];
    for (let i = 0; i < EXTRACTION_CATEGORIES.length; i += EXTRACTION_CONCURRENCY) {
      const batch = EXTRACTION_CATEGORIES.slice(i, i + EXTRACTION_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((category) => {
          const chosen = (selection.get(category) ?? [])
            .map((p) => byPath.get(p))
            .filter((f): f is SampleFile => !!f);
          const files = chosen.length > 0 ? chosen : samples.files;
          return this.extractCategory(llm, category, files, samples, model, rejectedRules);
        }),
      );
      for (const r of settled) if (r.status === 'fulfilled') results.push(r.value);
    }
    return results.flat();
  }

  private async selectFiles(
    llm: Awaited<ReturnType<Container['llm']>>,
    samples: SampleSet,
    model: string,
  ): Promise<Map<ConventionCategory, string[]>> {
    const out = new Map<ConventionCategory, string[]>();
    try {
      const { system, user } = buildSelectionPrompt(samples);
      const res = await withTimeout(
        llm.completeStructured({
          model,
          schema: ConventionFileSelectionSchema,
          schemaName: CONVENTION_FILE_SELECTION_SCHEMA_NAME,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        LLM_TIMEOUT_MS,
      );
      for (const s of res.data.selections) out.set(s.category, s.paths);
    } catch {
      // Selection is an optimisation, not a gate — every pass falls back to the
      // full sample set when it fails.
    }
    return out;
  }

  private async extractCategory(
    llm: Awaited<ReturnType<Container['llm']>>,
    category: ConventionCategory,
    files: SampleFile[],
    samples: SampleSet,
    model: string,
    rejectedRules: string[],
  ): Promise<DraftCandidate[]> {
    const { system, user } = buildExtractionPrompt(category, files, samples, rejectedRules);
    const res = await withRetry(
      () =>
        withTimeout(
          llm.completeStructured({
            model,
            schema: ConventionExtractionSchema,
            schemaName: CONVENTION_EXTRACTION_SCHEMA_NAME,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          LLM_TIMEOUT_MS,
        ),
      { retries: LLM_MAX_RETRIES },
    );

    return res.data.conventions.map((c) => ({
      category,
      rule: c.rule.trim(),
      ...(c.rationale ? { rationale: c.rationale.trim() } : {}),
      // Marked `exact` provisionally; verify.ts re-grounds every item and
      // rewrites this to `relocated` (or drops it) against the real file.
      evidence: c.evidence.map((e) => ({
        path: e.path,
        line: e.line,
        snippet: e.snippet,
        verified: 'exact' as const,
      })),
      confidence: c.confidence,
      origin: 'llm' as const,
      ...(c.probe ? { probe: c.probe } : {}),
      ruleKey: ruleKeyFor(c.rule),
    }));
  }
}
