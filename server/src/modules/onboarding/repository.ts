import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L06 — onboarding data access. Owns exactly one table, `onboarding`, holding
 * exactly one row per repository.
 *
 * TENANCY. `onboarding` carries no `workspace_id`: it is keyed by `repo_id`, so
 * its tenancy comes from the layer ABOVE. `OnboardingService` resolves every
 * incoming repository through `container.reposRepo.getById(workspaceId, repoId)`
 * and 404s BEFORE calling anything here. The unscoped `where(eq(repoId, …))`
 * below is therefore deliberate — do not copy the pattern into a table that
 * does need scoping, and do not "fix" it by adding a workspace filter that has
 * no column to filter on.
 *
 * There is no list method and no history: one tour per repository is the whole
 * model, and AC-1 is a primary-key property rather than application logic.
 */

export interface OnboardingRow {
  repoId: string;
  json: unknown;
  headSha: string | null;
  status: 'ready' | 'degraded';
  generatedAt: Date;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  async get(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db
      .select({
        repoId: t.onboarding.repoId,
        json: t.onboarding.json,
        headSha: t.onboarding.headSha,
        status: t.onboarding.status,
        generatedAt: t.onboarding.generatedAt,
      })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /**
   * Replace a repository's tour with a newly generated one, in ONE statement.
   *
   * The document and its two projections (`head_sha`, `status`) are written
   * together and can never disagree; and because this is the only write, and it
   * happens at the END of a generation, the previous tour stays readable
   * throughout a regeneration and is replaced atomically when the new one
   * lands (AC-49, AC-50, AC-62).
   */
  async upsert(
    repoId: string,
    input: { document: unknown; headSha: string; status: 'ready' | 'degraded' },
  ): Promise<void> {
    const values = {
      json: input.document as object,
      headSha: input.headSha,
      status: input.status,
      generatedAt: new Date(),
    };
    await this.db
      .insert(t.onboarding)
      .values({ repoId, ...values })
      .onConflictDoUpdate({ target: t.onboarding.repoId, set: values });
  }
}
