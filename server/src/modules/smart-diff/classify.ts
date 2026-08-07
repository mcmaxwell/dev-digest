import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_DIRS,
  BOILERPLATE_FILES,
  BOILERPLATE_INFIXES,
  BOILERPLATE_ROOT_DIRS,
  BOILERPLATE_SUFFIXES,
  MAX_PLUMBING_LINE_CHARS,
  ROLE_ORDER,
  SPLIT_DIR_DEPTH,
  SPLIT_FILE_THRESHOLD,
  SPLIT_LINE_THRESHOLD,
  SPLIT_MIN_BUCKETS,
  WIRING_DIRS,
  WIRING_FILES,
  WIRING_PREFIXES,
  WIRING_STEMS,
  WIRING_STEM_PREFIXES,
  WIRING_SUFFIXES,
} from './constants.js';

/**
 * The Smart Diff classifier. PURE — no I/O, no container, no DB — so the whole
 * rule set is testable as a table (`test/smart-diff.test.ts`) without Postgres.
 *
 * It answers one question per changed file: is this the SUBSTANCE of the change
 * (`core`), the plumbing that hooks the substance into the app (`wiring`), or
 * mechanical bulk the reviewer should skim (`boilerplate`)? The answer comes
 * from the path and the patch alone, never from a model, so it is available the
 * moment a PR is imported and never costs a token.
 */

/** One changed file as the service reads it out of `pr_files`. */
export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** Which lines of which file the latest review flagged. Keyed by `path`. */
export type FindingLinesByPath = ReadonlyMap<string, readonly number[]>;

function segments(path: string): string[] {
  return path.toLowerCase().split('/').filter(Boolean);
}

function basename(path: string): string {
  const segs = segments(path);
  return segs[segs.length - 1] ?? '';
}

/** `a.config.ts` → `a.config`; `.eslintrc.json` → `.eslintrc`; `index.ts` → `index`. */
function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function isBoilerplate(path: string): boolean {
  const segs = segments(path);
  const name = basename(path);
  if (BOILERPLATE_FILES.some((f) => f === name)) return true;
  if (segs.slice(0, -1).some((seg) => BOILERPLATE_DIRS.some((d) => d === seg))) return true;
  if (segs.length > 1 && BOILERPLATE_ROOT_DIRS.some((d) => d === segs[0])) return true;
  if (BOILERPLATE_SUFFIXES.some((sfx) => name.endsWith(sfx))) return true;
  if (BOILERPLATE_INFIXES.some((inf) => name.includes(inf))) return true;
  return false;
}

function isWiringPath(path: string): boolean {
  const segs = segments(path);
  const name = basename(path);
  const base = stem(name);
  if (WIRING_FILES.some((f) => f === name)) return true;
  if (segs.slice(0, -1).some((seg) => WIRING_DIRS.some((d) => d === seg))) return true;
  if (WIRING_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (WIRING_SUFFIXES.some((sfx) => name.endsWith(sfx))) return true;
  if (WIRING_STEM_PREFIXES.some((p) => base.startsWith(p))) return true;
  if (WIRING_STEMS.some((s) => s === base)) return true;
  return false;
}

/**
 * A changed line that only moves symbols between modules rather than doing work.
 *
 * Two properties this regex MUST keep, because both were bugs:
 *
 * 1. Every alternative is END-ANCHORED or ends in a literal. An unanchored
 *    `[{}]` matched any line merely STARTING with a brace, so
 *    `}); await chargeCard(user);` counted as plumbing and demoted real logic
 *    from core to wiring — the one direction "core is the default" cannot
 *    protect against. Likewise a bare `export\b` matched
 *    `export const TAX_RATE = 0.35;`, so only re-export forms are accepted.
 * 2. The one class that can match a space is BOUNDED. This runs over patch
 *    text that came from GitHub — attacker-controlled — and an unbounded
 *    `[\w$,\s}]*` before a mandatory `=` backtracks cubically: a single 2 KB
 *    line of spaces blocked the event loop for 4.4s on Node 22, and Fastify is
 *    single-threaded, so that is the entire API, not one request.
 */
const PLUMBING_LINE =
  /^(?:import\b|export\s+(?:type\s+)?[{*]|export\s+default\s+[\w$]+\s*;?$|from\b|\}\s*from\b|const\s+\{?[\w$,\s}]{0,200}=\s*require\(|[{}()[\]]+[;,]?$|[\w$]+\s*,?$)/;

/**
 * A patch whose every added/removed line is module plumbing is wiring no matter
 * where it sits: a file that gained nothing but three imports and a re-export
 * did not change behaviour, and reading it closely is wasted attention. Requires
 * at least one real `import`/`export` so a diff of pure `}` lines (a brace-only
 * refactor inside real code) is NOT swept into wiring.
 */
export function isPlumbingOnlyPatch(patch: string | null): boolean {
  if (!patch) return false;
  let changed = 0;
  let sawModuleKeyword = false;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (!raw.startsWith('+') && !raw.startsWith('-')) continue;
    const line = raw.slice(1).trim();
    if (line === '') continue;
    // Defense in depth behind the bounded regex above: a line this long is not
    // an import statement, and refusing to match it fails toward `core`, which
    // is the safe direction.
    if (line.length > MAX_PLUMBING_LINE_CHARS) return false;
    changed += 1;
    if (!PLUMBING_LINE.test(line)) return false;
    if (/^(?:import|export)\b/.test(line)) sawModuleKeyword = true;
  }
  return changed > 0 && sawModuleKeyword;
}

/**
 * Most specific first: boilerplate wins over wiring, wiring over core. A
 * generated `index.ts` under `dist/` is boilerplate, not a barrel; core is the
 * default, so an unrecognised path is always reviewed rather than skimmed.
 */
export function roleFor(path: string, patch: string | null = null): SmartDiffRole {
  if (isBoilerplate(path)) return 'boilerplate';
  if (isWiringPath(path)) return 'wiring';
  if (isPlumbingOnlyPatch(patch)) return 'wiring';
  return 'core';
}

/** `src/api/public/webhooks.ts` → `src/api`; a root-level file → its own name. */
function splitBucketFor(path: string): string {
  const segs = path.split('/').filter(Boolean);
  if (segs.length <= 1) return segs[0] ?? path;
  return segs.slice(0, Math.min(SPLIT_DIR_DEPTH, segs.length - 1)).join('/');
}

/**
 * Within a group the reviewer should meet the riskiest file first: findings
 * outrank size, size outranks alphabet. Path breaks the tie so the order is
 * stable across calls (and across test runs).
 */
function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  if (a.finding_lines.length !== b.finding_lines.length) {
    return b.finding_lines.length - a.finding_lines.length;
  }
  const aSize = a.additions + a.deletions;
  const bSize = b.additions + b.deletions;
  if (aSize !== bSize) return bSize - aSize;
  return a.path.localeCompare(b.path);
}

function toSmartDiffFile(file: ChangedFile, findingLines: readonly number[]): SmartDiffFile {
  return {
    path: file.path,
    // Deliberately null: Smart Diff makes no LLM call, and a mechanical
    // "adds foo(), imports bar" line reads worse than no line at all. The
    // contract keeps the field so a later lesson can fill it in.
    pseudocode_summary: null,
    additions: file.additions,
    deletions: file.deletions,
    finding_lines: [...new Set(findingLines)].sort((a, b) => a - b),
  };
}

function buildSplitSuggestion(
  entries: { file: SmartDiffFile; role: SmartDiffRole }[],
): SmartDiff['split_suggestion'] {
  const totalLines = entries.reduce((sum, e) => sum + e.file.additions + e.file.deletions, 0);
  const tooBig = totalLines > SPLIT_LINE_THRESHOLD || entries.length > SPLIT_FILE_THRESHOLD;

  // Boilerplate is excluded: a lock file follows whichever split its manifest
  // lands in, so bucketing it would propose a "split" nobody can act on.
  const buckets = new Map<string, string[]>();
  for (const { file, role } of entries) {
    if (role === 'boilerplate') continue;
    const key = splitBucketFor(file.path);
    const list = buckets.get(key);
    if (list) list.push(file.path);
    else buckets.set(key, [file.path]);
  }

  const proposed =
    tooBig && buckets.size >= SPLIT_MIN_BUCKETS
      ? [...buckets.entries()]
          .map(([name, files]) => ({ name, files: [...files].sort() }))
          .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name))
      : [];

  return { too_big: tooBig, total_lines: totalLines, proposed_splits: proposed };
}

/**
 * Group the PR's files by role and describe how splittable it is.
 *
 * Empty groups are OMITTED rather than emitted with `files: []` — the UI renders
 * one section per group, and a section headed "Boilerplate · 0 files" is pure
 * chrome. Callers that need a fixed three-group shape can reindex by `role`.
 */
export function buildSmartDiff(
  files: readonly ChangedFile[],
  findingLinesByPath: FindingLinesByPath,
): SmartDiff {
  const entries = files.map((file) => ({
    role: roleFor(file.path, file.patch),
    file: toSmartDiffFile(file, findingLinesByPath.get(file.path) ?? []),
  }));

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const inRole = entries.filter((e) => e.role === role).map((e) => e.file);
    if (inRole.length === 0) continue;
    groups.push({ role, files: inRole.sort(compareFiles) });
  }

  return { groups, split_suggestion: buildSplitSuggestion(entries) };
}
