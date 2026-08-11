import type { RunSummary } from './api/index.js';

/**
 * Wait for one agent run to reach a terminal state, by POLLING
 * `GET /pulls/:id/runs`.
 *
 * Polling, not the SSE stream at `GET /runs/:id/events`, for three reasons:
 *
 * 1. Correctness. That stream is bridged off `container.runBus`, an IN-MEMORY
 *    bus. If the run finishes between the POST returning and our subscribe, or
 *    the API restarts, no `done` event ever arrives and the caller hangs. The
 *    `agent_runs` ROW in Postgres is the durable truth, and this is the route
 *    that reads it.
 * 2. Payload. One `GET /pulls/:id/runs` carries status, error, duration, cost,
 *    findings_count, severity_counts and score - the entire response header and
 *    the entire timeout payload, from the same request that detects completion.
 *    SSE would need a second call anyway.
 * 3. Dependencies. No EventSource client and no reconnect logic in a package
 *    with two runtime dependencies.
 */

export type WaitOutcome =
  | { kind: 'done'; run: RunSummary }
  | { kind: 'failed'; run: RunSummary }
  | { kind: 'cancelled'; run: RunSummary }
  /** The run row is gone - deleted, or the API lost it. */
  | { kind: 'missing' }
  | { kind: 'timeout'; run: RunSummary | undefined };

/**
 * Fast first probes catch a cheap 20-second run quickly; the 5s plateau keeps
 * the request count low. Worst case at 180s is ~38 reads, against a global
 * limit of 120/min.
 */
export const POLL_DELAYS_MS = [1000, 1000, 2000, 2000, 3000, 5000] as const;

export interface WaitOptions {
  waitMs: number;
  /** Injected so a test can run the whole schedule synchronously - fake timers
   *  fight the SDK's async machinery, an injected clock does not. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function waitForRun(
  api: { listRuns(prId: string): Promise<RunSummary[]> },
  prId: string,
  runId: string,
  opts: WaitOptions,
): Promise<WaitOutcome> {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const started = now();
  let last: RunSummary | undefined;

  for (let attempt = 0; ; attempt++) {
    const remaining = opts.waitMs - (now() - started);
    if (remaining <= 0) return { kind: 'timeout', run: last };

    const step = POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]!;
    // Trim the last sleep so the loop never overshoots `wait_seconds`.
    await sleep(Math.min(step, remaining));

    const rows = await api.listRuns(prId);
    const row = rows.find((r) => r.run_id === runId);
    if (!row) return { kind: 'missing' };
    last = row;
    if (row.status === 'done') return { kind: 'done', run: row };
    if (row.status === 'failed') return { kind: 'failed', run: row };
    if (row.status === 'cancelled') return { kind: 'cancelled', run: row };
  }
}
