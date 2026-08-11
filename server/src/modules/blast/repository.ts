import { eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrBlastSummaryRow } from '../../db/rows.js';

export type { PrBlastSummaryRow };

export interface BlastSummaryUpsert {
  prId: string;
  text: string;
  headSha: string;
  indexedSha: string;
  provider: string;
  model: string;
}

/**
 * The ONLY owner of `pr_blast_summary`.
 *
 * The table carries no `workspace_id` (its PK is the PR), so tenancy happens one
 * level up: `BlastService` resolves the PR through
 * `container.reviewRepo.getPull(workspaceId, prId)` and 404s BEFORE anything in
 * here runs. The unscoped `where(eq(prId))` below is correct for that reason and
 * for no other - do not copy the shape into a table that does need scoping.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<PrBlastSummaryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBlastSummary)
      .where(eq(t.prBlastSummary.prId, prId));
    return row;
  }

  /**
   * Replace the PR's summary wholesale. A regenerated summary supersedes the
   * previous one completely - there is nothing user-owned on the row to
   * preserve, so every column including `generated_at` is overwritten.
   */
  async upsert(values: BlastSummaryUpsert, dbOrTx: DbOrTx = this.db): Promise<PrBlastSummaryRow> {
    const row = { ...values, generatedAt: new Date() };
    const [inserted] = await dbOrTx
      .insert(t.prBlastSummary)
      .values(row)
      .onConflictDoUpdate({ target: t.prBlastSummary.prId, set: row })
      .returning();
    return inserted!;
  }
}
