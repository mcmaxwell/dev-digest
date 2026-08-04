import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
import type { DraftCandidate } from './types.js';

export type { ConventionRow, ConventionScanRow };

/**
 * Data access for the conventions extractor. Owns `conventions` +
 * `convention_scans` — the only file in this module that builds queries.
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Open a transaction; the SERVICE picks the boundary (see server/INSIGHTS.md). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  // --- scans ---------------------------------------------------------------

  async createScan(
    workspaceId: string,
    repoId: string,
    dbOrTx: DbOrTx = this.db,
  ): Promise<ConventionScanRow> {
    const [row] = await dbOrTx
      .insert(t.conventionScans)
      .values({ workspaceId, repoId, status: 'running' })
      .returning();
    return row!;
  }

  /** Most recent scan for a repo (the one the page header describes). */
  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId)),
      )
      .orderBy(desc(t.conventionScans.startedAt))
      .limit(1);
    return row;
  }

  async isScanRunning(workspaceId: string, repoId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.conventionScans.id })
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.repoId, repoId),
          eq(t.conventionScans.status, 'running'),
        ),
      )
      .limit(1);
    return !!row;
  }

  async updateScan(
    scanId: string,
    patch: Partial<{
      status: 'running' | 'done' | 'error';
      sha: string | null;
      provider: string | null;
      model: string | null;
      sampleCount: number;
      candidateCount: number;
      error: string | null;
      finishedAt: Date | null;
    }>,
    dbOrTx: DbOrTx = this.db,
  ): Promise<void> {
    await dbOrTx.update(t.conventionScans).set(patch).where(eq(t.conventionScans.id, scanId));
  }

  // --- candidates ----------------------------------------------------------

  async listCandidates(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async listByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }

  /** Rule keys + texts the user already rejected — fed back into the next prompt. */
  async rejectedRules(
    workspaceId: string,
    repoId: string,
  ): Promise<Array<{ ruleKey: string; rule: string }>> {
    return this.db
      .select({ ruleKey: t.conventions.ruleKey, rule: t.conventions.rule })
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'rejected'),
        ),
      );
  }

  /**
   * Upsert this scan's candidates.
   *
   * `ON CONFLICT (repo_id, rule_key)` refreshes the evidence/scores but leaves
   * `status` and `edited` alone: a re-scan must never un-accept what the user
   * accepted, nor re-ask about something they already rejected. Rules the user
   * edited keep THEIR wording too — the whole point of editing was to fix it.
   */
  async upsertCandidates(
    workspaceId: string,
    repoId: string,
    scanId: string,
    candidates: DraftCandidate[],
    dbOrTx: DbOrTx = this.db,
  ): Promise<void> {
    if (candidates.length === 0) return;
    await dbOrTx
      .insert(t.conventions)
      .values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          scanId,
          category: c.category,
          rule: c.rule,
          rationale: c.rationale ?? null,
          ruleKey: c.ruleKey,
          evidence: c.evidence,
          probe: c.probe ?? null,
          confidence: c.confidence,
          adherence: c.adherence ?? null,
          support: c.support ?? null,
          violations: c.violations ?? null,
          origin: c.origin,
        })),
      )
      .onConflictDoUpdate({
        target: [t.conventions.repoId, t.conventions.ruleKey],
        set: {
          scanId,
          category: sql`excluded.category`,
          // Keep the user's wording when they edited it; otherwise refresh.
          rule: sql`case when ${t.conventions.edited} then ${t.conventions.rule} else excluded.rule end`,
          rationale: sql`excluded.rationale`,
          evidence: sql`excluded.evidence`,
          probe: sql`excluded.probe`,
          confidence: sql`excluded.confidence`,
          adherence: sql`excluded.adherence`,
          support: sql`excluded.support`,
          violations: sql`excluded.violations`,
          origin: sql`excluded.origin`,
          updatedAt: new Date(),
        },
      });
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: {
      status?: 'pending' | 'accepted' | 'rejected';
      rule?: string;
      category?: string;
      edited?: boolean;
    },
    dbOrTx: DbOrTx = this.db,
  ): Promise<ConventionRow | undefined> {
    const [row] = await dbOrTx
      .update(t.conventions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
