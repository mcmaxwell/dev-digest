import type {
  ConventionCategory,
  ConventionEvidence,
  ConventionOrigin,
} from '@devdigest/shared';

/**
 * Internal shapes for the extraction pipeline. Everything the HTTP layer returns
 * is a `@devdigest/shared` contract; these types only travel between the
 * pipeline stages (sampling → extraction → verification → scoring → persist).
 */

/** Which stratum a sampled file came from — drives how it is presented to the model. */
export type SampleKind = 'source' | 'test' | 'config' | 'doc';

/**
 * One sampled file, already truncated and line-numbered.
 *
 * `numbered` is what reaches the prompt: `  42 | const x = 1`. Sending numbers
 * turns "cite a file:line" from a guess into a copy — which is why verification
 * almost always lands `exact` rather than `relocated`.
 */
export interface SampleFile {
  path: string;
  kind: SampleKind;
  /** Raw slice (no line numbers) — what verification searches. */
  content: string;
  numbered: string;
  /** Line count of the ORIGINAL file, so we can say what was cut. */
  totalLines: number;
  truncated: boolean;
}

/** Everything deterministic collected before any model call. */
export interface SampleSet {
  files: SampleFile[];
  /** Cached repo skeleton (structural context), possibly empty. */
  repoMap: string;
  /** Recent commit subjects — fuel for commit-message conventions. */
  commitSubjects: string[];
}

/**
 * A machine-checkable form of the rule. `positive` matches code that FOLLOWS the
 * convention, `negative` matches code that violates it. Running both over the
 * clone turns the model's self-reported confidence into a measured adherence
 * ratio. Patterns are model-authored, therefore untrusted — see `adherence.ts`.
 */
export interface ConventionProbe {
  positive: string;
  negative: string;
}

/** A candidate as it flows through the pipeline, before it becomes a DTO. */
export interface DraftCandidate {
  category: ConventionCategory;
  rule: string;
  rationale?: string;
  evidence: ConventionEvidence[];
  confidence: number;
  origin: ConventionOrigin;
  probe?: ConventionProbe;
  /** Normalized rule text; the dedupe key and the DB's per-repo unique key. */
  ruleKey: string;
  adherence?: number;
  support?: number;
  violations?: number;
}
