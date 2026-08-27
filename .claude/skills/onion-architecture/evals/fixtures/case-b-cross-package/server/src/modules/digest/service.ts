import type { Container } from '../../platform/container.js';
import type { PrDigest } from '@devdigest/shared';
import { tuneSeverities } from '@devdigest/reviewer-core';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { rollupSeverities } from '../_shared/severity.js';
import { toPrDigestDto } from './helpers.js';
import { UNCLONED_REPO_MESSAGE } from './constants.js';

/**
 * L09 — digest service. Rolls every review on a pull request into one summary,
 * applying the repository's own severity overrides first so the digest reflects
 * the team's calibration rather than the raw model output.
 */
export class DigestService {
  private reviews: ReviewRepository;

  constructor(private container: Container) {
    this.reviews = new ReviewRepository(container.db);
  }

  async forPull(workspaceId: string, prId: string): Promise<PrDigest> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`No pull request ${prId}`);

    const repo = await this.container.reposRepo.getById(workspaceId, pull.repoId);
    if (!repo) throw new NotFoundError(`No repo ${pull.repoId}`);
    if (!repo.clonePath) throw new AppError('repo_not_cloned', UNCLONED_REPO_MESSAGE, 409);

    const reviews = await this.reviews.reviewsForPull(prId);
    const findings = reviews.flatMap((r) => r.findings);

    const { findings: tuned, applied } = tuneSeverities(findings, repo.clonePath);

    return toPrDigestDto(prId, reviews.length, rollupSeverities(tuned), applied);
  }
}
