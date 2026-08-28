import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseRow, EvalRunRow, EvalSuiteRunRow } from '../../db/rows.js';

export type { EvalCaseRow, EvalRunRow, EvalSuiteRunRow };

/**
 * L06 - data access for the eval harness. The ONLY owner of `eval_cases`,
 * `eval_runs` and `eval_suite_runs`.
 *
 * `eval_runs` carries no `workspace_id`: it hangs off a case, and the case is
 * the workspace-scoped row. Scoping therefore happens one level up, exactly as
 * `pr_intent` does - `EvalService` resolves the case (or the suite run) through
 * a workspace-scoped read before any query in here touches `eval_runs`, so an
 * id from another workspace 404s before it reaches a run row.
 */
export class EvalRepository {
  constructor(private db: Db) {}

  /** Open a transaction; the SERVICE picks the boundary (see server/INSIGHTS.md). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  // ---- cases ------------------------------------------------------------

  async listCases(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)))
      .orderBy(t.evalCases.name);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row;
  }

  async createCase(
    values: typeof t.evalCases.$inferInsert,
    dbOrTx: DbOrTx = this.db,
  ): Promise<EvalCaseRow> {
    const [row] = await dbOrTx.insert(t.evalCases).values(values).returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: Partial<typeof t.evalCases.$inferInsert>,
    dbOrTx: DbOrTx = this.db,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await dbOrTx
      .update(t.evalCases)
      .set(patch)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs -------------------------------------------------------------

  /**
   * The newest run of each of the given cases.
   *
   * Ordered newest-first and reduced in memory rather than with a lateral join:
   * the case set is bounded by MAX_CASES_PER_RUN and the studio is single-user,
   * so the query that is easy to read wins over the one that is easy to get
   * subtly wrong.
   */
  async latestRunByCase(caseIds: string[]): Promise<Map<string, EvalRunRow>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt));
    const out = new Map<string, EvalRunRow>();
    for (const r of rows) if (!out.has(r.caseId)) out.set(r.caseId, r);
    return out;
  }

  async insertRun(
    values: typeof t.evalRuns.$inferInsert,
    dbOrTx: DbOrTx = this.db,
  ): Promise<EvalRunRow> {
    const [row] = await dbOrTx.insert(t.evalRuns).values(values).returning();
    return row!;
  }

  /** Every per-case row of one suite run, with the case name joined in. */
  async runsForSuite(suiteRunId: string): Promise<(EvalRunRow & { caseName: string | null })[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(eq(t.evalRuns.suiteRunId, suiteRunId))
      .orderBy(t.evalCases.name);
    return rows.map((r) => ({ ...r.run, caseName: r.caseName }));
  }

  // ---- suite runs -------------------------------------------------------

  async insertSuiteRun(
    values: typeof t.evalSuiteRuns.$inferInsert,
    dbOrTx: DbOrTx = this.db,
  ): Promise<EvalSuiteRunRow> {
    const [row] = await dbOrTx.insert(t.evalSuiteRuns).values(values).returning();
    return row!;
  }

  async getSuiteRun(workspaceId: string, id: string): Promise<EvalSuiteRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.id, id)));
    return row;
  }

  /** An owner's run history, newest first. */
  async listSuiteRuns(
    workspaceId: string,
    ownerId: string,
    limit: number,
  ): Promise<EvalSuiteRunRow[]> {
    return this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.ownerId, ownerId)),
      )
      .orderBy(desc(t.evalSuiteRuns.ranAt))
      .limit(limit);
  }

  /** Recent runs across every owner in the workspace, for the dashboard index. */
  async recentSuiteRuns(
    workspaceId: string,
    limit: number,
  ): Promise<(EvalSuiteRunRow & { agentName: string | null })[]> {
    const rows = await this.db
      .select({ run: t.evalSuiteRuns, agentName: t.agents.name })
      .from(t.evalSuiteRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.evalSuiteRuns.ownerId))
      .where(eq(t.evalSuiteRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalSuiteRuns.ranAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.run, agentName: r.agentName }));
  }
}
