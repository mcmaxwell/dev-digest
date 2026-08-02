import type { Container } from '../../platform/container.js';
import type { Skill, SkillImportPreview, SkillSource, SkillType } from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { parseSkillImport, toSkillDto } from './helpers.js';

/**
 * A1 — skills service. Business logic for the Skills page + the skill editor.
 *
 * A Skill = reusable markdown instruction block attached to agents (the DB is
 * the source of truth; linked+enabled skills are appended to the agent's
 * prompt by the review run). Body edits are versioned via `skill_versions`.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    // Built from container.db, NOT a container getter — tests construct the
    // service with a bare `{ db }` container (see server/INSIGHTS.md).
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /** Create a skill (insert + version-1 snapshot are one unit). */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.transaction((tx) =>
      this.repo.insert(
        {
          workspaceId,
          name: input.name,
          description: input.description ?? '',
          type: input.type,
          source: input.source ?? 'manual',
          body: input.body,
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
        tx,
      ),
    );
    return toSkillDto(row);
  }

  /** Update a skill (row update + body-version snapshot are one unit). */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.transaction((tx) =>
      this.repo.update(workspaceId, id, patch, tx),
    );
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Parse an uploaded .md / .zip into an import PREVIEW. Persists nothing —
   * the client shows the extracted core and only a confirmed `POST /skills`
   * saves it (as `source: imported_file`, disabled until vetted).
   */
  importPreview(filename: string, data: Uint8Array): SkillImportPreview {
    const parsed = parseSkillImport(filename, data);
    return {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      warnings: parsed.warnings,
      skipped_entries: parsed.skippedEntries,
    };
  }
}
