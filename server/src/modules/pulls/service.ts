import type {
  GitHubClient,
  PrMeta,
  PrDetail,
  PrReviewComment,
  PrCommentInput,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { Logger } from '../_shared/logger.js';
import { noopLogger } from '../_shared/logger.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { RepoRow } from '../repos/repository.js';
import { PullsRepository, type PullRow } from './repository.js';
import { rollupSeverities } from '../_shared/severity.js';
import { deriveReviewStatus, worstLatestScoreByPr } from './status.js';
import { DIFF_STAT_BACKFILL_LIMIT } from './constants.js';

/**
 * F1 — pulls service. Owns PR import/read business logic:
 *   - list  → sync from GitHub (best-effort), backfill diff stats, decorate
 *             each PR with SCORE / FINDINGS / COST read from the reviews module
 *   - detail→ refresh from GitHub, falling back to persisted data when offline
 *   - sync  → the idempotent PR-list import, shared with the polling module
 *   - comments → proxied live to GitHub, never mirrored locally
 *
 * Local-first: a missing GitHub token or a failed call must NEVER fail a read —
 * already-imported PRs stay viewable offline.
 */
export class PullsService {
  private repo: PullsRepository;

  constructor(private container: Container, private log: Logger = noopLogger) {
    this.repo = new PullsRepository(container.db);
  }

  /** GitHub client, or null when no token is configured / it cannot be built. */
  private async githubOrNull(): Promise<GitHubClient | null> {
    try {
      return await this.container.github();
    } catch (err) {
      this.log.warn({ err }, 'GitHub client unavailable (no token / offline)');
      return null;
    }
  }

  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /**
   * Idempotent PR-list import. Shared by the PR list (best-effort) and the
   * manual poll (which surfaces failures) — ONE definition, so the two cannot
   * drift in which columns they write.
   */
  async syncPulls(workspaceId: string, repo: RepoRow, gh: GitHubClient): Promise<number> {
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    for (const pr of pulls) {
      await this.repo.upsert({
        workspaceId,
        repoId: repo.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        headSha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        filesCount: pr.files_count,
        status: pr.status,
        openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
        updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
      });
    }
    return pulls.length;
  }

  /** Manual refresh (`POST /repos/:id/poll`): sync + bump `last_polled_at`. */
  async poll(workspaceId: string, repoId: string): Promise<{ synced: number }> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const gh = await this.githubOrNull();
    if (!gh) {
      throw new AppError(
        'github_unavailable',
        'Connect a GitHub token to refresh pull requests.',
        400,
      );
    }
    const synced = await this.syncPulls(workspaceId, repo, gh);
    await this.container.reposRepo.markPolled(repo.id);
    return { synced };
  }

  async list(workspaceId: string, repoId: string): Promise<PrMeta[]> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const gh = await this.githubOrNull();

    if (gh) {
      try {
        await this.syncPulls(workspaceId, repo, gh);
      } catch (err) {
        this.log.warn({ err }, 'GitHub PR sync skipped; serving persisted PRs');
      }
    }

    const rows = await this.repo.listByRepo(repo.id);
    if (gh) await this.backfillDiffStats(gh, repo, rows);

    const [scoreByPr, findingsByPr, costByPr] = await this.reviewDecorations(rows.map((r) => r.id));

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      author: r.author,
      branch: r.branch,
      base: r.base,
      head_sha: r.headSha,
      additions: r.additions,
      deletions: r.deletions,
      files_count: r.filesCount,
      status: deriveReviewStatus({
        ghStatus: r.status,
        lastReviewedSha: r.lastReviewedSha,
        headSha: r.headSha,
        updatedAt: r.updatedAt,
        now,
      }),
      opened_at: r.openedAt?.toISOString() ?? null,
      updated_at: r.updatedAt?.toISOString() ?? null,
      score: scoreByPr.get(r.id) ?? null,
      total_cost_usd: costByPr.get(r.id) ?? null,
      // ≥1 persisted review, scored or not → "reviewed"; never-reviewed PRs
      // get findings: null, while all-zero counts mean "reviewed clean".
      findings: scoreByPr.has(r.id) ? (findingsByPr.get(r.id) ?? rollupSeverities([])) : null,
    }));
  }

  /**
   * Mutates `rows` in place with fresh diff stats so the caller's mapping sees
   * them without a re-read. Capped per request; failures are non-fatal.
   */
  private async backfillDiffStats(
    gh: GitHubClient,
    repo: RepoRow,
    rows: PullRow[],
  ): Promise<void> {
    const needStats = rows
      .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
      .slice(0, DIFF_STAT_BACKFILL_LIMIT);
    for (const r of needStats) {
      try {
        const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
        const stats = {
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        };
        await this.repo.updateDiffStats(r.id, stats);
        Object.assign(r, stats);
      } catch (err) {
        this.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
      }
    }
  }

  /**
   * SCORE + FINDINGS + COST per PR, computed on read (no denormalisation).
   *
   * SCORE is the WORST score among each agent's LATEST review — showing only the
   * newest review would let a clean run from one agent mask another's failing
   * one. FINDINGS aggregate across ALL of a PR's reviews so the list matches the
   * detail page, which lists every run's findings.
   */
  private async reviewDecorations(prIds: string[]) {
    const reviewRepo = this.container.reviewRepo;
    if (prIds.length === 0) {
      return [new Map(), new Map(), new Map()] as const;
    }

    const reviewRows = await reviewRepo.reviewSummariesForPulls(prIds);
    const scoreByPr = worstLatestScoreByPr(reviewRows);
    const reviewIdToPr = new Map(reviewRows.map((rv) => [rv.id, rv.prId]));

    const severityRows = await reviewRepo.findingSeveritiesForReviews([...reviewIdToPr.keys()]);
    const severitiesByPr = new Map<string, { severity: string }[]>();
    for (const f of severityRows) {
      const prId = reviewIdToPr.get(f.reviewId);
      if (!prId) continue;
      const list = severitiesByPr.get(prId);
      if (list) list.push(f);
      else severitiesByPr.set(prId, [f]);
    }
    const findingsByPr = new Map(
      [...severitiesByPr].map(([prId, rows]) => [prId, rollupSeverities(rows)]),
    );

    const costByPr = new Map(
      (await reviewRepo.totalCostByPull(prIds)).map((c) => [c.prId, c.total]),
    );

    return [scoreByPr, findingsByPr, costByPr] as const;
  }

  /**
   * PR detail addressed the way the UI routes address it — by repo + PR NUMBER.
   * Without this the client has to fetch the whole PR list just to translate a
   * number into a uuid before it can load the detail (a two-request waterfall
   * on every deep link and refresh).
   */
  async detailByNumber(workspaceId: string, repoId: string, number: number): Promise<PrDetail> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const pr = await this.repo.getByNumber(repo.id, number);
    if (!pr) throw new NotFoundError('Pull request not found');
    return this.detailFor(pr, repo);
  }

  async detail(workspaceId: string, prId: string): Promise<PrDetail> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    return this.detailFor(pr, repo);
  }

  private async detailFor(pr: PullRow, repo: RepoRow): Promise<PrDetail> {
    // Local-first: refresh from GitHub when possible, otherwise serve what is
    // persisted (seeded or previously imported) so detail works offline.
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);
      await this.repo.replaceDetail(pr.id, {
        files: detail.files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: detail.commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committedAt: c.committed_at ? new Date(c.committed_at) : null,
        })),
        body: detail.body ?? null,
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.files_count,
      });
      return { ...detail, id: pr.id };
    } catch (err) {
      this.log.warn({ err }, 'GitHub PR detail refresh skipped; serving persisted detail');
      return this.persistedDetail(pr);
    }
  }

  private async persistedDetail(pr: PullRow): Promise<PrDetail> {
    const [files, commits] = await Promise.all([
      this.repo.getFiles(pr.id),
      this.repo.getCommits(pr.id),
    ]);
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      branch: pr.branch,
      base: pr.base,
      head_sha: pr.headSha,
      additions: pr.additions,
      deletions: pr.deletions,
      files_count: pr.filesCount,
      status: pr.status as PrDetail['status'],
      opened_at: pr.openedAt?.toISOString() ?? null,
      updated_at: pr.updatedAt?.toISOString() ?? null,
      body: pr.body ?? null,
      files: files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
      commits: commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        author: c.author,
        committed_at: c.committedAt?.toISOString() ?? null,
      })),
    };
  }

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub with no local persistence: the tab stays in
  // lock-step with GitHub instead of maintaining a stale local mirror.

  private async resolvePrAndRepo(workspaceId: string, prId: string) {
    const pr = await this.repo.getById(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.requireRepo(workspaceId, pr.repoId);
    return { pr, repo };
  }

  async listComments(workspaceId: string, prId: string): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    const gh = await this.githubOrNull();
    if (!gh) return [];
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      this.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }
}
