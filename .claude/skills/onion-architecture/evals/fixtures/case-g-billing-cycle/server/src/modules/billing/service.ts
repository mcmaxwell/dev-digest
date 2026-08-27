import type { Container } from '../../platform/container.js';
import type { Charge } from '@devdigest/shared';
import { UsageService } from '../usage/service.js';
import { BillingRepository } from './repository.js';
import { OVERAGE_REASON } from './constants.js';

/**
 * L13 — billing service. Turns a workspace's metered usage into charges for
 * the current period.
 */
export class BillingService {
  private repo: BillingRepository;

  constructor(private container: Container) {
    this.repo = new BillingRepository(container.db);
  }

  private periodKey(now: Date): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async raiseOverage(workspaceId: string, cents: number): Promise<Charge> {
    const period = this.periodKey(new Date());
    const row = await this.repo.upsertCents(workspaceId, period, OVERAGE_REASON, cents);
    return {
      id: row.id,
      workspace_id: row.workspaceId,
      cents: row.cents,
      reason: row.reason,
    };
  }

  /** Recompute every charge for the period from current usage. */
  async recompute(workspaceId: string, now: Date): Promise<void> {
    const usage = new UsageService(this.container);
    const totals = await usage.totals(workspaceId, now);
    const period = this.periodKey(now);

    await this.repo.upsertCents(
      workspaceId,
      period,
      OVERAGE_REASON,
      Math.max(0, totals.review_runs - 200) * 5,
    );
  }
}
