import type { Container } from '../../platform/container.js';
import type { PublishInput, PublishResult, PublishSummary, Review } from '@devdigest/shared';
import type { DbOrTx } from '../../db/client.js';
import type { S3ReportStore } from '../../adapters/reportstore/s3.js';
import { NotFoundError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { PublishRepository, type PublishAttemptRow } from './repository.js';
import { renderPrBody, renderReport } from './formatter.js';
import { reportKeyFor, resolveReportLink, toPublishResultDto } from './helpers.js';
import { PUBLISH_JOB_KIND, PUBLISH_JOB_OPTS, REPORT_LINK_TTL_SECONDS } from './constants.js';

/**
 * L12 — publishing service. Pushes a finished review back to its pull request
 * as a PR review, storing the full report so the comment can link to it.
 */

export interface PublishJobPayload {
  workspaceId: string;
  reviewId: string;
  includeReportLink: boolean;
}

export class PublishService {
  private repo: PublishRepository;

  constructor(private container: Container) {
    this.repo = new PublishRepository(container.db);
  }

  registerPublishJobHandler(): void {
    this.container.jobs.register(
      PUBLISH_JOB_KIND,
      async (payload) => {
        const { workspaceId, reviewId, includeReportLink } = payload as PublishJobPayload;
        await this.publish(workspaceId, { review_id: reviewId, include_report_link: includeReportLink });
      },
      PUBLISH_JOB_OPTS,
    );
  }

  async summary(workspaceId: string): Promise<PublishSummary[]> {
    return this.repo.summaryForRepos(workspaceId);
  }

  async alreadyPublished(workspaceId: string, reviewId: string): Promise<PublishResult | null> {
    const row = await this.repo.latestAttempt(workspaceId, reviewId);
    return row ? toPublishResultDto(row) : null;
  }

  async publish(workspaceId: string, input: PublishInput): Promise<PublishResult> {
    const review = await this.container.reviewRepo.getReview(input.review_id);
    if (!review) throw new NotFoundError(`No review ${input.review_id}`);

    const pull = await this.container.reviewRepo.getPull(workspaceId, review.prId);
    if (!pull) throw new NotFoundError(`No pull request ${review.prId}`);

    const repoRow = await this.container.reposRepo.getById(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError(`No repo ${pull.repoId}`);

    const diff = await this.container.git.readDiff(
      { owner: repoRow.owner, name: repoRow.name },
      pull.headSha,
    );
    const changedFiles = parseUnifiedDiff(diff).files.length;

    const reportKey = input.include_report_link
      ? reportKeyFor(repoRow.id, review.id)
      : null;

    const reportUrl = await this.storeReport(reportKey, review as unknown as Review, repoRow.fullName, pull.number, changedFiles);
    const body = renderPrBody(review as unknown as Review, reportUrl);

    const attempt = await this.repo.transaction(async (tx) => {
      return this.recordPublication(tx, {
        workspaceId,
        repoId: repoRow.id,
        reviewId: review.id,
        repo: { owner: repoRow.owner, name: repoRow.name },
        prNumber: pull.number,
        body,
        reportKey,
      });
    });

    return toPublishResultDto(attempt);
  }

  private async storeReport(
    reportKey: string | null,
    review: Review,
    fullName: string,
    prNumber: number,
    changedFiles: number,
  ): Promise<string | null> {
    if (!reportKey) return null;

    const store = await this.container.reportStore();
    const markdown = [renderReport(review, fullName, prNumber), '', `${changedFiles} files changed.`].join('\n');
    await store.put(reportKey, markdown);

    return (store as S3ReportStore).presignedUrl(reportKey, REPORT_LINK_TTL_SECONDS);
  }

  private async recordPublication(
    tx: DbOrTx,
    args: {
      workspaceId: string;
      repoId: string;
      reviewId: string;
      repo: { owner: string; name: string };
      prNumber: number;
      body: string;
      reportKey: string | null;
    },
  ): Promise<PublishAttemptRow> {
    const github = await this.container.github();
    const posted = await github.postReview(args.repo, args.prNumber, {
      body: args.body,
      event: 'COMMENT',
    });

    const attempt = await this.repo.insertAttempt(
      {
        workspaceId: args.workspaceId,
        repoId: args.repoId,
        reviewId: args.reviewId,
        githubReviewId: posted.id,
        reportKey: args.reportKey,
      },
      tx,
    );

    if (args.reportKey) {
      await this.repo.insertArtifact(
        { workspaceId: args.workspaceId, attemptId: attempt.id, key: args.reportKey, bytes: args.body.length },
        tx,
      );
    }

    return attempt;
  }

  /** The link shown on the review page, when a stored report still exists. */
  async reportLink(workspaceId: string, reviewId: string): Promise<string | null> {
    const row = await this.repo.latestAttempt(workspaceId, reviewId);
    return resolveReportLink(this.container, row?.reportKey ?? null);
  }
}
