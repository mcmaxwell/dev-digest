import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L13 — billing data-access layer. The only place that touches `charges`.
 */

export type ChargeRow = typeof t.charges.$inferSelect;

export class BillingRepository {
  constructor(private db: Db) {}

  async listForPeriod(workspaceId: string, period: string): Promise<ChargeRow[]> {
    return this.db
      .select()
      .from(t.charges)
      .where(and(eq(t.charges.workspaceId, workspaceId), eq(t.charges.period, period)));
  }

  async findByReason(
    workspaceId: string,
    period: string,
    reason: string,
  ): Promise<ChargeRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.charges)
      .where(
        and(
          eq(t.charges.workspaceId, workspaceId),
          eq(t.charges.period, period),
          eq(t.charges.reason, reason),
        ),
      );
    return row;
  }

  async upsertCents(
    workspaceId: string,
    period: string,
    reason: string,
    cents: number,
  ): Promise<ChargeRow> {
    const existing = await this.findByReason(workspaceId, period, reason);
    if (existing) {
      const [updated] = await this.db
        .update(t.charges)
        .set({ cents })
        .where(and(eq(t.charges.workspaceId, workspaceId), eq(t.charges.id, existing.id)))
        .returning();
      return updated!;
    }
    const [row] = await this.db
      .insert(t.charges)
      .values({ workspaceId, period, reason, cents })
      .returning();
    return row!;
  }
}
