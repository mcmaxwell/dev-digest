import type { Container } from '../../platform/container.js';
import type { HealthScore } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { rollupSeverities } from '../_shared/severity.js';
import { HealthRepository } from './repository.js';
import { HealthScorer } from './scorer.js';

/**
 * L10 — health service. Recomputes a repo's health after a review closes:
 * rolls up the review's findings, measures churn from the PR diff, and stores
 * the resulting score.
 */
export class HealthService {
  private repo: HealthRepository;
  private scorer: HealthScorer;

  constructor(private container: Container) {
    this.repo = new HealthRepository(container);
    this.scorer = new HealthScorer();
  }

  async recompute(
    workspaceId: string,
    repoId: string,
    findings: { severity: string }[],
    rawDiff: string,
  ): Promise<void> {
    const counts = rollupSeverities(findings);
    const churnFiles = parseUnifiedDiff(rawDiff).files.length;
    const score = this.scorer.score(counts, churnFiles);
    await this.repo.insertScore(workspaceId, repoId, score, counts, churnFiles);
  }

  async current(workspaceId: string, repoId: string): Promise<HealthScore> {
    const health = await this.repo.latest(workspaceId, repoId);
    if (!health) throw new NotFoundError(`No health score for repo ${repoId}`);
    return health;
  }
}
