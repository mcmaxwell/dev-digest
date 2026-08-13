import { z } from 'zod';
import {
  MAX_CRITICAL_PATHS,
  MAX_FIRST_TASKS,
  MAX_READING_ENTRIES,
  MAX_RUN_STEPS,
} from './constants.js';

/**
 * L06 — the schema the MODEL sees. Deliberately not the shared `Onboarding`
 * contract, and deliberately not a discriminated union.
 *
 * WHY IT IS MODULE-LOCAL. The usual rule is to make the LLM schema the shared
 * contract itself, so a second definition cannot drift (see `intent/schemas.ts`).
 * That rule has a stated carve-out: it holds only when what the model returns is
 * what gets persisted. Here it is not. Every row is verified against the clone
 * and dropped when it names a path that does not exist; `step` ordinals and
 * `rank_percentile` are ours, not the model's; and provenance, degraded reasons
 * and the usage record never enter the model's world at all. Merging the two
 * would mean asking the model for fields it must not author.
 *
 * WHY IT IS FLAT. Five FIXED KEYS, one per section, with no union anywhere. A
 * `z.discriminatedUnion` compiles to a `oneOf` JSON Schema, which models handle
 * far worse than a fixed-key object. The shape also disposes of the "model
 * returned four sections, or six" edge case for free: there is nothing to
 * count, only known keys to repair against.
 *
 * `diagram` exists on `architecture` AND NOWHERE ELSE, which is how AC-20 ("at
 * most one diagram, on the architecture section") holds by construction rather
 * than by a check someone could forget to run.
 */

const DraftLink = z.object({
  label: z.string(),
  path: z.string().describe('A repo-relative path from the supplied facts. Never invented.'),
});

/** Every section carries prose, a title, and up to four supporting file links. */
const draftBase = {
  title: z.string(),
  body: z.string().describe('Markdown prose. Never HTML, never a <script> tag.'),
  links: z.array(DraftLink).max(4),
};

export const OnboardingDraft = z.object({
  architecture: z.object({
    ...draftBase,
    diagram: z
      .string()
      .nullable()
      .describe('One simple mermaid flowchart, or null. No ``` fences.'),
  }),
  critical_paths: z.object({
    ...draftBase,
    items: z
      .array(
        z.object({
          path: z.string().describe('Chosen from the CRITICAL PATH CANDIDATES list.'),
          reason: z.string().describe('One line: why this file carries the weight.'),
        }),
      )
      .max(MAX_CRITICAL_PATHS),
  }),
  run_locally: z.object({
    ...draftBase,
    items: z
      .array(
        z.object({
          command: z.string().describe('The exact command, copyable verbatim.'),
          source: z
            .string()
            .describe('The repo-relative file this command was read from. Must exist.'),
        }),
      )
      .max(MAX_RUN_STEPS),
  }),
  reading_path: z.object({
    ...draftBase,
    items: z
      .array(
        z.object({
          path: z.string().describe('Chosen from the READING PATH CANDIDATES list.'),
          reason: z.string().describe('One line: why to read it at this point.'),
        }),
      )
      .max(MAX_READING_ENTRIES),
  }),
  first_tasks: z.object({
    ...draftBase,
    items: z
      .array(
        z.object({
          title: z.string(),
          origin: z.enum(['todo', 'issue']),
          path: z.string().nullable().describe('Set for a `todo`, with its line. Else null.'),
          line: z.number().int().nullable(),
          issue_number: z.number().int().nullable().describe('Set for an `issue`. Else null.'),
        }),
      )
      .max(MAX_FIRST_TASKS),
  }),
});
export type OnboardingDraft = z.infer<typeof OnboardingDraft>;

/** Doubles as the `schemaName` on the LLM call, so the generation is greppable. */
export const ONBOARDING_SCHEMA_NAME = 'OnboardingTour';
