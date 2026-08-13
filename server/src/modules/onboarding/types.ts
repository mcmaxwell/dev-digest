import type { OnboardingDegradedReason, OnboardingGeneration } from '@devdigest/shared';

/**
 * L06 — module-local types. Everything here describes work IN PROGRESS: the
 * facts collected from a clone, the candidate sets a row may be drawn from, and
 * the verification context. The persisted and read shapes are the `Onboarding`
 * contracts in `vendor/shared`; nothing in this file is ever stored or returned
 * over HTTP.
 */

/** One file read from the clone. A blank `content` means the file is ABSENT. */
export interface FactFile {
  path: string;
  content: string;
}

/** One runnable command with the repo-relative file it was read from. */
export interface RunScript {
  name: string;
  command: string;
  /** The file the command was taken from — the reader's only check on it. */
  source: string;
}

/**
 * Everything the deterministic pass extracted from the fixed fact-file list.
 * Purely derived: `extractFacts` is a function of the files it is handed.
 */
export interface DeterministicFacts {
  /**
   * PATHS of the fact files that were present and non-blank, in `FACT_FILES`
   * order — deliberately not their content. `.env.example` is on that list, and
   * an example env file routinely holds a real key someone forgot to blank, so
   * this struct must not be a place one can survive: the only things extracted
   * from it are the derived fields below.
   */
  present: string[];
  /** Variable NAMES from `.env.example` / `.env.sample`. Never a value. */
  envKeys: string[];
  /** Runnable commands from manifests and task runners. */
  scripts: RunScript[];
  /** Compose service names. */
  services: string[];
  /** Declared stack, derived from which manifests exist and what they declare. */
  stack: string[];
  /** README slice, capped by line count. Null when there is no README. */
  readme: string | null;
  /** CONTRIBUTING slice, same treatment. */
  contributing: string | null;
}

/** One `TODO`/`FIXME` occurrence, already filtered to the candidate file set. */
export interface MarkerRow {
  path: string;
  line: number;
  text: string;
}

/** One open issue carrying the `good first issue` label. */
export interface IssueRow {
  number: number;
  title: string;
  body?: string | null;
}

/**
 * The sets a row may be drawn from. Membership here is what makes AC-8
 * ("order matches getTopFilesByRank") and AC-23 ("entries appear in
 * getCriticalPaths output") true BY CONSTRUCTION rather than by a post-hoc
 * check that could only ever catch existence, not ordering.
 */
export interface CandidateSets {
  /** Reading-path candidates, in `getTopFilesByRank` order, verbatim. */
  reading: string[];
  /** Critical-path candidates, flattened from the dependency chains. */
  critical: string[];
  markers: MarkerRow[];
  issues: IssueRow[];
  /**
   * False when the import graph was unavailable and both path sets came from
   * the directory-prominence heuristic — which is what the per-section
   * `no_graph` marker reports.
   */
  usedGraph: boolean;
}

/** One rank-selected file excerpt bound for the prompt. */
export interface Excerpt {
  path: string;
  content: string;
}

/**
 * A prompt slot, as `platform/prompt-log` wants it. Declared here rather than
 * imported so `prompt.ts` stays a pure function with no platform dependency;
 * the shape is structurally compatible with `PromptSectionInput`.
 */
export interface PromptSection {
  section: string;
  source: string;
  text: string;
}

export interface AssembledPrompt {
  /** The user message. The system prompt is rendered separately. */
  user: string;
  /** One entry per assembled block, for metadata-only logging. */
  sections: PromptSection[];
  excerptsUsed: number;
  tokens: number;
}

/** Everything `assemblePrompt` is a function of. It fetches nothing itself. */
export interface PromptInput {
  repoFullName: string;
  headSha: string;
  facts: DeterministicFacts;
  /** Already fetched at the current repo-map rung; '' means no map. */
  repoMap: string;
  excerpts: Excerpt[];
  candidates: CandidateSets;
  filesIndexed: number;
  filesSkipped: number;
}

/** What the deterministic pass produced, plus how degraded it turned out. */
export interface CollectedFacts {
  headSha: string;
  facts: DeterministicFacts;
  candidates: CandidateSets;
  excerpts: Excerpt[];
  /** Every path known to exist in the clone at `headSha`, for verification. */
  knownPaths: Set<string>;
  rankPercentile: Map<string, number>;
  filesIndexed: number;
  filesSkipped: number;
  indexSha: string | null;
  reasons: OnboardingDegradedReason[];
}

/** In-flight generation state, held in memory on the single service instance. */
export interface InFlight {
  promise: Promise<void>;
  phase: NonNullable<OnboardingGeneration['phase']>;
  startedAt: string;
}
