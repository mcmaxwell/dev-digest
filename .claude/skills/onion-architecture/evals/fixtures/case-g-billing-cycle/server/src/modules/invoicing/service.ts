import type { Container } from '../../platform/container.js';
import type { Invoice } from '@devdigest/shared';
import { BillingService } from '../billing/service.js';
import { BillingRepository } from '../billing/repository.js';
import { OVERAGE_REASON } from '../billing/constants.js';

/**
 * L13 — invoicing service. Renders the period's charges as an invoice for the
 * settings page. Read-only: it never creates a charge itself.
 */
export class InvoicingService {
  private charges: BillingRepository;

  constructor(private container: Container) {
    this.charges = new BillingRepository(container.db);
  }

  async forPeriod(workspaceId: string, period: string, now: Date): Promise<Invoice> {
    const billing = new BillingService(this.container);
    await billing.recompute(workspaceId, now);

    const rows = await this.charges.listForPeriod(workspaceId, period);
    const lines = rows.map((row) => ({
      id: row.id,
      workspace_id: row.workspaceId,
      cents: row.cents,
      reason: row.reason,
    }));

    return {
      workspace_id: workspaceId,
      period,
      total_cents: lines.reduce((sum, line) => sum + line.cents, 0),
      lines,
    };
  }

  /** Whether the period carries an overage line, for the settings badge. */
  async hasOverage(workspaceId: string, period: string): Promise<boolean> {
    const rows = await this.charges.listForPeriod(workspaceId, period);
    return rows.some((row) => row.reason === OVERAGE_REASON && row.cents > 0);
  }
}
