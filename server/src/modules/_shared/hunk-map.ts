import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Shared by every module that must tell a model WHERE a PR changed without
 * telling it HOW: the intent classifier renders the file map into its prompt,
 * the PR brief renders the same map AND grounds every line the model returns
 * against the ranges it was built from.
 *
 * It lives in `_shared/` rather than in `modules/intent/` because
 * `no-cross-module-imports` only exempts another module's `service.ts` /
 * `types.ts` / `constants.ts` - the same reason `diff-loader.ts` sits here.
 * Duplicating it per module would let the rendered map and the grounding ranges
 * drift, and that failure is silent: the brief would ground lines against ranges
 * the prompt never showed.
 *
 * `MAX_FILE_MAP_FILES` / `MAX_HUNKS_PER_FILE` moved here with the function.
 * They have exactly one consumer, and keeping them in a feature module's
 * `constants.ts` would make `_shared` import from a module.
 */

/** Files listed by name in the file map before it collapses to "... and N more". */
export const MAX_FILE_MAP_FILES = 40;
/** Hunk headers shown per file. Enough to see WHERE a file changed, not what. */
export const MAX_HUNKS_PER_FILE = 6;

/**
 * The "no diff bodies" chokepoint.
 *
 * The classifier is told WHAT changed and WHERE, never HOW. That is the whole
 * reason it can be a cheap call on untrusted text: it reads a shape, not code.
 * Requirement "no diff content in the intent prompt" is met by CONSTRUCTION
 * here — every string this function emits is derived from a path, two integers
 * per file, and four integers per hunk. There is no code path through which a
 * `+`/`-` line can reach the output, so there is nothing downstream to filter.
 *
 * ```
 * src/config.ts (+4 -0)
 *   @@ -10,3 +10,4 @@
 * src/limiter.ts (+120 -0)
 *   @@ -1,0 +1,120 @@
 * ... and 6 more files
 * ```
 *
 * The `@@` headers are RECONSTRUCTED from `DiffHunk.{oldStart,oldLines,newStart,
 * newLines}`, which the parser already retains — `adapters/git/diff-parser.ts`
 * is not touched.
 */
export function buildFileMap(diff: UnifiedDiff): string {
  const lines: string[] = [];

  for (const file of diff.files.slice(0, MAX_FILE_MAP_FILES)) {
    lines.push(`${safePath(file.path)} (+${file.additions} -${file.deletions})`);
    for (const hunk of file.hunks.slice(0, MAX_HUNKS_PER_FILE)) {
      // Indented, so the only column-0 lines in the whole block are file names.
      lines.push(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    }
    const hidden = file.hunks.length - MAX_HUNKS_PER_FILE;
    if (hidden > 0) lines.push(`  ... and ${hidden} more hunk(s)`);
  }

  const hiddenFiles = diff.files.length - MAX_FILE_MAP_FILES;
  if (hiddenFiles > 0) lines.push(`... and ${hiddenFiles} more files`);

  return lines.join('\n');
}

/** One contiguous run of NEW-side line numbers, inclusive at both ends. */
export interface HunkRange {
  start: number;
  end: number;
}

/**
 * The machine-readable half of `buildFileMap`, for grounding a line the model
 * returned back against the change it was shown.
 *
 * Derived from the SAME `hunk.newStart` / `hunk.newLines` fields the `@@`
 * headers above are reconstructed from, so the rendered map and the grounding
 * ranges cannot disagree. That is why it lives in this file and not beside its
 * consumer: two derivations of "where did this file change" would eventually
 * differ, and the symptom would be a line silently dropped (or silently kept)
 * for a range the prompt never mentioned.
 *
 * Keyed by the RAW path, not `safePath`'s rendering — a caller grounds against
 * the paths the PR actually carries. A hunk that only deletes lines
 * (`newLines === 0`) contributes no range: there is no new-side line to cite.
 *
 * The per-file cap mirrors `buildFileMap`'s, so a line inside a hunk the prompt
 * collapsed into "... and N more hunk(s)" is not treated as visible.
 */
export function buildHunkRanges(diff: UnifiedDiff): Map<string, HunkRange[]> {
  const ranges = new Map<string, HunkRange[]>();

  for (const file of diff.files.slice(0, MAX_FILE_MAP_FILES)) {
    const perFile: HunkRange[] = [];
    for (const hunk of file.hunks.slice(0, MAX_HUNKS_PER_FILE)) {
      if (hunk.newLines <= 0) continue;
      perFile.push({ start: hunk.newStart, end: hunk.newStart + hunk.newLines - 1 });
    }
    ranges.set(file.path, perFile);
  }

  return ranges;
}

/**
 * A path is the one part of this output that comes from outside. A file literally
 * named `-rf` (or `+x`) would put a `+`/`-` at column 0 and make the block LOOK
 * like a diff body to a reader — and to the mechanical check that asserts it
 * isn't one. Prefixing with `./` keeps the invariant total for free.
 */
function safePath(path: string): string {
  return path.startsWith('+') || path.startsWith('-') ? `./${path}` : path;
}
