import { z } from 'zod';
import { MAX_SUMMARY_CHARS } from './constants.js';

/**
 * Structured-output schema for the impact summary.
 *
 * FLAT `z.object`, and it must stay that way. This object is handed to the model
 * as its response schema, and a `z.discriminatedUnion` (or any `.refine()` at
 * the top level) emits a `oneOf`, which models handle markedly worse than a flat
 * object - see the root INSIGHTS.md entry that `contracts/findings.ts` is built
 * around. Cross-field rules belong in `superRefine`, which costs at most one
 * reprompt because `completeStructured` feeds the issues back to the model.
 *
 * `.max()` is advisory, not a guarantee: the server clamps the text again before
 * persisting it, because a schema violation is a reprompt and we would rather
 * ship a trimmed sentence than spend a second call on formatting.
 */
export const BlastSummarySchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(MAX_SUMMARY_CHARS)
    .describe(
      'One short paragraph, at most three sentences, stating what this change can reach and ' +
        'what a reviewer should check because of it. Plain prose, no lists, no headings.',
    ),
});
export type BlastSummary = z.infer<typeof BlastSummarySchema>;

/** Doubles as the LLM call's `schemaName`, so this call is identifiable in logs. */
export const BLAST_SUMMARY_SCHEMA_NAME = 'BlastImpactSummary';
