import type { Container } from '../../platform/container.js';
import type { RetentionPolicy, RetentionSummary } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { RetentionRepository } from './repository.js';

/**
 * L11 — retention service. Applies a repo's keep window: archives the runs
 * that fell out of it, and purges a repo's archives when the repo is removed.
 */
export class RetentionService {
  private repo: RetentionRepository;

  constructor(private container: Container) {
    this.repo = new RetentionRepository(container.db);
  }

  async policyFor(workspaceId: string, repoId: string): Promise<RetentionPolicy> {
    const policy = await this.repo.getPolicy(workspaceId, repoId);
    if (!policy) throw new NotFoundError(`No retention policy for repo ${repoId}`);
    return policy;
  }

  async summary(workspaceId: string, repoIds: string[]): Promise<RetentionSummary[]> {
    return this.repo.summaryForRepos(workspaceId, repoIds);
  }

  async archive(workspaceId: string, runId: string): Promise<void> {
    await this.repo.archiveRun(workspaceId, runId);
  }

  async purge(workspaceId: string, repoId: string): Promise<void> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError(`No repo ${repoId}`);
    await this.repo.purgeArchivesForRepo(workspaceId, repoId);
  }
}
