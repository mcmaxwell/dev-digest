import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { parseSkillImport, toSkillDto, toSkillVersionDto } from './helpers.js';

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

  constructor(private container: Container) {
    // Built from container.db, NOT a container getter — tests construct the
    // service with a bare `{ db }` container (see server/INSIGHTS.md). Only
    // stats() reaches through container getters (agentsRepo/reviewRepo).
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

  /** Body-version history, newest first; undefined when the skill isn't ours. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Roll back the skill's body to a past version. History stays immutable:
   * the target body is saved through the normal update path, so it lands as
   * version N+1 (restoring the current body is a no-op and bumps nothing).
   */
  async rollback(workspaceId: string, id: string, version: number): Promise<Skill> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) throw new NotFoundError('Skill not found');
    const target = await this.repo.getVersion(id, version);
    if (!target) throw new NotFoundError('Skill version not found');
    const row = await this.repo.transaction((tx) =>
      this.repo.update(workspaceId, id, { body: target.body }, tx),
    );
    // The skill existed above and rollback is single-user local-first; a
    // concurrent delete still surfaces as a clean 404.
    if (!row) throw new NotFoundError('Skill not found');
    return toSkillDto(row);
  }

  /**
   * Usage statistics, attributed transitively: the agents this skill is linked
   * to, plus those agents' runs and review findings (runs don't record skill
   * ids — see run_traces — so linkage is the best available attribution).
   */
  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const agents = await this.container.agentsRepo.agentsForSkill(id);
    const agg = await this.container.reviewRepo.statsForAgents(agents.map((a) => a.id));
    return {
      agents,
      runs_count: agg.runsCount,
      last_run_at: agg.lastRunAt ? agg.lastRunAt.toISOString() : null,
      findings_count: agg.findingsCount,
      accepted_count: agg.acceptedCount,
      dismissed_count: agg.dismissedCount,
    };
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
