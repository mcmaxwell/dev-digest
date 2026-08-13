import {
  ENTRY_POINT_NAMES,
  HEURISTIC_EXCLUDE_PATTERNS,
  MAX_CRITICAL_PATHS,
  MAX_READING_ENTRIES,
} from './constants.js';
import type { IssueRow, MarkerRow } from './types.js';

/**
 * L06 — the candidate sets a tour row may be drawn from. PURE: no I/O, no
 * Container.
 *
 * These exist because post-hoc verification cannot satisfy AC-8 ("the reading
 * path's order matches `getTopFilesByRank`") or AC-23 ("critical-path entries
 * all appear in `getCriticalPaths` output"). Both are MEMBERSHIP and ORDERING
 * properties, and the only way to make them hold is to build the rows from
 * these sets in the first place. Verification then only has to catch prose
 * paths, links and run-step sources.
 */

/**
 * Reading-path candidates. `getTopFilesByRank` has already applied the
 * junk-path filter and ordered by PageRank-derived rank, so this preserves its
 * order VERBATIM — re-sorting here would be the one thing AC-8 forbids.
 */
export function readingCandidates(topFilesByRank: string[], limit = MAX_READING_ENTRIES): string[] {
  const out: string[] = [];
  for (const path of topFilesByRank) {
    if (out.includes(path)) continue;
    out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Critical-path candidates: the dependency chains flattened into a single
 * ordered set. Chains already start from the highest-ranked roots, so flatten
 * order is rank order; `rankedOrder` is a stable tie-break for paths a chain
 * reached out of rank sequence, and paths it does not know keep their flatten
 * position at the end.
 */
export function criticalCandidates(
  chains: string[][],
  rankedOrder: string[] = [],
  limit = MAX_CRITICAL_PATHS,
): string[] {
  const flat: string[] = [];
  for (const chain of chains) {
    for (const path of chain) {
      if (!flat.includes(path)) flat.push(path);
    }
  }
  const rankIndex = new Map(rankedOrder.map((p, i) => [p, i]));
  const ordered = flat
    .map((path, i) => ({ path, rank: rankIndex.get(path) ?? Number.MAX_SAFE_INTEGER, i }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
    .map((r) => r.path);
  return ordered.slice(0, limit);
}

/** One candidate first task, already resolved to a marker line or an issue. */
export interface FirstTaskCandidate {
  title: string;
  origin: 'todo' | 'issue';
  path: string | null;
  line: number | null;
  issueNumber: number | null;
}

/**
 * First-task candidates: `TODO`/`FIXME` markers first (they cite a line in this
 * repository, which is the strongest citation available), then labelled issues.
 * Nothing else may become a first task — AC-29 names exactly these two sources.
 */
export function firstTaskCandidates(
  markers: MarkerRow[],
  issues: IssueRow[],
): FirstTaskCandidate[] {
  const fromMarkers = markers.map<FirstTaskCandidate>((m) => ({
    title: markerTitle(m),
    origin: 'todo',
    path: m.path,
    line: m.line,
    issueNumber: null,
  }));
  const fromIssues = issues.map<FirstTaskCandidate>((i) => ({
    title: i.title,
    origin: 'issue',
    path: null,
    line: null,
    issueNumber: i.number,
  }));
  return [...fromMarkers, ...fromIssues];
}

/** The marker's own text, trimmed of comment syntax, as the task's title. */
function markerTitle(m: MarkerRow): string {
  const text = m.text
    .trim()
    .replace(/^[\s*/#<!-]+/, '')
    .trim();
  return text.length > 0 ? text : `${m.path}:${m.line}`;
}

/**
 * The no-graph fallback (AC-57): rank a clone's tracked files by directory
 * prominence and entry-point naming when the import graph is unavailable.
 *
 * Its input is the `string[]` from `GitClient.listFiles`, and supplying it is
 * the only reason that port method exists — `getRepoMap` degrades to empty
 * under exactly the unindexed condition this fallback is for, and no other port
 * can list a clone's files.
 */
export function heuristicCandidates(files: string[], limit: number): string[] {
  const kept = files.filter(
    (p) => p.length > 0 && !HEURISTIC_EXCLUDE_PATTERNS.some((pat) => p.includes(pat)),
  );

  // Directory prominence: how much of the repository lives under each
  // top-level directory. A newcomer should be pointed at the busy one.
  const perDir = new Map<string, number>();
  for (const path of kept) {
    const dir = topLevelDir(path);
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
  }

  const scored = kept.map((path, i) => ({
    path,
    i,
    score:
      (perDir.get(topLevelDir(path)) ?? 0) +
      (isEntryPoint(path) ? 500 : 0) -
      depthOf(path) * 5,
  }));

  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)))
    .slice(0, limit)
    .map((r) => r.path);
}

function topLevelDir(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '.' : path.slice(0, slash);
}

function depthOf(path: string): number {
  return path.split('/').length - 1;
}

function isEntryPoint(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  const stem = base.includes('.') ? base.slice(0, base.indexOf('.')) : base;
  return ENTRY_POINT_NAMES.includes(stem.toLowerCase());
}
