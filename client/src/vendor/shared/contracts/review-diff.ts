import { z } from 'zod';
import { Finding, Severity, Verdict } from './findings.js';

/**
 * L04 - `POST /reviews/diff`: review a raw unified diff that belongs to no PR.
 *
 * This is what the pre-push CLI (`devdigest review --mode working`) calls. The
 * diff comes from the developer's WORKING TREE, so there is no `pull_requests`
 * row to hang it on, and deliberately nothing is persisted: `reviews.pr_id` is
 * `notNull`, and an `agent_runs` row with a null `pr_id` would be invisible in
 * every UI while still inflating cost rollups.
 *
 * A NEW file, not an edit to `review-api.ts`, for the barrel rule in
 * `index.ts`. Nothing imported here is re-exported - the barrel `export *`s
 * both files.
 *
 * WHAT THIS REVIEW DOES NOT GET, and the CLI's `--help` says so: there is no
 * `repos` row, therefore no repo map, no callers digest, no rank note, no
 * intent, and no PR description. What survives is what makes a finding
 * trustworthy - the agent's system prompt and skills, the injection guard, the
 * scope filter, and the citation-grounding gate.
 */

/** Who sent the diff. Bounded because it is logged, and only ever a label. */
export const ReviewDiffSource = z.enum(['cli', 'editor', 'other']);
export type ReviewDiffSource = z.infer<typeof ReviewDiffSource>;

/**
 * Upper bound on the diff, in characters.
 *
 * One of FOUR independent limits, and they only work together: the route's
 * `bodyLimit` (2 MB) stops the socket, this bound stops a body that fits but
 * would cost a fortune, `MAX_DIFF_FILES` stops a wide change, and the route's
 * rate limit stops repetition. Exported so the CLI can refuse locally, with a
 * useful message, instead of round-tripping into a 422.
 */
export const MAX_REVIEW_DIFF_CHARS = 400_000;

export const ReviewDiffRequest = z.object({
  /** A unified diff (`git diff` output). Not wrapped, not pre-parsed. */
  diff: z.string().min(1).max(MAX_REVIEW_DIFF_CHARS),
  /** Agent slug or id. Omitted → the workspace's default enabled agent. */
  agent: z.string().min(1).optional(),
  /** Drop findings below this severity before returning. */
  severity_min: Severity.optional(),
  /** Severity at or above which a finding counts as a blocker (exit code 1). */
  fail_on: Severity.optional(),
  source: ReviewDiffSource.default('other'),
});
export type ReviewDiffRequest = z.infer<typeof ReviewDiffRequest>;

/** One finding the citation gate refused, with the reason it was refused. */
export const DroppedFinding = z.object({
  title: z.string(),
  reason: z.string(),
});
export type DroppedFinding = z.infer<typeof DroppedFinding>;

/** Which agent actually ran - echoed back because the request may omit it. */
export const ReviewDiffAgent = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  provider: z.string(),
  model: z.string(),
});
export type ReviewDiffAgent = z.infer<typeof ReviewDiffAgent>;

/**
 * Cost and time of the call. This endpoint writes no `agent_runs` row, so this
 * object plus one structured log line IS the observability story.
 */
export const ReviewDiffUsage = z.object({
  tokens_in: z.number().int().min(0),
  tokens_out: z.number().int().min(0),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().min(0),
});
export type ReviewDiffUsage = z.infer<typeof ReviewDiffUsage>;

export const ReviewDiffResponse = z.object({
  verdict: Verdict,
  summary: z.string(),
  score: z.number().int(),
  findings: z.array(Finding),
  /** Findings at or above `fail_on`. The CLI's exit code 1 is exactly this > 0. */
  blockers: z.number().int().min(0),
  /** Human-readable grounding result, e.g. "3/4 passed". */
  grounding: z.string(),
  dropped: z.array(DroppedFinding),
  agent: ReviewDiffAgent,
  usage: ReviewDiffUsage,
  files_reviewed: z.number().int().min(0),
});
export type ReviewDiffResponse = z.infer<typeof ReviewDiffResponse>;
