/**
 * Every ceiling the PR Brief runs under, in one file.
 *
 * They live here rather than beside their call sites so the feature's whole
 * budget can be read without reading the algorithm — the same reason
 * `modules/smart-diff/constants.ts` exists. Each one is a number the spec's NFR
 * table names; changing one here changes it everywhere.
 */

// --- The one model call -----------------------------------------------------

/**
 * Assembly ceiling, measured with `container.tokenizer` over the text we build.
 *
 * It bounds the PROMPT, not the invoice. A measured-versus-billed ratio of 5x
 * was recorded on this codebase (server/INSIGHTS.md), so lowering this number
 * will not reliably lower a bill — read `res.tokensIn` / `res.costUsd` off the
 * provider result for anything that claims to be spend.
 */
export const PROMPT_TOKEN_CEILING = 20_000;

/** Matches the blast summary's ceiling; a stuck provider is the real risk here. */
export const MODEL_TIMEOUT_MS = 30_000;

/**
 * Schema repairs the PROVIDER is allowed, i.e. at most 3 attempts.
 * `StructuredRequest.maxRetries`, never `withRetry` — a retry wrapper around a
 * billable call re-issues the whole call.
 */
export const MAX_SCHEMA_REPAIRS = 2;

// --- What is persisted ------------------------------------------------------

/** Per prose field. The schema also asks for it; the service clamps regardless. */
export const MAX_PROSE_CHARS = 400;

/**
 * Sentences per prose field (AC-21). The prompt asks for it too, but a prompt is
 * a request: this is the number the stored brief is held to, and the service
 * truncates at the third sentence rather than rejecting an over-long field —
 * a degraded brief is the shipped behaviour, an error is not.
 */
export const MAX_PROSE_SENTENCES = 3;

/** Review-focus entries kept after grounding. Spec open question 5: revisit. */
export const MAX_REVIEW_FOCUS = 8;

/** Risks kept after grounding. */
export const MAX_RISKS = 10;

/** Prior overlapping PRs carried in the brief. */
export const MAX_PRIOR_PRS = 5;

/**
 * Prior PRs READ before ranking. The repository returns the most recent
 * overlapping PRs; `history.ts` then ranks that set by overlap size, so the read
 * has to be wider than the display cap or the highest-overlap PR could fall off
 * the end for being a few days older than five trivial ones.
 */
export const PRIOR_PR_CANDIDATES = 25;

/** Brief-history entries read back for the timeline, newest first. */
export const MAX_BRIEF_HISTORY = 20;

// --- Prompt digest caps -----------------------------------------------------
//
// Not NFR numbers: these keep one enormous PR from spending the whole token
// ceiling on a single block before the budget ladder ever runs.

/** Changed symbols listed in the blast digest. */
export const PROMPT_MAX_SYMBOLS = 20;
/** Caller files listed per symbol. */
export const PROMPT_MAX_CALLER_FILES = 5;
/** Endpoints listed in the digest. */
export const PROMPT_MAX_ENDPOINTS = 25;
/** Scheduled jobs listed in the digest. */
export const PROMPT_MAX_CRONS = 25;
/** Prior-PR titles listed in the history block. */
export const PROMPT_MAX_PRIOR_PRS = 5;
/** Characters of PR body given to the model. Author-controlled, so it is capped. */
export const PROMPT_MAX_BODY_CHARS = 6_000;
/** Characters of linked-issue text. Third-party, so it is capped harder. */
export const PROMPT_MAX_ISSUE_CHARS = 4_000;
/** Characters per spec excerpt. */
export const PROMPT_MAX_SPEC_CHARS = 6_000;
