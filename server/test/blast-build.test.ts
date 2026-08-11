/**
 * `buildBlast` — the pure index-rows-to-response mapper.
 *
 * The three properties under test are the ones that make the card honest: the
 * cap is per symbol, a symbol with no callers survives, and a file with no
 * `file_facts` row means "no endpoints", not a crash.
 */
import { describe, it, expect } from 'vitest';
import { buildBlast } from '../src/modules/blast/build.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/blast/constants.js';
import type { BlastCallerRow, BlastResult } from '../src/modules/repo-intel/types.js';

function caller(over: Partial<BlastCallerRow> & { viaSymbol: string }): BlastCallerRow {
  return {
    file: 'src/caller.ts',
    symbol: 'callIt',
    line: 10,
    rank: 0.5,
    ...over,
  };
}

function result(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    degraded: false,
    ...over,
  };
}

describe('buildBlast — per-symbol caps', () => {
  it('caps at MAX_CALLERS_PER_SYMBOL for EACH symbol, never across them', () => {
    const callers = [
      ...Array.from({ length: 21 }, (_, i) =>
        caller({ viaSymbol: 'A', file: `src/a${String(i).padStart(2, '0')}.ts`, line: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        caller({ viaSymbol: 'B', file: `src/b${i}.ts`, line: i + 1 }),
      ),
    ];
    const blast = buildBlast({
      result: result({
        changedSymbols: [
          { name: 'A', file: 'src/mod.ts', kind: 'function' },
          { name: 'B', file: 'src/mod.ts', kind: 'function' },
        ],
        callers,
      }),
      reverse: [],
      facts: [],
      summary: '',
    });

    const byName = new Map(blast.downstream.map((d) => [d.symbol, d]));
    expect(byName.get('A')!.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(byName.get('A')!.caller_total).toBe(21);
    // A global cap of 20 would have left B with nothing.
    expect(byName.get('B')!.callers).toHaveLength(5);
    expect(byName.get('B')!.caller_total).toBe(5);
  });

  it('keeps a symbol with zero callers — "nothing calls this" is a result', () => {
    const blast = buildBlast({
      result: result({ changedSymbols: [{ name: 'Lonely', file: 'src/x.ts', kind: 'function' }] }),
      reverse: [],
      facts: [],
      summary: '',
    });
    expect(blast.changed_symbols).toHaveLength(1);
    expect(blast.downstream[0]).toMatchObject({ symbol: 'Lonely', callers: [], caller_total: 0 });
  });

  it('orders callers by rank, then path, then line — so truncation is stable', () => {
    const blast = buildBlast({
      result: result({
        changedSymbols: [{ name: 'A', file: 'src/mod.ts', kind: 'function' }],
        callers: [
          caller({ viaSymbol: 'A', file: 'src/z.ts', rank: 0.1 }),
          caller({ viaSymbol: 'A', file: 'src/b.ts', rank: 0.9 }),
          caller({ viaSymbol: 'A', file: 'src/a.ts', rank: 0.9, line: 40 }),
          caller({ viaSymbol: 'A', file: 'src/a.ts', rank: 0.9, line: 5 }),
        ],
      }),
      reverse: [],
      facts: [],
      summary: '',
    });
    expect(blast.downstream[0]!.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/a.ts:5',
      'src/a.ts:40',
      'src/b.ts:10',
      'src/z.ts:10',
    ]);
  });

  it('clamps an out-of-range rank instead of letting it fail validation', () => {
    const blast = buildBlast({
      result: result({
        changedSymbols: [{ name: 'A', file: 'src/mod.ts', kind: 'function' }],
        callers: [caller({ viaSymbol: 'A', rank: 4.2 })],
      }),
      reverse: [],
      facts: [],
      summary: '',
    });
    expect(blast.downstream[0]!.callers[0]!.rank).toBe(1);
  });
});

describe('buildBlast — endpoints and crons', () => {
  it('unions facts across callers, the declaring file, and the reverse walk', () => {
    const blast = buildBlast({
      result: result({
        changedSymbols: [{ name: 'save', file: 'src/repository.ts', kind: 'function' }],
        callers: [caller({ viaSymbol: 'save', file: 'src/service.ts' })],
      }),
      // routes.ts never names `save`; it only imports service.ts, which imports
      // repository.ts. Depth 2 is the ONLY way its endpoint is reachable.
      reverse: [
        { depth: 1, importers: [{ file: 'src/service.ts', target: 'src/repository.ts' }] },
        { depth: 2, importers: [{ file: 'src/routes.ts', target: 'src/repository.ts' }] },
      ],
      facts: [
        { file: 'src/routes.ts', endpoints: ['POST /things'], crons: [] },
        { file: 'src/repository.ts', endpoints: [], crons: ['nightly-compact'] },
      ],
      summary: '',
    });

    const down = blast.downstream[0]!;
    expect(down.endpoints_affected).toEqual(['POST /things']);
    expect(down.endpoints_total).toBe(1);
    // Crons reach the response too — they used to stop at factsByFile.
    expect(down.crons_affected).toEqual(['nightly-compact']);
    expect(down.crons_total).toBe(1);
  });

  it('treats a file with no file_facts row as "no endpoints", not an error', () => {
    const blast = buildBlast({
      result: result({
        changedSymbols: [{ name: 'A', file: 'src/mod.ts', kind: 'function' }],
        callers: [caller({ viaSymbol: 'A', file: 'src/nofacts.ts' })],
      }),
      reverse: [],
      facts: [],
      summary: '',
    });
    expect(blast.downstream[0]).toMatchObject({
      endpoints_affected: [],
      endpoints_total: 0,
      crons_affected: [],
      crons_total: 0,
    });
  });

  it('does not leak one changed file’s importers onto another’s symbols', () => {
    const blast = buildBlast({
      result: result({
        changedSymbols: [
          { name: 'A', file: 'src/a.ts', kind: 'function' },
          { name: 'B', file: 'src/b.ts', kind: 'function' },
        ],
      }),
      reverse: [{ depth: 1, importers: [{ file: 'src/routes.ts', target: 'src/a.ts' }] }],
      facts: [{ file: 'src/routes.ts', endpoints: ['GET /a'], crons: [] }],
      summary: '',
    });
    const byName = new Map(blast.downstream.map((d) => [d.symbol, d]));
    expect(byName.get('A')!.endpoints_affected).toEqual(['GET /a']);
    expect(byName.get('B')!.endpoints_affected).toEqual([]);
  });

  it('passes the persisted summary through untouched', () => {
    const blast = buildBlast({
      result: result(),
      reverse: [],
      facts: [],
      summary: 'Touches the payments write path.',
    });
    expect(blast.summary).toBe('Touches the payments write path.');
  });
});
