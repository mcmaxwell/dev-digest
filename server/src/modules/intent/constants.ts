/**
 * Tuning constants for the intent layer (L03).
 *
 * The classifier is a CHEAP, metadata-only call. Every cap here exists so the
 * prompt stays small and bounded whatever the PR looks like: a 400-file PR, a
 * 60 kB body, or a linked issue with a novel in it must all produce roughly the
 * same prompt size.
 */

/**
 * Per-call ceilings. The classifier runs INLINE on the review path (one flash
 * call has no 450s worst case, so it needs neither a JobRunner budget nor a boot
 * reaper), which makes a stuck provider the only real risk here.
 */
export const INTENT_LLM_TIMEOUT_MS = 45_000;
export const INTENT_LLM_MAX_RETRIES = 1;

// --- File map ---------------------------------------------------------------
//
// `buildFileMap` and its two caps (`MAX_FILE_MAP_FILES`, `MAX_HUNKS_PER_FILE`)
// moved to `modules/_shared/hunk-map.ts` when L05's brief needed the same map
// and the same `@@` ranges: `no-cross-module-imports` does not exempt a
// sibling's `hunk-map.ts`, and a second copy would let the rendered map and the
// grounding ranges drift.

// --- Source caps ------------------------------------------------------------

/** PR body slice. Author-controlled and the prime injection vector. */
export const MAX_PR_BODY_CHARS = 6_000;
/** Linked issue / referenced PR body slice. */
export const MAX_ISSUE_CHARS = 4_000;
/** Referenced spec or plan file slice. */
export const MAX_REPO_FILE_CHARS = 6_000;
/** Total across every resolved source; sources are added until this is hit. */
export const MAX_TOTAL_SOURCE_CHARS = 24_000;

/** How many `#N` / URL references in the body we are willing to dereference. */
export const MAX_REFERENCES = 3;
/** How many repo-relative paths named in the body we are willing to read. */
export const MAX_REPO_FILE_REFS = 2;

/**
 * Spec/plan files checked on every PR, regardless of what the body says. A repo
 * that keeps its plan of record in one of these gets intent grounded in the plan
 * even when the author wrote a one-line description.
 */
export const SPEC_FILE_CANDIDATES = [
  'SPEC.md',
  'PLAN.md',
  'docs/SPEC.md',
  'docs/PLAN.md',
  'docs/spec.md',
] as const;

/**
 * The linked-issue pattern, deliberately identical to the one
 * `adapters/github/octokit.ts` already uses so "linked issue" means the same
 * thing here as it does on the PR detail.
 */
export const LINKED_ISSUE_RE = /(?:closes|fixes|resolves)?\s*#(\d+)/i;

/** Any absolute http(s) URL in the body. Only github.com hosts are dereferenced. */
export const URL_RE = /https?:\/\/[^\s)\]<>"']+/gi;

/**
 * A repo-relative path named in the body — `docs/specs/L03-intent.md`,
 * `src/limiter.ts`. Deliberately narrow: at least one directory separator and a
 * known text extension, so prose like "3/4 done" is never read as a path.
 */
export const REPO_PATH_RE = /\b[\w.-]+(?:\/[\w.-]+)+\.(?:md|txt|ts|tsx|js|json|ya?ml)\b/g;
