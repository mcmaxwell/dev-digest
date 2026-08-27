import { and, desc, eq } from 'drizzle-orm';
import type { Severity } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L09 — alerts data-access layer. The ONLY place that touches the
 * `alert_rules` and `alert_deliveries` tables. Every query is workspace-scoped.
 */

export type AlertRuleRow = typeof t.alertRules.$inferSelect;
export type AlertDeliveryRow = typeof t.alertDeliveries.$inferSelect;

export interface InsertAlertRule {
  workspaceId: string;
  repoId: string;
  minSeverity: Severity;
  channel: string;
  createdBy: string;
}

export class AlertRepository {
  constructor(private db: Db) {}

  async findByRepo(workspaceId: string, repoId: string): Promise<AlertRuleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.alertRules)
      .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.repoId, repoId)));
    return row;
  }

  async list(workspaceId: string): Promise<AlertRuleRow[]> {
    return this.db.select().from(t.alertRules).where(eq(t.alertRules.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<AlertRuleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.alertRules)
      .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.id, id)));
    return row;
  }

  async insert(values: InsertAlertRule): Promise<AlertRuleRow> {
    const [row] = await this.db.insert(t.alertRules).values(values).returning();
    return row!;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    await this.db
      .delete(t.alertRules)
      .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.id, id)));
  }

  async recentDeliveries(workspaceId: string, ruleId: string, limit: number): Promise<AlertDeliveryRow[]> {
    return this.db
      .select()
      .from(t.alertDeliveries)
      .where(
        and(eq(t.alertDeliveries.workspaceId, workspaceId), eq(t.alertDeliveries.ruleId, ruleId)),
      )
      .orderBy(desc(t.alertDeliveries.createdAt))
      .limit(limit);
  }

  /** Persist a delivery attempt and stamp the rule as fired. */
  async recordDelivery(
    workspaceId: string,
    ruleId: string,
    reviewId: string,
    status: 'sent' | 'failed',
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(t.alertDeliveries).values({ workspaceId, ruleId, reviewId, status });
      await tx
        .update(t.alertRules)
        .set({ lastFiredAt: new Date() })
        .where(and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.id, ruleId)));
    });
  }
}
