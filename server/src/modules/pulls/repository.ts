import { and, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrFileInput, PrCommitInput, PrUpsert } from './types.js';

/**
 * F1 — pulls data-access layer. The ONLY place that touches `pull_requests`,
 * `pr_files` and `pr_commits`. Reads that need `reviews`/`findings`/`agent_runs`
 * go through `container.reviewRepo` instead — those tables belong to the
 * reviews module.
 *
 * Methods that participate in a multi-write operation take a `DbOrTx` so the
 * SERVICE can own the transaction boundary.
 */

export type PullRow = typeof t.pullRequests.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;

export class PullsRepository {
  constructor(private db: Db) {}

  /** Run `fn` inside a transaction; every repo call taking `tx` joins it. */
  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }

  listByRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  /** Address a PR the way the UI routes do: repo + PR number (unique together). */
  async getByNumber(repoId: string, number: number): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, number)));
    return row;
  }

  async getById(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * Idempotent PR import (unique `repo_id + number`). Used by BOTH the PR-list
   * read and the manual poll — the single definition keeps the two in step.
   * `opened_at` is only ever written on insert; GitHub never changes it.
   */
  async upsert(values: PrUpsert, db: DbOrTx = this.db): Promise<void> {
    await db
      .insert(t.pullRequests)
      .values(values)
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: values.title,
          headSha: values.headSha,
          status: values.status,
          updatedAt: values.updatedAt,
        },
      });
  }

  /** Backfill diff stats that GitHub's PR-LIST payload does not carry. */
  async updateDiffStats(
    prId: string,
    stats: { additions: number; deletions: number; filesCount: number },
    db: DbOrTx = this.db,
  ): Promise<void> {
    await db.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, prId));
  }

  getFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  getCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  /**
   * Replace a PR's persisted files + commits and refresh its body/diff stats.
   * ATOMIC by contract: the delete→insert pairs would otherwise leave the PR
   * with zero files if the process died mid-way, destroying the very data the
   * offline detail fallback reads.
   */
  async replaceDetail(
    prId: string,
    detail: {
      files: PrFileInput[];
      commits: PrCommitInput[];
      body: string | null;
      additions: number;
      deletions: number;
      filesCount: number;
    },
  ): Promise<void> {
    await this.transaction(async (tx) => {
      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (detail.files.length > 0) {
        await tx.insert(t.prFiles).values(detail.files.map((f) => ({ prId, ...f })));
      }
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (detail.commits.length > 0) {
        await tx.insert(t.prCommits).values(detail.commits.map((c) => ({ prId, ...c })));
      }
      await tx
        .update(t.pullRequests)
        .set({
          body: detail.body,
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.filesCount,
        })
        .where(eq(t.pullRequests.id, prId));
    });
  }
}
