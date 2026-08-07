import { z } from 'zod';

/**
 * Review / Findings contracts.
 * These Zod schemas are the single source of truth for:
 *  - API request/response validation,
 *  - LLM structured output (`response_format` / forced tool-use),
 *  - shared web↔api types.
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

/** Per-severity tally of one review's findings (PR-list / timeline rollups). */
export const SeverityCounts = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingKind = z.enum([
  'finding',
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

export const TrifectaComponent = z.enum([
  'private_data_access',
  'untrusted_input',
  'exfil_path',
]);
export type TrifectaComponent = z.infer<typeof TrifectaComponent>;

export const TrifectaEvidence = z.object({
  component: TrifectaComponent,
  file: z.string(),
  line: z.number().int(),
});
export type TrifectaEvidence = z.infer<typeof TrifectaEvidence>;

/** The raw field shape of a Finding, before the trifecta refinement. */
export const FindingShape = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown
  confidence: z.number().min(0).max(1),
  kind: FindingKind.nullish(),
  /**
   * L03 — whether this finding is about something the PR set out to change.
   *
   * An LLM-only field with no column in `findings` (the precedent `evidence`
   * sets below), read by the DETERMINISTIC scope filter in reviewer-core. It can
   * only ever cause a finding BELOW the severity threshold to be suppressed:
   * a CRITICAL is never dropped for being out of scope, and a null scope is
   * never dropped at all.
   */
  scope: z.enum(['in_scope', 'out_of_scope']).nullish(),
  // Lethal-trifecta variant fields (present only when kind === 'lethal_trifecta')
  trifecta_components: z.array(TrifectaComponent).nullish(),
  evidence: z.array(TrifectaEvidence).nullish(),
});

/**
 * Ties the lethal-trifecta variant fields to `kind`. Exported separately so
 * schemas that need to `.extend()` the shape (e.g. `FindingRecord`) can build on
 * `FindingShape` and re-apply this.
 *
 * A refinement rather than a discriminated union on purpose: this same schema is
 * handed to the LLM as structured output, and a flat object yields a far more
 * reliable JSON Schema than a oneOf. A violation costs one reprompt (see
 * `completeStructured`), not a failed run.
 *
 * `evidence` is deliberately NOT required: it is an LLM-only field with no
 * column in `findings`, so a finding re-read from the DB never carries it.
 */
export const refineTrifecta = (
  f: { kind?: FindingKind | null; trifecta_components?: TrifectaComponent[] | null },
  ctx: z.RefinementCtx,
): void => {
  const components = f.trifecta_components ?? [];
  if (f.kind === 'lethal_trifecta') {
    if (components.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trifecta_components'],
        message: "kind 'lethal_trifecta' requires at least one trifecta component",
      });
    }
  } else if (components.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trifecta_components'],
      message: "trifecta_components is only valid when kind is 'lethal_trifecta'",
    });
  }
};

/**
 * Finding — the atomic review unit. `start_line`/`end_line` are used by the
 * citation-grounding gate (must intersect a real diff hunk for diff-findings).
 */
export const Finding = FindingShape.superRefine(refineTrifecta);
export type Finding = z.infer<typeof Finding>;

/** Review — the consolidated structured output of a single agent run. */
export const Review = z.object({
  verdict: Verdict,
  summary: z.string(),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Overall PR quality from 0 to 100, where HIGHER is better. 90–100 = no or only trivial issues (approve); 60–89 = minor suggestions; 30–59 = warnings worth addressing; 0–29 = critical problems. Must be consistent with `findings`: if there are no findings, the score is 90 or above.',
    ),
  findings: z.array(Finding),
});
export type Review = z.infer<typeof Review>;

/** Action taken on a finding (accept/dismiss/learn/reply). */
export const FindingActionKind = z.enum(['accept', 'dismiss', 'learn', 'reply']);
export type FindingActionKind = z.infer<typeof FindingActionKind>;

export const FindingAction = z.object({
  action: FindingActionKind,
  reply: z.string().optional(),
});
export type FindingAction = z.infer<typeof FindingAction>;
