import { describe, it, expect } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

/**
 * Regression: a job that exhausts its retries must mark its row failed and
 * reject `done` for awaiting callers — but must NOT surface as an unhandled
 * rejection, because production callers fire-and-forget and an unhandled
 * rejection kills the process (observed: a 403 on `git clone` took the API down).
 */

function fakeDb() {
  const updates: object[] = [];
  const db = {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'job-1' }],
      }),
    }),
    update: () => ({
      set: (patch: object) => ({
        where: async () => {
          updates.push(patch);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, updates };
}

describe('JobRunner failure handling', () => {
  it('a failing job rejects `done` but never raises an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { db, updates } = fakeDb();
      const runner = new JobRunner(db, { retries: 0, timeoutMs: 1_000 });
      runner.register('boom', async () => {
        throw new Error('clone exploded');
      });

      const { done } = await runner.enqueue('ws-1', 'boom', {});
      await runner.onIdle();
      // Give the microtask queue a full turn so a would-be unhandled
      // rejection has fired before we assert.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toHaveLength(0);
      await expect(done).rejects.toThrow('clone exploded');
      expect(updates.at(-1)).toMatchObject({ status: 'failed', error: 'clone exploded' });
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
