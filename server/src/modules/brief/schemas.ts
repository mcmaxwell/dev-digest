import { z } from 'zod';
import { MAX_PROSE_CHARS, MAX_REVIEW_FOCUS, MAX_RISKS } from './constants.js';

/**
 * Structured-output schema for the brief's ONE model call.
 *
 * FLAT `z.object`, and it must stay that way. This object is handed to the model
 * as its response schema, and a `z.discriminatedUnion` (or a top-level
 * `.refine()`) emits a `oneOf`, which models handle markedly worse than a flat
 * object — the lesson `contracts/findings.ts` and `blast/schemas.ts` are both
 * built around.
 *
 * Every `.max()` here is ADVISORY. A schema violation costs a repair round-trip,
 * and we would rather ship a clamped sentence than spend an attempt on
 * formatting, so `ground.ts` caps the arrays and the service clamps the prose
 * again before persisting.
 *
 * This schema is NOT the shared contract, unlike `modules/intent`'s. What the
 * model returns and what is persisted are different shapes here: everything the
 * model says passes a rejection gate first, and the fields below that carry
 * endpoint and job names have no counterpart on the wire at all (see
 * `ground.ts`).
 */

const RiskDraft = z.object({
  kind: z
    .string()
    .describe('One or two words naming the KIND of risk, e.g. "auth surface", "data migration".'),
  title: z.string().describe('One short line a reviewer can scan. No trailing period.'),
  explanation: z
    .string()
    .describe('One or two sentences saying why this is a risk, in the reviewer’s terms.'),
  severity: z.enum(['high', 'medium', 'low']),
  file_refs: z
    .array(z.string())
    .describe(
      'One or more file paths from the CHANGED FILES or CALLER FILES lists you were given, ' +
        'copied exactly. A risk that cannot name such a path will be discarded.',
    ),
  endpoints: z
    .array(z.string())
    .describe(
      'HTTP endpoints from the endpoint list you were given that this risk reaches. ' +
        'Copy exactly, or leave empty. Never invent one.',
    ),
  crons: z
    .array(z.string())
    .describe(
      'Scheduled jobs from the job list you were given that this risk reaches. ' +
        'Copy exactly, or leave empty. Never invent one.',
    ),
});

const ReviewFocusDraft = z.object({
  file: z
    .string()
    .describe('A path copied exactly from the CHANGED FILES or CALLER FILES lists.'),
  line: z
    .number()
    .int()
    .nullable()
    .describe(
      'A line inside one of that file’s `@@` ranges, or null. Never a line from the caller ' +
        'lists — those are positions in the default branch, not in this pull request.',
    ),
  reason: z.string().describe('ONE sentence saying why this should be read first.'),
});

export const BriefDraftSchema = z.object({
  what: z
    .string()
    .min(1)
    .max(MAX_PROSE_CHARS)
    .describe(
      'At most three sentences stating what this change touches and what it can reach. ' +
        'You have seen no diff and no source code, so describe reach, never behaviour.',
    ),
  why: z
    .string()
    .min(1)
    .max(MAX_PROSE_CHARS)
    .describe(
      'At most three sentences stating what the change is FOR and what that means for the ' +
        'review. Only what the stated intent, title, body and linked issue support.',
    ),
  risk_level: z
    .enum(['high', 'medium', 'low'])
    .describe('Your overall reading. It is capped server-side by the risks that survive grounding.'),
  risks: z
    .array(RiskDraft)
    .max(MAX_RISKS)
    .describe('Risks worth a reviewer’s attention. Empty is a valid answer.'),
  review_focus: z
    .array(ReviewFocusDraft)
    .max(MAX_REVIEW_FOCUS)
    .describe('What to read first, most important first. Empty is a valid answer.'),
});
export type BriefDraft = z.infer<typeof BriefDraftSchema>;

/** Doubles as the LLM call's `schemaName`, so this call is identifiable in logs. */
export const BRIEF_SCHEMA_NAME = 'PrRiskBrief';
