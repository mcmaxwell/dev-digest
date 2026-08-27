import { and, count, desc, eq, max } from 'drizzle-orm';
import type { PublishSummary } from '@devdigest/shared';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L12 — publishing data-access layer. The only place that touches
 * `publish_attempts` and `publish_artifacts`.
 */

export type PublishAttemptRow = typeof t.publishAttempts.$inferSelect;

export class PublishRepository {
  constructor(private db: Db) {}

  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  async latestAttempt(workspaceId: string, reviewId: string): Promise<PublishAttemptRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.publishAttempts)
      .where(
        and(
          eq(t.publishAttempts.workspaceId, workspaceId),
          eq(t.publishAttempts.reviewId, reviewId),
        ),
      )
      .orderBy(desc(t.publishAttempts.createdAt))
      .limit(1);
    return row;
  }

  async insertAttempt(
    values: {
      workspaceId: string;
      repoId: string;
      reviewId: string;
      githubReviewId: string;
      reportKey: string | null;
    },
    dbOrTx: DbOrTx = this.db,
  ): Promise<PublishAttemptRow> {
    const [row] = await dbOrTx.insert(t.publishAttempts).values(values).returning();
    return row!;
  }

  async insertArtifact(
    values: { workspaceId: string; attemptId: string; key: string; bytes: number },
    dbOrTx: DbOrTx = this.db,
  ): Promise<void> {
    await dbOrTx.insert(t.publishArtifacts).values(values);
  }

  /** Publish counters per repo, joined with the repo name for the settings table. */
  async summaryForRepos(workspaceId: string): Promise<PublishSummary[]> {
    const rows = await this.db
      .select({
        repoId: t.publishAttempts.repoId,
        repoFullName: t.repos.fullName,
        published: count(t.publishAttempts.id),
        lastPublishedAt: max(t.publishAttempts.createdAt),
      })
      .from(t.publishAttempts)
      .innerJoin(t.repos, eq(t.repos.id, t.publishAttempts.repoId))
      .where(eq(t.publishAttempts.workspaceId, workspaceId))
      .groupBy(t.publishAttempts.repoId, t.repos.fullName);

    return rows.map((row) => ({
      repo_id: row.repoId,
      repo_full_name: row.repoFullName,
      published: Number(row.published),
      last_published_at: row.lastPublishedAt ? row.lastPublishedAt.toISOString() : null,
    }));
  }

  /**
   * Drop a repo's publish history and the artifact rows hanging off it.
   * ATOMIC: a half wipe leaves artifacts pointing at attempts that are gone,
   * and no caller ever wants one table cleared without the other.
   */
  async purgeHistoryForRepo(workspaceId: string, repoId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.publishArtifacts)
        .where(
          and(
            eq(t.publishArtifacts.workspaceId, workspaceId),
            eq(t.publishArtifacts.repoId, repoId),
          ),
        );
      await tx
        .delete(t.publishAttempts)
        .where(
          and(
            eq(t.publishAttempts.workspaceId, workspaceId),
            eq(t.publishAttempts.repoId, repoId),
          ),
        );
    });
  }
}
