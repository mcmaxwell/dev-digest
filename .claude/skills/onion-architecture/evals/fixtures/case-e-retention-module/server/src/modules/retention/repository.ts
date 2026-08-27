import { and, count, eq, min } from 'drizzle-orm';
import type { RetentionPolicy, RetentionSummary } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L11 — retention data-access layer. The only place that touches
 * `retention_policies`, `run_archives` and `run_archive_files`.
 */

export type RetentionPolicyRow = typeof t.retentionPolicies.$inferSelect;
export type RunArchiveRow = typeof t.runArchives.$inferSelect;

export class RetentionRepository {
  constructor(private db: Db) {}

  async getPolicy(workspaceId: string, repoId: string): Promise<RetentionPolicy | undefined> {
    const [row] = await this.db
      .select()
      .from(t.retentionPolicies)
      .where(
        and(
          eq(t.retentionPolicies.workspaceId, workspaceId),
          eq(t.retentionPolicies.repoId, repoId),
        ),
      );
    if (!row) return undefined;
    return {
      repo_id: row.repoId,
      keep_days: row.keepDays,
      archive_logs: row.archiveLogs,
    };
  }

  async listArchives(workspaceId: string, repoId: string): Promise<RunArchiveRow[]> {
    return this.db
      .select()
      .from(t.runArchives)
      .where(and(eq(t.runArchives.workspaceId, workspaceId), eq(t.runArchives.repoId, repoId)));
  }

  /** Archive counters per repo, joined with the repo's name for the settings table. */
  async summaryForRepos(workspaceId: string, repoIds: string[]): Promise<RetentionSummary[]> {
    const rows = await this.db
      .select({
        repoId: t.runArchives.repoId,
        repoFullName: t.repos.fullName,
        archivedRuns: count(t.runArchives.id),
        oldestArchivedAt: min(t.runArchives.archivedAt),
      })
      .from(t.runArchives)
      .innerJoin(t.repos, eq(t.repos.id, t.runArchives.repoId))
      .where(eq(t.runArchives.workspaceId, workspaceId))
      .groupBy(t.runArchives.repoId, t.repos.fullName);

    return rows
      .filter((row) => repoIds.includes(row.repoId))
      .map((row) => ({
        repo_id: row.repoId,
        repo_full_name: row.repoFullName,
        archived_runs: Number(row.archivedRuns),
        oldest_archived_at: row.oldestArchivedAt ? row.oldestArchivedAt.toISOString() : null,
      }));
  }

  /**
   * Drop a repo's archive rows and the file rows hanging off them.
   * ATOMIC: a half purge leaves archive_files pointing at archives that are
   * already gone, and nothing ever wants one table cleared without the other.
   */
  async purgeArchivesForRepo(workspaceId: string, repoId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.runArchiveFiles)
        .where(and(eq(t.runArchiveFiles.workspaceId, workspaceId), eq(t.runArchiveFiles.repoId, repoId)));
      await tx
        .delete(t.runArchives)
        .where(and(eq(t.runArchives.workspaceId, workspaceId), eq(t.runArchives.repoId, repoId)));
    });
  }

  /** Move one finished run into the archive. */
  async archiveRun(workspaceId: string, runId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(t.agentRuns)
        .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.id, runId)));
      if (!run) return;
      if (run.status === 'running' || run.status === 'queued') return;

      const [policy] = await tx
        .select()
        .from(t.retentionPolicies)
        .where(
          and(
            eq(t.retentionPolicies.workspaceId, workspaceId),
            eq(t.retentionPolicies.repoId, run.repoId),
          ),
        );

      await tx.insert(t.runArchives).values({
        workspaceId,
        repoId: run.repoId,
        runId: run.id,
        archivedAt: new Date(),
      });

      if (policy?.archiveLogs !== true) {
        await tx.delete(t.agentRunLogs).where(eq(t.agentRunLogs.runId, runId));
      }

      await tx
        .update(t.agentRuns)
        .set({ archivedAt: new Date() })
        .where(eq(t.agentRuns.id, runId));
    });
  }
}
