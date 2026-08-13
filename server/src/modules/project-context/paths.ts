/**
 * project-context — path validation. Pure, no I/O.
 *
 * Every document path in this feature arrives from a client: on a read, and on
 * an attachment write that the run executor will trust months later. Both go
 * through `normalizeDocPath` BEFORE anything touches the filesystem, so a
 * stored path can never be a traversal.
 *
 * `isInsideRoot` is the second belt: `SimpleGitClient.readFile` does a bare
 * `join(clonePath, path)` with no guard of its own.
 */
import { resolve, sep } from 'node:path';
import { DOC_EXT, DOC_ROOTS } from './constants.js';

const ROOT_SET: ReadonlySet<string> = new Set(DOC_ROOTS);

/**
 * Return the canonical repo-relative form of `raw`, or `null` when it is not a
 * legal project-document path.
 *
 * Rejects: absolute paths, backslashes, NUL bytes, any `.` or `..` segment, an
 * empty segment, a first segment outside `DOC_ROOTS`, a single-segment path,
 * and any name not ending in `.md`.
 */
export function normalizeDocPath(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.includes('\0')) return null;
  if (raw.includes('\\')) return null;
  if (raw.startsWith('/')) return null;
  // A Windows-style drive or UNC prefix is absolute too, and `startsWith('/')`
  // does not see it.
  if (/^[A-Za-z]:/.test(raw)) return null;

  const segments = raw.split('/');
  if (segments.length < 2) return null;
  for (const segment of segments) {
    if (segment.length === 0) return null;
    if (segment === '.' || segment === '..') return null;
  }

  const [first] = segments;
  if (!first || !ROOT_SET.has(first)) return null;

  const last = segments[segments.length - 1]!;
  if (!last.toLowerCase().endsWith(DOC_EXT)) return null;
  if (last === DOC_EXT) return null; // a bare ".md" is a name, not a document

  return segments.join('/');
}

/**
 * True when `rel` resolves strictly inside `root`. Both are resolved first, so
 * a symlink-free escape (`..`, an absolute path) can never pass.
 */
export function isInsideRoot(root: string, rel: string): boolean {
  const base = resolve(root);
  const target = resolve(base, rel);
  return target.startsWith(base + sep);
}
