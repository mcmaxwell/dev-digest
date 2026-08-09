import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff, type ChangedFile } from './classify.js';
import { findingLinesByPath, latestReviewFindings } from './helpers.js';

/**
 * Smart Diff (L03) — a reviewer-ordered view of a PR's changed files.
 *
 * It composes two things that already exist and adds NO state of its own: the
 * imported `pr_files` rows and the findings of the PR's latest review. There is
 * no LLM call, no table, no migration and no cache — the answer is a pure
 * function of data the PR already carries, so it is always consistent with the
 * diff and the findings the user is looking at.
 *
 * That is also why this module has no `repository.ts`: it reads exclusively
 * through `container.reviewRepo`, so it never imports the query builder and
 * `queries-live-in-repositories` / `no-cross-module-imports` both hold.
 *
 * TENANCY: `pr_files` and `findings` have no `workspace_id` of their own — they
 * inherit it from the PR. `pullOr404` is therefore the security boundary and
 * MUST run before any other read, exactly as `IntentService.pullOr404` does.
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  /** The PR's files grouped by role, with the latest review's findings marked. */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    await this.pullOr404(workspaceId, prId);

    const [fileRows, reviews] = await Promise.all([
      this.container.reviewRepo.getPrFiles(prId),
      this.container.reviewRepo.reviewsForPull(prId),
    ]);

    const files: ChangedFile[] = fileRows.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    return buildSmartDiff(files, findingLinesByPath(latestReviewFindings(reviews)));
  }

  private async pullOr404(workspaceId: string, prId: string) {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}
