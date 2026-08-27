/** L11 — retention pure helpers. */

/** The cutoff instant for a policy's keep window. */
export function cutoffFor(keepDays: number, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  return cutoff;
}

/** Runs older than the cutoff, oldest first. */
export function selectExpired<T extends { id: string; createdAt: Date }>(
  runs: T[],
  cutoff: Date,
): T[] {
  return runs
    .filter((run) => run.createdAt < cutoff)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
