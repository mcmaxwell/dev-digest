import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/** One prior PR of the same repository that touched at least one of the paths. */
export interface OverlappingPull {
  number: number;
  title: string;
  author: string;
  /** Most recent activity. `pull_requests` stores no merge time. */
  at: Date | null;
  /** Only the paths that overlap — the caller ranks on their count. */
  paths: string[];
}

/**
 * Prior PRs of the same repository whose changed files intersect `paths`,
 * newest first.
 *
 * It lives HERE, not in `modules/brief`, because it reads `pr_files` and
 * `pull_requests`, both of which this repository already owns — a table has
 * exactly one owning repository, so the brief reaches it through
 * `container.reviewRepo` instead of growing a second reader.
 *
 * Two queries rather than one join, deliberately: the first bounds the answer to
 * `limit` PULL REQUESTS (a join with a row limit would truncate one PR's path
 * list and silently under-report its overlap), the second fetches the overlapping
 * paths for exactly those. Both are covered by existing indexes.
 *
 * RANKING IS NOT DONE HERE. `modules/brief/history.ts` ranks the candidates by
 * overlap size, so the rule lives in a pure file that can be tested as a table.
 */
export async function overlappingPulls(
  db: Db,
  repoId: string,
  prId: string,
  paths: string[],
  limit: number,
): Promise<OverlappingPull[]> {
  if (paths.length === 0 || limit <= 0) return [];

  const candidates = await db
    .select({
      id: t.pullRequests.id,
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      author: t.pullRequests.author,
      updatedAt: t.pullRequests.updatedAt,
      openedAt: t.pullRequests.openedAt,
    })
    .from(t.pullRequests)
    .where(
      and(
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, prId),
        inArray(
          t.pullRequests.id,
          db.select({ id: t.prFiles.prId }).from(t.prFiles).where(inArray(t.prFiles.path, paths)),
        ),
      ),
    )
    .orderBy(desc(t.pullRequests.updatedAt))
    .limit(limit);

  if (candidates.length === 0) return [];

  const files = await db
    .select({ prId: t.prFiles.prId, path: t.prFiles.path })
    .from(t.prFiles)
    .where(
      and(
        inArray(
          t.prFiles.prId,
          candidates.map((c) => c.id),
        ),
        inArray(t.prFiles.path, paths),
      ),
    );

  const byPr = new Map<string, string[]>();
  for (const f of files) {
    const list = byPr.get(f.prId);
    if (list) list.push(f.path);
    else byPr.set(f.prId, [f.path]);
  }

  return candidates.map((c) => ({
    number: c.number,
    title: c.title,
    author: c.author,
    at: c.updatedAt ?? c.openedAt ?? null,
    paths: byPr.get(c.id) ?? [],
  }));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: DbOrTx, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}
