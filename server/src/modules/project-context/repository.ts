import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { union } from 'drizzle-orm/pg-core';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L05 — project-context data access. Owns `project_docs`, `project_doc_scans`,
 * `agent_context_docs` and `skill_context_docs`.
 *
 * TENANCY. None of these tables carries a `workspace_id`: they are keyed by a
 * repo/agent/skill id, so their tenancy comes from the layer ABOVE.
 * `ProjectContextService` resolves every incoming repository through
 * `container.reposRepo.getById(workspaceId, repoId)` and every agent/skill
 * through that module's service, and 404s BEFORE calling anything here. The
 * unscoped `where(eq(repoId, …))` below is therefore deliberate — do not copy
 * the pattern into a table that does need scoping, and do not "fix" it by
 * adding a workspace filter that has no column to filter on.
 *
 * The `usageCounts` join reaches `agents`, `skills` and `agent_skills`, which
 * other modules own. That is a table-level join through `db/schema` symbols,
 * not a cross-module import — the same shape as
 * `reviews/repository/run.repo.ts::statsForAgents`.
 */

export interface DocRow {
  path: string;
  category: string;
  sizeBytes: number;
  tokens: number;
}

export interface ScanRow {
  status: 'ok' | 'not_cloned' | 'error';
  scannedAt: Date;
  docCount: number;
  tokensTotal: number;
  skippedTooLarge: number;
  bounded: number;
  error: string | null;
}

export interface AttachmentRow {
  repoId: string;
  path: string;
  order: number;
}

export interface SkillAttachmentRow extends AttachmentRow {
  skillId: string;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  /** Open a transaction; the SERVICE picks the boundary (see server/INSIGHTS.md). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  /**
   * Owner/name/clone path of a repository, WITHOUT a workspace filter — the
   * job-queue path (`scan`) has a repo id and no request context. Every HTTP
   * entry point resolves the repository through
   * `container.reposRepo.getById(workspaceId, id)` first; this is the read that
   * only the background scan uses. Same shape as
   * `repo-intel/repository.ts::getRepoBasics`.
   */
  async repoBasics(
    repoId: string,
  ): Promise<{ owner: string; name: string; clonePath: string | null } | undefined> {
    const [row] = await this.db
      .select({ owner: t.repos.owner, name: t.repos.name, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  // ---- discovery results --------------------------------------------------

  /**
   * Replace a repository's whole document set. Delete + insert must run in ONE
   * transaction (the service's), so a concurrent list never sees a half-written
   * set.
   */
  async replaceDocs(repoId: string, docs: DocRow[], dbOrTx: DbOrTx = this.db): Promise<void> {
    await dbOrTx.delete(t.projectDocs).where(eq(t.projectDocs.repoId, repoId));
    if (docs.length === 0) return;
    await dbOrTx.insert(t.projectDocs).values(
      docs.map((d) => ({
        repoId,
        path: d.path,
        category: d.category,
        sizeBytes: d.sizeBytes,
        tokens: d.tokens,
      })),
    );
  }

  async upsertScan(repoId: string, row: ScanRow, dbOrTx: DbOrTx = this.db): Promise<void> {
    await dbOrTx
      .insert(t.projectDocScans)
      .values({ repoId, ...row })
      .onConflictDoUpdate({ target: t.projectDocScans.repoId, set: { ...row } });
  }

  async listDocs(repoId: string): Promise<DocRow[]> {
    return this.db
      .select({
        path: t.projectDocs.path,
        category: t.projectDocs.category,
        sizeBytes: t.projectDocs.sizeBytes,
        tokens: t.projectDocs.tokens,
      })
      .from(t.projectDocs)
      .where(eq(t.projectDocs.repoId, repoId))
      .orderBy(asc(t.projectDocs.path));
  }

  async countDocs(repoId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.projectDocs)
      .where(eq(t.projectDocs.repoId, repoId));
    return Number(row?.n ?? 0);
  }

  async getScan(repoId: string): Promise<ScanRow | undefined> {
    const [row] = await this.db
      .select({
        status: t.projectDocScans.status,
        scannedAt: t.projectDocScans.scannedAt,
        docCount: t.projectDocScans.docCount,
        tokensTotal: t.projectDocScans.tokensTotal,
        skippedTooLarge: t.projectDocScans.skippedTooLarge,
        bounded: t.projectDocScans.bounded,
        error: t.projectDocScans.error,
      })
      .from(t.projectDocScans)
      .where(eq(t.projectDocScans.repoId, repoId));
    return row;
  }

  /** One document's descriptor, or undefined when the last scan did not find it. */
  async getDoc(repoId: string, path: string): Promise<DocRow | undefined> {
    const [row] = await this.db
      .select({
        path: t.projectDocs.path,
        category: t.projectDocs.category,
        sizeBytes: t.projectDocs.sizeBytes,
        tokens: t.projectDocs.tokens,
      })
      .from(t.projectDocs)
      .where(and(eq(t.projectDocs.repoId, repoId), eq(t.projectDocs.path, path)));
    return row;
  }

  /** Is `path` present in this repository's LATEST scan? The read-path gate. */
  async hasDoc(repoId: string, path: string): Promise<boolean> {
    return (await this.getDoc(repoId, path)) !== undefined;
  }

  /**
   * `repoId → (path → tokens)` for the given repositories, in one query.
   *
   * Serves both attachment-facing needs at once: a path absent from its map is
   * the `missing` chip (AC-24), and the token value is what the Context tab's
   * aggregate sums (AC-21).
   */
  async docIndexForRepos(repoIds: string[]): Promise<Map<string, Map<string, number>>> {
    const out = new Map<string, Map<string, number>>();
    if (repoIds.length === 0) return out;
    const rows = await this.db
      .select({
        repoId: t.projectDocs.repoId,
        path: t.projectDocs.path,
        tokens: t.projectDocs.tokens,
      })
      .from(t.projectDocs)
      .where(inArray(t.projectDocs.repoId, repoIds));
    for (const row of rows) {
      let byPath = out.get(row.repoId);
      if (!byPath) {
        byPath = new Map<string, number>();
        out.set(row.repoId, byPath);
      }
      byPath.set(row.path, row.tokens);
    }
    return out;
  }

  /**
   * Distinct ENABLED agents that would inject each document of `repoId` on a
   * run — directly, or through an enabled linked skill.
   *
   * One grouped query over a UNION (not UNION ALL): the set operation dedupes
   * `(agent_id, path)` pairs, which is exactly AC-14's "counting an agent once
   * whether it attaches the document directly or inherits it".
   */
  async usageCounts(repoId: string): Promise<Map<string, number>> {
    const direct = this.db
      .select({ agentId: t.agentContextDocs.agentId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(and(eq(t.agentContextDocs.repoId, repoId), eq(t.agents.enabled, true)));

    const inherited = this.db
      .select({ agentId: t.agentSkills.agentId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skills.id, t.skillContextDocs.skillId))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skillContextDocs.skillId))
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.skillContextDocs.repoId, repoId),
          eq(t.skills.enabled, true),
          eq(t.agents.enabled, true),
        ),
      );

    const reach = union(direct, inherited).as('reach');
    const rows = await this.db
      .select({ path: reach.path, n: count() })
      .from(reach)
      .groupBy(reach.path);

    return new Map(rows.map((r) => [r.path, Number(r.n)]));
  }

  // ---- attachments --------------------------------------------------------

  /** An agent's own attachments, in stored order. */
  async agentDocs(agentId: string, dbOrTx: DbOrTx = this.db): Promise<AttachmentRow[]> {
    return dbOrTx
      .select({
        repoId: t.agentContextDocs.repoId,
        path: t.agentContextDocs.path,
        order: t.agentContextDocs.order,
      })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order), asc(t.agentContextDocs.path));
  }

  /** A single skill's attachments, in stored order. */
  async skillDocs(skillId: string, dbOrTx: DbOrTx = this.db): Promise<AttachmentRow[]> {
    return dbOrTx
      .select({
        repoId: t.skillContextDocs.repoId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
      })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order), asc(t.skillContextDocs.path));
  }

  /**
   * Attachments of several skills at once, for an agent's inherited group. The
   * caller orders the RESULT by its own skill-link order — a repository cannot
   * know it.
   */
  async skillDocsFor(skillIds: string[]): Promise<SkillAttachmentRow[]> {
    if (skillIds.length === 0) return [];
    return this.db
      .select({
        skillId: t.skillContextDocs.skillId,
        repoId: t.skillContextDocs.repoId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
      })
      .from(t.skillContextDocs)
      .where(inArray(t.skillContextDocs.skillId, skillIds))
      .orderBy(asc(t.skillContextDocs.order), asc(t.skillContextDocs.path));
  }

  /** Full replace of an agent's attachment set; `order` is the array position. */
  async replaceAgentDocs(
    agentId: string,
    rows: { repoId: string; path: string }[],
    dbOrTx: DbOrTx = this.db,
  ): Promise<void> {
    await dbOrTx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
    if (rows.length === 0) return;
    await dbOrTx
      .insert(t.agentContextDocs)
      .values(rows.map((r, i) => ({ agentId, repoId: r.repoId, path: r.path, order: i })));
  }

  /** Full replace of a skill's attachment set; `order` is the array position. */
  async replaceSkillDocs(
    skillId: string,
    rows: { repoId: string; path: string }[],
    dbOrTx: DbOrTx = this.db,
  ): Promise<void> {
    await dbOrTx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
    if (rows.length === 0) return;
    await dbOrTx
      .insert(t.skillContextDocs)
      .values(rows.map((r, i) => ({ skillId, repoId: r.repoId, path: r.path, order: i })));
  }
}
