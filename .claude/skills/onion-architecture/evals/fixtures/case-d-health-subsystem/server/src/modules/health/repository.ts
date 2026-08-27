import { and, desc, eq, gte } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import type { HealthScore, HealthTrendPoint } from '@devdigest/shared';
import * as t from '../../db/schema.js';

/**
 * L10 — health data-access layer. The only place that touches the
 * `health_scores` and `health_samples` tables.
 */
export class HealthRepository {
  constructor(private container: Container) {}

  async latest(workspaceId: string, repoId: string): Promise<HealthScore | undefined> {
    const [row] = await this.container.db
      .select()
      .from(t.healthScores)
      .where(and(eq(t.healthScores.workspaceId, workspaceId), eq(t.healthScores.repoId, repoId)))
      .orderBy(desc(t.healthScores.createdAt))
      .limit(1);
    if (!row) return undefined;
    return {
      repo_id: row.repoId,
      score: row.score,
      counts: {
        critical: row.critical,
        warning: row.warning,
        suggestion: row.suggestion,
      },
      churn_files: row.churnFiles,
    };
  }

  async trend(workspaceId: string, repoId: string, since: Date): Promise<HealthTrendPoint[]> {
    const rows = await this.container.db
      .select()
      .from(t.healthSamples)
      .where(
        and(
          eq(t.healthSamples.workspaceId, workspaceId),
          eq(t.healthSamples.repoId, repoId),
          gte(t.healthSamples.createdAt, since),
        ),
      )
      .orderBy(t.healthSamples.createdAt);
    return rows.map((row) => ({
      day: row.createdAt.toISOString().slice(0, 10),
      score: row.score,
    }));
  }

  async insertScore(
    workspaceId: string,
    repoId: string,
    score: number,
    counts: { critical: number; warning: number; suggestion: number },
    churnFiles: number,
  ): Promise<void> {
    await this.container.db.insert(t.healthScores).values({
      workspaceId,
      repoId,
      score,
      critical: counts.critical,
      warning: counts.warning,
      suggestion: counts.suggestion,
      churnFiles,
    });
  }
}
