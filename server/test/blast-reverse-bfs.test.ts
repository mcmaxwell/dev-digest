/**
 * `RepoIntelService.getReverseImporters` — the two-level reverse import walk.
 *
 * Hermetic: the repository is replaced by an in-memory edge table, so the test
 * asserts the WALK (depth bound, cycle termination, provenance, caps) and not
 * Postgres.
 *
 * Why the walk exists at all: in `routes -> service -> repository`, a PR that
 * changes a function in `repository.ts` produces exactly one reference edge
 * (`service.ts` calls it). The endpoint lives in `routes.ts`, which never names
 * the changed symbol, so depth-1 callers cannot see it.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import {
  BFS_DEPTH,
  REVERSE_FANOUT_PER_LEVEL,
} from '../src/modules/repo-intel/constants.js';
import type { IndexerEdgeRow } from '../src/modules/repo-intel/repository.js';

/** Builds a service whose only repository method is a reverse edge lookup. */
function serviceWith(edges: IndexerEdgeRow[], opts: { flag?: boolean } = {}) {
  const calls: string[][] = [];
  const container = {
    config: { repoIntelEnabled: opts.flag ?? true },
    db: {} as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getImporters: async (_repoId: string, toFiles: string[], limit: number) => {
      calls.push([...toFiles]);
      return edges.filter((e) => toFiles.includes(e.toFile)).slice(0, limit);
    },
  };
  return { svc, calls };
}

describe('getReverseImporters', () => {
  it('reaches the endpoint file two hops out and labels each level', async () => {
    const { svc } = serviceWith([
      { fromFile: 'src/service.ts', toFile: 'src/repository.ts' },
      { fromFile: 'src/routes.ts', toFile: 'src/service.ts' },
      { fromFile: 'src/app.ts', toFile: 'src/routes.ts' },
    ]);

    const levels = await svc.getReverseImporters('r1', ['src/repository.ts'], BFS_DEPTH);

    expect(levels.map((l) => l.depth)).toEqual([1, 2]);
    expect(levels[0]!.importers).toEqual([
      { file: 'src/service.ts', target: 'src/repository.ts' },
    ]);
    expect(levels[1]!.importers).toEqual([{ file: 'src/routes.ts', target: 'src/repository.ts' }]);
  });

  it('stops at the requested depth — app.ts is three hops out and never appears', async () => {
    const { svc, calls } = serviceWith([
      { fromFile: 'src/service.ts', toFile: 'src/repository.ts' },
      { fromFile: 'src/routes.ts', toFile: 'src/service.ts' },
      { fromFile: 'src/app.ts', toFile: 'src/routes.ts' },
    ]);

    const levels = await svc.getReverseImporters('r1', ['src/repository.ts'], 2);
    const reached = levels.flatMap((l) => l.importers.map((i) => i.file));

    expect(reached).not.toContain('src/app.ts');
    // Exactly `depth` round trips, never one query per file.
    expect(calls).toHaveLength(2);
  });

  it('terminates on a cycle instead of oscillating between levels', async () => {
    const { svc } = serviceWith([
      { fromFile: 'src/b.ts', toFile: 'src/a.ts' },
      { fromFile: 'src/a.ts', toFile: 'src/b.ts' },
    ]);

    const levels = await svc.getReverseImporters('r1', ['src/a.ts'], BFS_DEPTH);

    // a.ts is seeded into `visited`, so the b -> a edge cannot walk back to it.
    expect(levels).toHaveLength(1);
    expect(levels[0]!.importers).toEqual([{ file: 'src/b.ts', target: 'src/a.ts' }]);
  });

  it('keeps provenance per changed file when several are in the same PR', async () => {
    const { svc } = serviceWith([
      { fromFile: 'src/shared.ts', toFile: 'src/a.ts' },
      { fromFile: 'src/only-b.ts', toFile: 'src/b.ts' },
    ]);

    const levels = await svc.getReverseImporters('r1', ['src/a.ts', 'src/b.ts'], 1);

    expect(levels[0]!.importers).toEqual([
      { file: 'src/shared.ts', target: 'src/a.ts' },
      { file: 'src/only-b.ts', target: 'src/b.ts' },
    ]);
  });

  it('caps the fan-out per level', async () => {
    const edges = Array.from({ length: REVERSE_FANOUT_PER_LEVEL + 50 }, (_, i) => ({
      fromFile: `src/importer-${String(i).padStart(4, '0')}.ts`,
      toFile: 'src/hot.ts',
    }));
    const { svc } = serviceWith(edges);

    const levels = await svc.getReverseImporters('r1', ['src/hot.ts'], 1);

    expect(levels[0]!.importers).toHaveLength(REVERSE_FANOUT_PER_LEVEL);
  });

  it('returns [] without querying when the feature flag is off', async () => {
    const { svc, calls } = serviceWith([{ fromFile: 'a', toFile: 'b' }], { flag: false });
    await expect(svc.getReverseImporters('r1', ['b'], 2)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns [] for an empty file list or a zero depth', async () => {
    const { svc, calls } = serviceWith([{ fromFile: 'a', toFile: 'b' }]);
    await expect(svc.getReverseImporters('r1', [], 2)).resolves.toEqual([]);
    await expect(svc.getReverseImporters('r1', ['b'], 0)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
