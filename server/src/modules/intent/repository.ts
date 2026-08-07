import { eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrIntentRow } from '../../db/rows.js';
import type { IntentTrace, IntentUpsert } from './types.js';

export type { PrIntentRow };

/**
 * Data access for the intent layer. The ONLY owner of `pr_intent` — the dead
 * `upsertIntent`/`getIntent` that used to sit on `ReviewRepository` were deleted
 * when this landed, so the table has exactly one owning repository.
 *
 * `pr_intent` carries no `workspace_id` (its PK is the PR). Scoping therefore
 * happens one level up: `IntentService` resolves the PR through
 * `container.reviewRepo.getPull(workspaceId, prId)` before it ever calls in
 * here, so an id from another workspace 404s before it reaches a query.
 */
export class IntentRepository {
  constructor(private db: Db) {}

  /** Open a transaction; the SERVICE picks the boundary (see server/INSIGHTS.md). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  async get(prId: string): Promise<PrIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  /**
   * Replace the PR's intent wholesale.
   *
   * A re-classification supersedes the previous statement completely — there is
   * nothing user-owned on this row to preserve (unlike a conventions candidate,
   * whose verdict and wording must survive a re-scan), so every column is
   * overwritten including `generated_at`.
   */
  async upsert(values: IntentUpsert, dbOrTx: DbOrTx = this.db): Promise<PrIntentRow> {
    const row = {
      prId: values.prId,
      summary: values.summary,
      inScope: values.inScope,
      outOfScope: values.outOfScope,
      riskAreas: values.riskAreas,
      sources: values.sources,
      confidence: values.confidence,
      provider: values.provider,
      model: values.model,
      headSha: values.headSha,
      generatedAt: new Date(),
      trace: values.trace as IntentTrace,
    };
    const [inserted] = await dbOrTx
      .insert(t.prIntent)
      .values(row)
      .onConflictDoUpdate({ target: t.prIntent.prId, set: row })
      .returning();
    return inserted!;
  }

  async delete(prId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.prIntent)
      .where(eq(t.prIntent.prId, prId))
      .returning({ prId: t.prIntent.prId });
    return rows.length > 0;
  }
}
