import type { UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Shared by every module that needs a PR's diff: the review path assembles the
 * prompt from it, the intent classifier derives its file map from it.
 *
 * It lives in `_shared/` rather than in `modules/reviews/` because
 * `no-cross-module-imports` only exempts another module's `service.ts` /
 * `types.ts` / `constants.ts`. Duplicating it per module would let the two
 * copies drift, and the failure would be silent: the classifier would read a
 * differently reconstructed diff than the reviewer does, and the file map would
 * stop describing the change under review.
 *
 * It depends on a structural `PrFileSource` rather than on `ReviewRepository`,
 * so `_shared` never imports from a module.
 */
export interface PrFileSource {
  getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]>;
}

/**
 * Prefers a real `git diff base...head`; falls back to assembling a synthetic
 * unified diff from the persisted `pr_files` patches, so both callers work
 * before a clone completes and in tests.
 */
export async function loadDiff(
  container: Container,
  files: PrFileSource,
  ref: { owner: string; name: string },
  base: string,
  head: string,
  prId: string,
): Promise<UnifiedDiff> {
  try {
    const diff = await container.git.diff(ref, base, head);
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to pr_files reconstruction */
  }
  return diffFromPrFiles(files, prId);
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(
  files: PrFileSource,
  prId: string,
): Promise<UnifiedDiff> {
  const rows = await files.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of rows) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
