import type { UnifiedDiff } from '@devdigest/shared';
import { buildHunkRanges } from '../_shared/hunk-map.js';
import type { CandidateSets } from './types.js';

/**
 * L07 — the candidate set every model claim is grounded against. PURE: no I/O,
 * no Container, no drizzle.
 *
 * It exists because "no invented path, endpoint, job or line ever renders" is a
 * MEMBERSHIP property, and a post-hoc check can only ever test existence
 * (`modules/onboarding/candidates.ts` is the same lesson one lesson earlier).
 * The model is shown these sets and everything it returns is intersected back
 * with them, so an invention has nowhere to land.
 *
 * READ THE SIGNATURE, NOT JUST THE BODY. This function takes caller FILE PATHS,
 * endpoint STRINGS and job STRINGS — never a `BlastCaller`, and therefore never
 * a `BlastCaller.line`. A caller's line number is a position in the repository's
 * DEFAULT BRANCH at `last_indexed_sha`; presenting it as a place to read in this
 * PR would be invented precision, and AC-16 forbids it. Passing only the
 * projections is what makes that impossible rather than merely filtered — a
 * filter is one refactor away from being deleted, an absent parameter is not.
 *
 * The per-file line ranges come from `buildHunkRanges` and from nothing else,
 * which is the same derivation `buildFileMap` renders into the prompt. One
 * source, so the ranges the model was shown and the ranges it is judged against
 * cannot disagree.
 */

export interface CandidateInput {
  /** Paths of the PR's changed files. */
  changedFiles: readonly string[];
  /** Paths of files the blast result says call into the change. PATHS ONLY. */
  callerFiles: readonly string[];
  /** Endpoint strings from `endpoints_affected`, unioned across symbols. */
  endpoints: readonly string[];
  /** Scheduled-job strings from `crons_affected`, unioned across symbols. */
  crons: readonly string[];
  /** The parsed diff, the only source of `@@` ranges. */
  diff: UnifiedDiff;
}

export function buildCandidates(input: CandidateInput): CandidateSets {
  const changedFiles = new Set(input.changedFiles.filter(nonEmpty));
  const files = new Set(changedFiles);
  for (const path of input.callerFiles) {
    if (nonEmpty(path)) files.add(path);
  }

  // Ranges are keyed by the diff's own paths. A file the diff does not carry
  // (every caller file, and any changed file the diff loader could not
  // reconstruct) simply has no ranges, so no line can ever survive for it —
  // which is exactly the answer for a caller file, whose `@@` ranges do not
  // exist.
  const lineRanges = buildHunkRanges(input.diff);

  return {
    files,
    changedFiles,
    endpoints: new Set(input.endpoints.filter(nonEmpty)),
    crons: new Set(input.crons.filter(nonEmpty)),
    lineRanges,
  };
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
