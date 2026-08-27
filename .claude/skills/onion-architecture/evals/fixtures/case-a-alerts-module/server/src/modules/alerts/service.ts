import type { Container } from '../../platform/container.js';
import type { AlertRule, AlertRuleInput, SeverityCounts } from '@devdigest/shared';
import { ConfigError, NotFoundError } from '../../platform/errors.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { rollupSeverities } from '../_shared/severity.js';
import { AlertRepository } from './repository.js';
import { formatAlertBody, toAlertRuleDto, tripsRule, worstOf } from './helpers.js';
import { ALERT_JOB_KIND, ALERT_JOB_OPTS, GITHUB_TOKEN_SECRET } from './constants.js';

/**
 * L09 — alerts service. Rule CRUD plus the asynchronous `alert-deliver` job
 * that posts a summary review on the PR when a closed review trips a rule.
 */

export interface AlertJobPayload {
  workspaceId: string;
  ruleId: string;
  reviewId: string;
  repo: { owner: string; name: string };
  prNumber: number;
  counts: SeverityCounts;
}

export class AlertService {
  private repo: AlertRepository;

  constructor(private container: Container) {
    this.repo = new AlertRepository(container.db);
  }

  registerDeliveryJobHandler(): void {
    this.container.jobs.register(
      ALERT_JOB_KIND,
      async (payload) => {
        await this.runDeliveryJob(payload as AlertJobPayload);
      },
      ALERT_JOB_OPTS,
    );
  }

  async createRule(workspaceId: string, userId: string, input: AlertRuleInput): Promise<AlertRule> {
    const row = await this.repo.insert({
      workspaceId,
      repoId: input.repo_id,
      minSeverity: input.min_severity,
      channel: input.channel,
      createdBy: userId,
    });
    return toAlertRuleDto(row);
  }

  async list(workspaceId: string): Promise<AlertRule[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAlertRuleDto);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) throw new NotFoundError(`No alert rule ${id}`);
    await this.repo.remove(workspaceId, id);
  }

  /**
   * Called when a review closes. Enqueues delivery so the review request is
   * never blocked on GitHub.
   */
  async onReviewClosed(
    workspaceId: string,
    repoId: string,
    reviewId: string,
    findings: { severity: string }[],
    repo: { owner: string; name: string },
    prNumber: number,
  ): Promise<void> {
    const rule = await this.repo.findByRepo(workspaceId, repoId);
    if (!rule) return;

    const counts = rollupSeverities(findings);
    const worst = worstOf(counts);
    if (!worst || !tripsRule(worst, rule.minSeverity)) return;

    await this.container.jobs.enqueue(workspaceId, ALERT_JOB_KIND, {
      workspaceId,
      ruleId: rule.id,
      reviewId,
      repo,
      prNumber,
      counts,
    } satisfies AlertJobPayload);
  }

  async runDeliveryJob(payload: AlertJobPayload): Promise<void> {
    const { workspaceId, ruleId, reviewId, repo, prNumber, counts } = payload;

    const review = await this.container.reviewRepo.getReview(reviewId);
    if (!review) throw new NotFoundError(`No review ${reviewId}`);

    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    const github = new OctokitGitHubClient(token);

    await github.postReview(repo, prNumber, {
      body: formatAlertBody(`${repo.owner}/${repo.name}`, counts),
      event: 'COMMENT',
    });

    await this.repo.recordDelivery(workspaceId, ruleId, reviewId, 'sent');
  }
}
