import { z } from 'zod';

/**
 * L03 — the Intent Layer.
 *
 * A cheap, separate LLM call reads only PR METADATA (title, body, linked issue,
 * referenced spec, the changed-file list with hunk headers — never diff bodies)
 * and returns what the PR is FOR. The result is persisted per PR, shown to the
 * user, and injected into the reviewer prompt.
 *
 * This is a NEW file rather than an edit to `brief.ts`: `brief.ts`'s `Intent`
 * and `PrBrief` belong to the future PR Brief lesson and stay untouched, per the
 * barrel rule in `index.ts` ("feature agents EXTEND with new files").
 * `modules/intent/helpers.ts`'s `toBriefIntent()` is the conversion point
 * between the two.
 */

/**
 * How much the classifier's statement can be relied on. Capped SERVER-SIDE
 * (`modules/intent/helpers.ts`), never taken from the model at face value:
 * verbalized LLM confidence is systematically overconfident.
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** Where one piece of the classifier's context came from. */
export const IntentSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'linked_issue',
  'github_url',
  'repo_file',
  'external_url',
  'file_map',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/**
 * `absent` = the source does not exist for this PR (no body, no linked issue).
 * `unreachable` = it exists but we could not read it (API error, wrong repo, or
 * — for `external_url` — a non-GitHub host we deliberately never dereference).
 * The distinction matters: `unreachable` caps confidence, `absent` may not.
 */
export const IntentSourceStatus = z.enum(['ok', 'absent', 'unreachable']);
export type IntentSourceStatus = z.infer<typeof IntentSourceStatus>;

/**
 * One resolved (or failed) context source. `ref` is an IDENTIFIER — an issue
 * number, a repo-relative path, a host — never a raw, possibly secret-bearing
 * URL, because this shape is logged.
 */
export const IntentSource = z.object({
  kind: IntentSourceKind,
  ref: z.string(),
  status: IntentSourceStatus,
  /** Characters of content this source contributed to the prompt (0 when not ok). */
  chars: z.number().int().min(0),
});
export type IntentSource = z.infer<typeof IntentSource>;

export const RiskAreaKind = z.enum(['security', 'dependency', 'performance', 'data', 'other']);
export type RiskAreaKind = z.infer<typeof RiskAreaKind>;

export const RiskArea = z.object({
  label: z.string(),
  kind: RiskAreaKind,
});
export type RiskArea = z.infer<typeof RiskArea>;

/** Exactly what the classifier returns — the LLM structured-output shape. */
export const IntentClassification = z.object({
  summary: z
    .string()
    .describe('One sentence, in the PR author’s own terms, stating what this PR is for.'),
  in_scope: z
    .array(z.string())
    .describe('Concrete things this PR sets out to change. Empty is valid.'),
  out_of_scope: z
    .array(z.string())
    .describe(
      'Concrete things this PR deliberately does NOT set out to change. Empty is valid — never guess.',
    ),
  risk_areas: z
    .array(RiskArea)
    .describe('Areas this change could plausibly put at risk. Empty is valid.'),
  confidence: IntentConfidence,
});
export type IntentClassification = z.infer<typeof IntentClassification>;

/**
 * The persisted, user-facing intent for one PR.
 *
 * `stale` is DERIVED on read by comparing `head_sha` against the PR's current
 * head — it is not a column, so it can never go out of date in the DB.
 */
export const PrIntent = IntentClassification.extend({
  pr_id: z.string(),
  sources: z.array(IntentSource),
  provider: z.string(),
  model: z.string(),
  head_sha: z.string(),
  generated_at: z.string(),
  stale: z.boolean(),
});
export type PrIntent = z.infer<typeof PrIntent>;

/**
 * `GET`/`POST /pulls/:id/intent`.
 *
 * Nullable rather than a 404: the client's fetch layer turns ANY non-2xx into a
 * thrown `ApiError`, which would leave the Intent card permanently in an error
 * state on a PR that simply has no intent yet.
 */
export const PrIntentResponse = z.object({
  intent: PrIntent.nullable(),
});
export type PrIntentResponse = z.infer<typeof PrIntentResponse>;
