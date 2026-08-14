import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

/**
 * A1 — skills data-access. Owns `skills` + `skill_versions` (immutable body
 * history). The `agent_skills` link table is owned by A2's agents repository
 * (link/reorder happen from the agent's side); this repository only reads and
 * writes the skill rows themselves. Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  /** Open a transaction; the SERVICE picks the boundary (see server/INSIGHTS.md). */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill, dbOrTx: DbOrTx = this.db): Promise<SkillRow> {
    const [row] = await dbOrTx
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
      })
      .returning();
    await this.snapshotVersion(row!, dbOrTx);
    return row!;
  }

  /**
   * Update a skill. A BODY change bumps the version and snapshots the new body
   * into skill_versions ("saving a changed body creates a new immutable
   * version"); metadata-only changes (name/description/type/enabled) don't.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    dbOrTx: DbOrTx = this.db,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await dbOrTx
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, dbOrTx);
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions + agent links cascade. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  private async snapshotVersion(row: SkillRow, dbOrTx: DbOrTx): Promise<void> {
    await dbOrTx
      .insert(t.skillVersions)
      .values({ skillId: row.id, version: row.version, body: row.body })
      .onConflictDoNothing();
  }
}
