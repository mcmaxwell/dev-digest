import type { BlastDownstream, PrBlast } from '../api/index.js';
import { clip } from '../format/truncate.js';

/**
 * The rules that turn a blast-radius envelope into the tool's advertised output.
 *
 * They live in `src/rules/` rather than in the tool file because
 * `src/format/render.ts` needs the SHAPE to render its text, and the tool needs
 * the renderer - putting the shape in the tool would make those two files
 * circular (`no-circular` in .dependency-cruiser.cjs).
 */

/** Exactly the tool's `outputSchema`, as a TypeScript type. */
export interface ShapedBlast {
  changed_symbols: { name: string; file: string; kind: string }[];
  downstream: {
    symbol: string;
    callers: { name: string; file: string; line: number; rank: number }[];
    endpoints_affected: string[];
    crons_affected: string[];
  }[];
  summary: string;
  index_status: 'ok' | 'partial' | 'degraded';
}

export interface ShapeOptions {
  maxCallers: number;
  minRank: number;
  includeEndpoints: boolean;
}

/** A `references.line` beyond this is not a line number, it is a bug. */
export const MAX_LINE = 1_000_000;

/**
 * PURE: the API's envelope -> exactly the advertised output schema.
 *
 * Three decisions live here:
 *
 *  - `min_rank` IS IGNORED when the index is unranked. Every caller scores 0 in
 *    that state, so honouring the filter would return an empty list that reads
 *    as "nothing calls this". The result text says the filter was ignored, so
 *    the override is never silent.
 *  - `include_endpoints: false` ZEROES the arrays, it does not remove the keys.
 *    The SDK validates `structuredContent` against `outputSchema`, and a missing
 *    required key fails the whole call.
 *  - Every string that came out of somebody else's repository goes through
 *    `clip()`, which collapses whitespace - a symbol name carrying newlines
 *    could otherwise forge extra lines in the rendered result.
 */
export function shape(page: PrBlast, opts: ShapeOptions): ShapedBlast {
  const minRank = page.index.ranked ? opts.minRank : 0;
  return {
    changed_symbols: page.blast.changed_symbols.map((s) => ({
      name: clipName(s.name),
      file: clipName(s.file),
      kind: clipName(s.kind ?? 'symbol'),
    })),
    downstream: page.blast.downstream.map((d) => shapeDownstream(d, opts, minRank)),
    summary: clip(page.blast.summary ?? '', 600),
    index_status: page.index.status,
  };
}

function shapeDownstream(d: BlastDownstream, opts: ShapeOptions, minRank: number) {
  const callers = d.callers
    .filter((c) => (c.rank ?? 0) >= minRank)
    .slice(0, opts.maxCallers)
    .map((c) => ({
      name: clipName(c.name),
      file: clipName(c.file),
      line: Math.max(0, Math.min(MAX_LINE, c.line)),
      rank: Math.max(0, Math.min(1, c.rank ?? 0)),
    }));
  return {
    symbol: clipName(d.symbol),
    callers,
    endpoints_affected: opts.includeEndpoints ? d.endpoints_affected.map(clipName) : [],
    crons_affected: opts.includeEndpoints ? d.crons_affected.map(clipName) : [],
  };
}

/** Identifiers and paths are short by nature; anything longer is not one. */
function clipName(text: string): string {
  return clip(text, 200);
}
