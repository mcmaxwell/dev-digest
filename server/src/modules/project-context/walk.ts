/**
 * project-context pipeline — discovery walk.
 *
 * Descends ONLY the four `DOC_ROOTS` beneath the clone root, never the whole
 * clone: a repository's `node_modules` dwarfs its `docs/`, and the 5 s scan
 * budget is met by not looking at it in the first place. Applies:
 *   - EXCLUDED_DIRS   (borrowed from repo-intel — one list of "never walk here")
 *   - `.md` only
 *   - MAX_DOC_BYTES   (256 KB) — larger files counted in `skippedTooLarge`
 *   - MAX_DOCS        (500) — first N in PATH order, remainder in `bounded`
 *
 * Direct `node:fs` here is deliberate and precedented
 * (`repo-intel/pipeline/walk.ts`): a pipeline file may touch the filesystem,
 * `service.ts` may not. Tokens are `approxTokens`, not the tiktoken encoder —
 * running a synchronous BPE encode over 500 documents inside a request would
 * block the event loop that also serves the SSE run stream.
 */
import { readdir, readFile, stat, lstat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';
import { DOC_EXT, DOC_ROOTS, MAX_DOC_BYTES, MAX_DOCS } from './constants.js';
import type { DiscoveredDoc, WalkDocsResult } from './types.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

interface Candidate {
  path: string;
  sizeBytes: number;
}

/**
 * Does the clone root exist on disk?
 *
 * Lives here, not in `service.ts`: the service may not touch `node:fs`, and
 * "the clone is not there" is the fact that separates a scan status of
 * `not_cloned` from an `ok` scan that simply found nothing.
 */
export async function cloneRootExists(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk the discovery roots under `root` and return the repository's document
 * set with the two counters the tree footer reports.
 */
export async function walkDocs(root: string): Promise<WalkDocsResult> {
  const candidates: Candidate[] = [];
  let skippedTooLarge = 0;

  for (const docRoot of DOC_ROOTS) {
    const dir = join(root, docRoot);
    // A discovery root that is itself a symlink is not descended — the same
    // rule the walk applies to every entry inside it.
    let isDir = false;
    try {
      const st = await lstat(dir);
      isDir = st.isDirectory();
    } catch {
      continue; // root absent — a repository need not carry all four
    }
    if (!isDir) continue;
    skippedTooLarge += await walkDir(root, dir, candidates);
  }

  // Stable order: alphabetical repo-relative path. Keeps "the first 500" the
  // same set on every scan of an unchanged clone.
  candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const bounded = candidates.length > MAX_DOCS ? candidates.length - MAX_DOCS : 0;
  const kept = bounded > 0 ? candidates.slice(0, MAX_DOCS) : candidates;

  const docs: DiscoveredDoc[] = [];
  for (const candidate of kept) {
    let content: string;
    try {
      content = await readFile(join(root, candidate.path), 'utf8');
    } catch {
      // Unreadable between stat and read (permissions, a concurrent resync) —
      // leave it out rather than failing the whole scan.
      continue;
    }
    docs.push({
      path: candidate.path,
      category: categoryOf(candidate.path),
      sizeBytes: candidate.sizeBytes,
      tokens: approxTokens(content),
    });
  }

  return { docs, skippedTooLarge, bounded };
}

/** First segment of a repo-relative path; always one of `DOC_ROOTS` here. */
function categoryOf(rel: string): DiscoveredDoc['category'] {
  return rel.split('/')[0] as DiscoveredDoc['category'];
}

/** Returns how many files this subtree skipped for being too large. */
async function walkDir(root: string, dir: string, out: Candidate[]): Promise<number> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory — skip cleanly so the scan keeps making progress.
    return 0;
  }

  let skipped = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, escapes)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      skipped += await walkDir(root, join(dir, name), out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (extname(name).toLowerCase() !== DOC_EXT) continue;

    const full = join(dir, name);
    let sizeBytes: number;
    try {
      sizeBytes = (await stat(full)).size;
    } catch {
      continue;
    }
    if (sizeBytes > MAX_DOC_BYTES) {
      skipped += 1;
      continue;
    }

    // Posix-style so stored paths are platform-agnostic, matching `pr_files.path`.
    out.push({ path: relative(root, full).split(sep).join('/'), sizeBytes });
  }
  return skipped;
}
