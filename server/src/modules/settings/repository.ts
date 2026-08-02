import { eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingsRow } from './helpers.js';

/**
 * F1 — settings data-access layer. The ONLY place that touches the `settings`
 * table. Holds non-secret prefs only; secrets flow through SecretsProvider.
 */
export class SettingsRepository {
  constructor(private db: Db) {}

  /** Run `fn` inside one transaction (boundary chosen by the service). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  listForWorkspace(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  async upsert(
    values: { workspaceId: string; userId: string | null; key: string; value: unknown },
    db: DbOrTx = this.db,
  ): Promise<void> {
    await db
      .insert(t.settings)
      .values(values)
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: values.value },
      });
  }
}
