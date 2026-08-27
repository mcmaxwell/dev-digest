import { and, count, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L13 — usage data-access layer. The only place that touches `usage_events`.
 */

export type UsageEventRow = typeof t.usageEvents.$inferSelect;

export class UsageRepository {
  constructor(private db: Db) {}

  async record(workspaceId: string, kind: string, quantity: number): Promise<void> {
    await this.db.insert(t.usageEvents).values({ workspaceId, kind, quantity });
  }

  async countSince(workspaceId: string, kind: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: count(t.usageEvents.id) })
      .from(t.usageEvents)
      .where(
        and(
          eq(t.usageEvents.workspaceId, workspaceId),
          eq(t.usageEvents.kind, kind),
          gte(t.usageEvents.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  }
}
