import type { ChangedSymbol, PrBlastRadius, RankedBlastCaller } from '@devdigest/shared';
import type { BlastResult, FileFactsRow, ReverseLevel } from '../repo-intel/types.js';
import {
  MAX_CALLERS_PER_SYMBOL,
  MAX_CHANGED_SYMBOLS,
  MAX_CRONS_PER_SYMBOL,
  MAX_ENDPOINTS_PER_SYMBOL,
} from './constants.js';

export interface BuildBlastInput {
  /** What the repo-intel facade found: changed symbols and their direct callers. */
  result: BlastResult;
  /** The reverse import walk, level by level. Feeds endpoints/crons only. */
  reverse: ReverseLevel[];
  /** Precomputed facts for every file either path reached. */
  facts: FileFactsRow[];
  /** Persisted LLM summary, or '' when none has been asked for. */
  summary: string;
}

/**
 * PURE: index rows -> the served blast radius. No DB, no container, no clock.
 *
 * Three properties this function owns, each of them a test:
 *
 *  1. THE CAP IS PER SYMBOL. 21 callers of `A` and 5 of `B` yield 20 + 5, never
 *     20 in total. The SQL already caps this way; grouping and capping again
 *     here means the module stays correct even if the facade regresses.
 *  2. A SYMBOL WITH NO CALLERS IS KEPT. "Nothing known calls this" is a result.
 *     Dropping it would make an unindexed symbol indistinguishable from a leaf.
 *  3. A MISSING `file_facts` ROW MEANS ZERO ENDPOINTS, NOT AN ERROR. The indexer
 *     only writes a row when a file has at least one fact, so absence is the
 *     normal case. Whether facts were written AT ALL is a different question,
 *     answered by `BlastIndexState.facts`.
 *
 * ATTRIBUTION IS FILE-LEVEL, and deliberately so: `file_edges` is a graph of
 * files, so two symbols declared in the same changed file get the same endpoint
 * and cron sets. Splitting them per symbol would be invented precision.
 *
 * The declaring file's OWN facts are included in its symbols' reach: when a PR
 * edits the handler inside `routes.ts`, the endpoint declared in that same file
 * is affected, and reporting "no endpoints" there would be plainly wrong.
 */
export function buildBlast(input: BuildBlastInput): PrBlastRadius {
  const { result, reverse, facts, summary } = input;

  const factsByFile = new Map(facts.map((f) => [f.file, f]));

  // Which files reach which CHANGED FILE, from the reverse import walk. Callers
  // are added per symbol below; these are file-level and shared by every symbol
  // declared in the target file.
  const importersByTarget = new Map<string, Set<string>>();
  for (const level of reverse) {
    for (const { file, target } of level.importers) {
      let set = importersByTarget.get(target);
      if (!set) importersByTarget.set(target, (set = new Set()));
      set.add(file);
    }
  }

  // Callers grouped by the changed symbol they reach. Grouping by NAME mirrors
  // `references.to_symbol`, which is a name and not a resolved declaration - two
  // changed symbols that share a name therefore share callers. That is the
  // index's precision, not a rounding done here.
  const callersBySymbol = new Map<string, RankedBlastCaller[]>();
  for (const c of result.callers) {
    const list = callersBySymbol.get(c.viaSymbol);
    const caller: RankedBlastCaller = {
      name: c.symbol,
      file: c.file,
      line: c.line,
      // The contract bounds rank to 0..1 (pagerank sums to 1 across files). A
      // clamp here rather than a validation error at the route: an odd rank must
      // not be able to 500 a read.
      rank: Math.min(1, Math.max(0, c.rank)),
    };
    if (list) list.push(caller);
    else callersBySymbol.set(c.viaSymbol, [caller]);
  }

  const downstream = result.changedSymbols.map((sym) => {
    const all = callersBySymbol.get(sym.name) ?? [];
    all.sort(byRankThenLocation);
    const callers = all.slice(0, MAX_CALLERS_PER_SYMBOL);

    // reachable = the declaring file + every file that calls the symbol + every
    // file that imports the declaring file, one or two hops out.
    const reachable = new Set<string>([sym.file]);
    for (const c of all) reachable.add(c.file);
    for (const f of importersByTarget.get(sym.file) ?? []) reachable.add(f);

    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of reachable) {
      const hit = factsByFile.get(file);
      if (!hit) continue;
      for (const e of hit.endpoints) endpoints.add(e);
      for (const c of hit.crons) crons.add(c);
    }

    const endpointList = [...endpoints].sort();
    const cronList = [...crons].sort();

    return {
      symbol: sym.name,
      callers,
      caller_total: all.length,
      endpoints_affected: endpointList.slice(0, MAX_ENDPOINTS_PER_SYMBOL),
      endpoints_total: endpointList.length,
      crons_affected: cronList.slice(0, MAX_CRONS_PER_SYMBOL),
      crons_total: cronList.length,
    };
  });

  // Most-impactful first, so the cap below drops the least interesting symbols
  // rather than whatever the index happened to return last.
  const order = new Map(downstream.map((d, i) => [i, d]));
  const ranked = result.changedSymbols
    .map((sym, i): { sym: ChangedSymbol; down: (typeof downstream)[number] } => ({
      sym: { name: sym.name, file: sym.file, kind: sym.kind },
      down: order.get(i)!,
    }))
    .sort(
      (a, b) =>
        b.down.caller_total - a.down.caller_total ||
        b.down.endpoints_total - a.down.endpoints_total ||
        a.sym.file.localeCompare(b.sym.file) ||
        a.sym.name.localeCompare(b.sym.name),
    )
    .slice(0, MAX_CHANGED_SYMBOLS);

  return {
    changed_symbols: ranked.map((r) => r.sym),
    downstream: ranked.map((r) => r.down),
    // Counted BEFORE the cap above, so the card can report the truncation
    // instead of presenting the first MAX_CHANGED_SYMBOLS as the whole set.
    symbols_total: result.changedSymbols.length,
    summary,
  };
}

/** Highest rank first; ties broken by path then line so truncation is stable. */
function byRankThenLocation(a: RankedBlastCaller, b: RankedBlastCaller): number {
  return b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line;
}
