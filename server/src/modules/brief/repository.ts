import { desc, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrBriefHistoryRow, PrBriefRow } from '../../db/rows.js';

export type { PrBriefHistoryRow, PrBriefRow };

export interface BriefUpsert {
  prId: string;
  /** The whole `BriefView`, replaced wholesale on every generation. */
  json: unknown;
  headSha: string;
  indexedSha: string;
  provider: string;
  model: string;
  status: 'ok' | 'degraded';
  degradedReason: string | null;
  /** The full assembled prompt + call stats. DB-only; never logged. */
  trace: unknown;
}

export interface BriefHistoryAppend {
  prId: string;
  headSha: string;
  riskLevel: string;
  what: string;
}

/**
 * The ONLY owner of `pr_brief` and `pr_brief_history`.
 *
 * Neither table carries a `workspace_id` (their key is the PR), so tenancy
 * happens one level up: `BriefService` resolves the PR through
 * `container.reviewRepo.getPull(workspaceId, prId)` and 404s BEFORE anything in
 * here runs. The unscoped `where(eq(prId))` below is correct for that reason and
 * for no other — do not copy the shape into a table that does need scoping.
 *
 * THERE IS NO UPDATE AND NO DELETE FOR `pr_brief_history`, and that omission is
 * the feature: "a history entry is never modified once written" (AC-44) is
 * enforced by the absence of the code path, not by everyone remembering. A
 * regeneration REPLACES the `pr_brief` row and APPENDS one history row; the two
 * writes belong to one transaction, opened by the service, which is why every
 * write here takes an optional `DbOrTx`.
 *
 * Cross-table note: the prior-PR overlap query is NOT here. It reads `pr_files`,
 * which `modules/reviews` already owns, and a table has exactly one owning
 * repository — so it lives in `reviews/repository/pull.repo.ts` and is reached
 * through `container.reviewRepo`.
 */
export class BriefRepository {
  constructor(private db: Db) {}

  /**
   * Run `fn` inside one transaction. The BOUNDARY is chosen by the service; the
   * write helpers below join whatever handle they are given.
   */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  async get(prId: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * Replace the PR's brief wholesale. A regenerated brief supersedes the previous
   * one completely — there is nothing user-owned on the row to preserve, so every
   * column including `generated_at` is overwritten. The superseded reading is not
   * lost: it is in `pr_brief_history`, which this never touches.
   */
  async upsert(values: BriefUpsert, dbOrTx: DbOrTx = this.db): Promise<PrBriefRow> {
    const row = { ...values, generatedAt: new Date() };
    const [inserted] = await dbOrTx
      .insert(t.prBrief)
      .values(row)
      .onConflictDoUpdate({ target: t.prBrief.prId, set: row })
      .returning();
    return inserted!;
  }

  /** Append one timeline entry. There is deliberately no counterpart. */
  async appendHistory(
    values: BriefHistoryAppend,
    dbOrTx: DbOrTx = this.db,
  ): Promise<PrBriefHistoryRow> {
    const [inserted] = await dbOrTx.insert(t.prBriefHistory).values(values).returning();
    return inserted!;
  }

  /** The PR's timeline, newest first (AC-45). Served by the `(pr_id, generated_at)` index. */
  history(prId: string, limit: number): Promise<PrBriefHistoryRow[]> {
    return this.db
      .select()
      .from(t.prBriefHistory)
      .where(eq(t.prBriefHistory.prId, prId))
      .orderBy(desc(t.prBriefHistory.generatedAt))
      .limit(limit);
  }
}
