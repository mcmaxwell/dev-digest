import { describe, it, expect } from 'vitest';
import {
  criticalCandidates,
  firstTaskCandidates,
  heuristicCandidates,
  readingCandidates,
} from './candidates.js';
import type { IssueRow, MarkerRow } from './types.js';

/**
 * L06 — the candidate sets, against the spec's own criteria.
 *
 *   AC-8   candidate files are ordered by the PageRank-derived file rank and by
 *          NO other ordering; the reading path's order matches
 *          `getTopFilesByRank` for the same repository.
 *   AC-22  at most 8 critical paths.
 *   AC-23  critical-path entries all appear in `getCriticalPaths` output.
 *   AC-27  at most 10 guided-reading entries.
 *   AC-29  first tasks come only from `TODO`/`FIXME` markers and from open
 *          issues labelled `good first issue`.
 *   AC-57  with no import graph, both path sections are built from directory
 *          prominence and entry-point heuristics — and are populated.
 */

/** What `getTopFilesByRank` returns: already rank-ordered, junk already gone. */
const RANKED = [
  'src/server.ts',
  'src/middleware/auth.ts',
  'src/lib/redis.ts',
  'src/routes/public.ts',
  'src/db/client.ts',
];

describe('L06 candidates — reading path (AC-8, AC-27)', () => {
  it('preserves the rank order it was given, verbatim', () => {
    // Not sorted, not deduped into a different order, not re-scored: the rank
    // IS the ordering the spec fixes, and any local re-sort is the one thing
    // AC-8 forbids.
    expect(readingCandidates(RANKED)).toEqual(RANKED);
  });

  it('keeps the highest-ranked entries when there are more than the cap allows', () => {
    const many = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
    const out = readingCandidates(many);

    expect(out).toHaveLength(10);
    expect(out).toEqual(many.slice(0, 10));
  });

  it('drops a repeated path without disturbing the order of the rest', () => {
    const out = readingCandidates(['a.ts', 'b.ts', 'a.ts', 'c.ts']);
    expect(out).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('L06 candidates — critical paths (AC-22, AC-23)', () => {
  const CHAINS = [
    ['src/routes/public.ts', 'src/middleware/auth.ts', 'src/lib/redis.ts'],
    ['src/server.ts', 'src/routes/public.ts'],
  ];

  it('draws every candidate from the dependency chains and nowhere else', () => {
    const flat = new Set(CHAINS.flat());
    const out = criticalCandidates(CHAINS, RANKED);

    expect(out.length).toBeGreaterThan(0);
    for (const path of out) expect(flat.has(path)).toBe(true);
    // Every chain member is reachable — nothing is silently discarded.
    expect(new Set(out)).toEqual(flat);
  });

  it('orders the flattened chains by file rank', () => {
    const out = criticalCandidates(CHAINS, RANKED);
    const rankOf = (p: string) => RANKED.indexOf(p);
    for (let i = 1; i < out.length; i += 1) {
      expect(rankOf(out[i - 1]!)).toBeLessThan(rankOf(out[i]!));
    }
  });

  it('lists at most 8', () => {
    const chains = [Array.from({ length: 14 }, (_, i) => `src/chain${i}.ts`)];
    expect(criticalCandidates(chains, [])).toHaveLength(8);
  });
});

describe('L06 candidates — first tasks (AC-29)', () => {
  const MARKERS: MarkerRow[] = [
    { path: 'src/middleware/auth.ts', line: 42, text: '  // TODO: rotate the signing key' },
    { path: 'src/lib/redis.ts', line: 7, text: '# FIXME reconnect backoff is linear' },
  ];
  const ISSUES: IssueRow[] = [{ number: 311, title: 'Document the rate-limit headers' }];

  it('builds every task from a marker line or a labelled issue, and from nothing else', () => {
    const out = firstTaskCandidates(MARKERS, ISSUES);

    expect(out).toHaveLength(3);
    for (const task of out) {
      if (task.origin === 'todo') {
        expect(task.path).toBeTruthy();
        expect(task.line).toBeGreaterThan(0);
        expect(task.issueNumber).toBeNull();
      } else {
        expect(task.issueNumber).toBe(311);
        expect(task.path).toBeNull();
      }
    }
  });

  it('carries the marker line and the issue number a reader can check it against', () => {
    const out = firstTaskCandidates(MARKERS, ISSUES);

    expect(out[0]).toMatchObject({
      origin: 'todo',
      path: 'src/middleware/auth.ts',
      line: 42,
    });
    expect(out[0]!.title).toContain('rotate the signing key');
    expect(out[2]).toMatchObject({ origin: 'issue', issueNumber: 311 });
  });

  it('produces nothing when neither source found anything', () => {
    expect(firstTaskCandidates([], [])).toEqual([]);
  });
});

describe('L06 candidates — the no-graph heuristic (AC-57)', () => {
  const LISTING = [
    'README.md',
    'src/index.ts',
    'src/routes/public.ts',
    'src/routes/private.ts',
    'src/routes/admin.ts',
    'src/lib/redis.ts',
    'scripts/one-off.sh',
    'node_modules/left-pad/index.js',
    'vendor/bundled/thing.js',
    'dist/bundle.min.js',
    'pnpm-lock.yaml',
  ];

  it('still produces a populated candidate list from a bare file listing', () => {
    const out = heuristicCandidates(LISTING, 10);
    expect(out.length).toBeGreaterThan(0);
  });

  it('puts a program entry point in front of an incidental file', () => {
    const out = heuristicCandidates(LISTING, 10);
    expect(out.indexOf('src/index.ts')).toBeLessThan(out.indexOf('src/lib/redis.ts'));
  });

  it('prefers the prominent directory over a sparse one, at equal depth', () => {
    // Compared at the same depth on purpose: the spec fixes "directory
    // prominence and entry-point heuristics" as the two signals and says
    // nothing about how a path's depth weighs against them.
    const out = heuristicCandidates(
      ['src/a/one.ts', 'src/a/two.ts', 'src/a/three.ts', 'tools/z/legacy.ts'],
      10,
    );
    expect(out.indexOf('src/a/one.ts')).toBeLessThan(out.indexOf('tools/z/legacy.ts'));
  });

  it('excludes vendored and generated paths, which a newcomer must never be sent to', () => {
    // The spec's "`TODO` marker inside a vendored dependency" edge case: junk
    // is filtered here the way `getTopFilesByRank` filters it on the graph path.
    const out = heuristicCandidates(LISTING, 20);
    for (const junk of [
      'node_modules/left-pad/index.js',
      'vendor/bundled/thing.js',
      'dist/bundle.min.js',
    ]) {
      expect(out).not.toContain(junk);
    }
  });

  it('respects the limit it is given', () => {
    expect(heuristicCandidates(LISTING, 3)).toHaveLength(3);
  });

  it('is deterministic: the same listing yields the same order twice', () => {
    expect(heuristicCandidates(LISTING, 10)).toEqual(heuristicCandidates(LISTING, 10));
  });
});
