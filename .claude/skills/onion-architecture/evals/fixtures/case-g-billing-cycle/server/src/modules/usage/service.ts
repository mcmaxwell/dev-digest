import type { Container } from '../../platform/container.js';
import type { UsageTotals } from '@devdigest/shared';
import { BillingService } from '../billing/service.js';
import { UsageRepository } from './repository.js';
import { overageCents, periodStart } from './helpers.js';
import { INCLUDED_RUNS } from './constants.js';

/**
 * L13 — usage service. Records metered events and, when a workspace crosses
 * its included allowance, asks billing to raise the overage charge.
 */
export class UsageService {
  private repo: UsageRepository;

  constructor(private container: Container) {
    this.repo = new UsageRepository(container.db);
  }

  async totals(workspaceId: string, now: Date): Promise<UsageTotals> {
    const since = periodStart(now);
    return {
      workspace_id: workspaceId,
      review_runs: await this.repo.countSince(workspaceId, 'review_run', since),
      indexed_files: await this.repo.countSince(workspaceId, 'indexed_file', since),
    };
  }

  /** Called when a review run closes. */
  async recordRun(workspaceId: string, now: Date): Promise<void> {
    await this.repo.record(workspaceId, 'review_run', 1);

    const runs = await this.repo.countSince(workspaceId, 'review_run', periodStart(now));
    if (runs <= INCLUDED_RUNS) return;

    const billing = new BillingService(this.container);
    await billing.raiseOverage(workspaceId, overageCents(runs));
  }
}
