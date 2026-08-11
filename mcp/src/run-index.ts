import type { Named } from './format/slug.js';

/**
 * `run_id -> the PR it belongs to`, remembered in this process.
 *
 * The API has no route that maps a run to its PR (`GET /runs/:id/trace` returns
 * `RunTrace.config` WITHOUT a `pr_id`), so `get_findings` by `run_id` can only
 * answer for runs this server started. That is a documented limitation, and
 * removing it is the optional bonus of the L04 exercise: add
 * `GET /runs/:id -> { run_id, pr_id, status }` in
 * `server/src/modules/reviews/routes.ts` and this index becomes a cache rather
 * than the source of truth.
 *
 * Bounded because an MCP server can stay alive for days; it is an LRU so a long
 * session keeps the runs it is actually revisiting.
 */
export interface RunRef {
  runId: string;
  prId: string;
  /** "owner/name", as the caller typed it - used to render the header again. */
  repo: string;
  prNumber: number;
  agent: Named;
}

export const DEFAULT_RUN_INDEX_SIZE = 100;

export class RunIndex {
  private readonly entries = new Map<string, RunRef>();

  constructor(private readonly max: number = DEFAULT_RUN_INDEX_SIZE) {}

  remember(ref: RunRef): void {
    this.entries.delete(ref.runId);
    this.entries.set(ref.runId, ref);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  lookup(runId: string): RunRef | undefined {
    const hit = this.entries.get(runId);
    if (!hit) return undefined;
    // Touch: a run the caller keeps asking about should outlive noisier ones.
    this.entries.delete(runId);
    this.entries.set(runId, hit);
    return hit;
  }

  get size(): number {
    return this.entries.size;
  }
}
