import type { UnifiedDiff } from '@devdigest/shared';
import { MAX_FILE_MAP_FILES, MAX_HUNKS_PER_FILE } from './constants.js';

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

/**
 * A path is the one part of this output that comes from outside. A file literally
 * named `-rf` (or `+x`) would put a `+`/`-` at column 0 and make the block LOOK
 * like a diff body to a reader — and to the mechanical check that asserts it
 * isn't one. Prefixing with `./` keeps the invariant total for free.
 */
function safePath(path: string): string {
  return path.startsWith('+') || path.startsWith('-') ? `./${path}` : path;
}
