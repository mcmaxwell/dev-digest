import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';
import { PROBE_MAX_PATTERN_LENGTH } from './constants.js';

/**
 * Structured-output schemas for the two-step conventions dialogue. The names
 * double as `schemaName` on the LLM call, which is what tests key their fixtures
 * off (`MockLLMProvider.structuredBySchema`).
 */

/**
 * Step 1 — the model picks which of the sampled files are actually worth reading
 * closely, per category. Keeps each extraction prompt small and on-topic instead
 * of re-sending every file to every pass.
 */
export const ConventionFileSelectionSchema = z.object({
  selections: z.array(
    z.object({
      category: ConventionCategory,
      /** Repo-relative paths, chosen from the inventory we supplied. */
      paths: z.array(z.string()).max(12),
      reason: z.string().optional(),
    }),
  ),
});
export type ConventionFileSelection = z.infer<typeof ConventionFileSelectionSchema>;
export const CONVENTION_FILE_SELECTION_SCHEMA_NAME = 'ConventionFileSelection';

/**
 * Step 2 — one call per category.
 *
 * `evidence` carries at least two sites in DIFFERENT files by contract, because
 * a convention that occurs once is a coincidence. `probe` is optional and turns
 * the rule into something we can measure: `positive` matches conforming code,
 * `negative` matches violations, and the ratio of the two replaces the model's
 * self-reported confidence with an observation about the repo.
 */
export const ConventionExtractionSchema = z.object({
  conventions: z.array(
    z.object({
      rule: z
        .string()
        .min(10)
        .describe('One directive sentence a reviewer can enforce. Name the specific thing.'),
      rationale: z.string().optional(),
      evidence: z
        .array(
          z.object({
            path: z.string(),
            line: z.number().int().positive(),
            snippet: z.string().describe('The line COPIED VERBATIM from the numbered sample.'),
          }),
        )
        .min(1),
      confidence: z.number().min(0).max(1),
      probe: z
        .object({
          positive: z.string().max(PROBE_MAX_PATTERN_LENGTH),
          negative: z.string().max(PROBE_MAX_PATTERN_LENGTH),
        })
        .optional()
        .describe('Regexes: code that FOLLOWS the rule vs code that VIOLATES it.'),
    }),
  ),
});
export type ConventionExtraction = z.infer<typeof ConventionExtractionSchema>;
export const CONVENTION_EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';
