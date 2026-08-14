import type { HunkRange } from '../_shared/hunk-map.js';

/**
 * Module-local shapes for the PR Brief.
 *
 * Everything served on the wire lives in `contracts/pr-brief.ts`; what is here
 * is the vocabulary the pure files (`candidates.ts`, `ground.ts`, `history.ts`,
 * `prompt.ts`) speak among themselves.
 *
 * This file is one of the three `no-cross-module-imports` exempts, so keep it to
 * types — a value exported here becomes importable from any module.
 */

/**
 * Everything a path, a line, an endpoint or a job must be a member of to survive
 * grounding. Built from the PR's OWN facts, never from the model's answer.
 *
 * NOTE THE ABSENCE. There is no caller LINE anywhere in this shape, and
 * `buildCandidates` never receives one. `BlastCaller.line` is a location in the
 * repository's DEFAULT BRANCH at `last_indexed_sha`, not in this PR, so
 * presenting it as a place to read would be invented precision. Keeping it out
 * of the type is what makes that structural rather than a filter someone can
 * delete later (AC-16).
 */
export interface CandidateSets {
  /** Changed files ∪ blast caller files - the union a cited path must be in. */
  files: ReadonlySet<string>;
  /** Changed files alone. Only these can carry a line. */
  changedFiles: ReadonlySet<string>;
  endpoints: ReadonlySet<string>;
  crons: ReadonlySet<string>;
  /** Reconstructed `@@` ranges per changed file, from `buildHunkRanges`. */
  lineRanges: ReadonlyMap<string, readonly HunkRange[]>;
}

/** One prior PR of the same repository, as the deterministic ranking sees it. */
export interface PriorPullInput {
  number: number;
  title: string;
  author: string;
  /** Best available "when" — see `history.ts` on why this is not a merge time. */
  at: Date | null;
  paths: readonly string[];
}

/** One block of the assembled prompt, in the order it is rendered. */
export interface BriefPromptSection {
  section: string;
  source: string;
  text: string;
}

/** The assembled prompt plus what survived the budget ladder. */
export interface AssembledBriefPrompt {
  system: string;
  user: string;
  sections: BriefPromptSection[];
  /** Section names kept, in order — the trace asserts the ladder against this. */
  kept: string[];
  /** Section names the ladder dropped, in the order they were dropped. */
  dropped: string[];
  tokens: number;
}

/**
 * The persisted `pr_brief.trace`. DB-only, exactly as `pr_intent.trace` is: it
 * carries the full prompt, so it must never reach a log line.
 */
export interface BriefTrace {
  system: string;
  user: string;
  provider: string;
  model: string;
  /** Prompt block names kept / dropped by the budget ladder (AC-10). */
  blocks_kept: string[];
  blocks_dropped: string[];
  prompt_tokens_measured: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number | null;
  duration_ms: number;
  /** Present only when the brief is degraded; the model was not called. */
  degraded_reason?: string;
}
