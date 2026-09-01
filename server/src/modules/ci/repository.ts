import { and, desc, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';

export type { CiInstallationRow, CiRunRow };

/** The columns a caller supplies when recording a run (the rest are defaults). */
export type CiRunInsert = typeof t.ciRuns.$inferInsert;

/** A run plus the two joined columns the runs list shows. */
export interface CiRunListRow {
  run: CiRunRow;
  repo: string;
  agent: string;
}

/**
 * Data access for Export to CI. The ONLY owner of `ci_installations` and
 * `ci_runs`, and the only file in this module that imports drizzle.
 *
 * NEITHER TABLE CARRIES A `workspace_id`, unlike essentially every other domain
 * table - an installation is keyed by its agent, and a run by its installation.
 * Tenancy therefore comes from the layer above, and this is deliberate rather
 * than an oversight:
 *  - `CiService` resolves the agent with `container.agentsRepo.getById(
 *    workspaceId, agentId)` and 404s BEFORE any method here is called, so an
 *    agent id from another workspace never reaches a query;
 *  - the two methods that start from something OTHER than an agent id
 *    (`installationForRepo`, `listRuns`) take a `workspaceId` and join through
 *    `agents` themselves, because there is nothing above them to do the
 *    scoping.
 * Do not "fix" the unscoped `where` clauses below by inventing a column, and do
 * not copy this shape into a table that does need scoping. Same trap as
 * `pr_intent` (server/INSIGHTS.md).
 */
export class CiRepository {
  constructor(private db: Db) {}

  /** Open a transaction; the SERVICE picks the boundary (see server/INSIGHTS.md). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  /** Every repository this agent is installed into, newest first. */
  async listInstallationsForAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));
  }

  /** The installation of `agentId` into `repo`, if there is one. */
  async findInstallation(
    agentId: string,
    repo: string,
    dbOrTx: DbOrTx = this.db,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await dbOrTx
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)))
      .limit(1);
    return row;
  }

  /**
   * The installation row for `(agent, repo)`, creating it only if absent.
   *
   * Read-then-insert rather than `ON CONFLICT`, because `ci_installations` has
   * no unique index on `(agent_id, repo)`. That makes the pair of statements
   * racy on its own, so the SERVICE hands in a transaction handle; under this
   * app's single-process, local-first usage that is sufficient, but it is not a
   * database-level guarantee and a unique index is the real fix.
   */
  async upsertInstallation(
    values: { agentId: string; repo: string; targetType: CiInstallationRow['targetType'] },
    dbOrTx: DbOrTx = this.db,
  ): Promise<CiInstallationRow> {
    const existing = await this.findInstallation(values.agentId, values.repo, dbOrTx);
    if (existing) return existing;

    const [inserted] = await dbOrTx.insert(t.ciInstallations).values(values).returning();
    return inserted!;
  }

  /**
   * Record one CI run. `ci_runs` is append-only and has no unique key, so a
   * re-run of the same workflow legitimately records a second row - dedup would
   * need a `github_run_id` column, which is a schema change.
   */
  async insertRun(values: CiRunInsert): Promise<CiRunRow> {
    const [inserted] = await this.db.insert(t.ciRuns).values(values).returning();
    return inserted!;
  }

  /**
   * The workspace's CI runs, newest first, with the two columns `ci_runs` does
   * not carry: the installation's repository and the agent's name.
   *
   * The join through `agents` IS the tenancy check (see the class comment), and
   * it is an INNER join on purpose: a run whose installation was deleted belongs
   * to no workspace any more and must not surface in another one's list.
   * `limit` is a hard cap rather than a page: the table has no index beyond its
   * primary key, and the page filters what it is given client-side.
   */
  async listRuns(workspaceId: string, limit: number): Promise<CiRunListRow[]> {
    return this.db
      .select({
        run: t.ciRuns,
        repo: t.ciInstallations.repo,
        agent: t.agents.name,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(limit);
  }

  /**
   * The installation of ANY of the workspace's agents into `repo`.
   *
   * The join through `agents` IS the tenancy check: the caller starts from a
   * repository name off the wire, not from an agent it has already resolved.
   */
  async installationForRepo(
    workspaceId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, repo)))
      .orderBy(desc(t.ciInstallations.installedAt))
      .limit(1);
    return row?.installation;
  }
}
