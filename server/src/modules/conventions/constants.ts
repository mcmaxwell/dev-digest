import type { ConventionCategory } from '@devdigest/shared';

/**
 * Tuning constants for the conventions extractor (L02).
 *
 * Everything here is a PRECISION/RECALL dial. The defaults are chosen for a
 * cheap model over a mid-size repo: wide enough sampling that each category has
 * something to look at, strict enough thresholds that a one-off coincidence
 * never reaches the UI.
 */

/** Job kind for the background extraction run (mirrors repo-intel's RESYNC job). */
export const CONVENTIONS_EXTRACT_JOB_KIND = 'conventions.extract';

/**
 * One LLM call per category. A single "find the conventions" call reliably
 * returns 3-4 vague rules; the same samples read through eight explicit lenses
 * return specific ones, because each pass is forced to answer a narrow question.
 */
export const EXTRACTION_CATEGORIES: ConventionCategory[] = [
  'naming',
  'structure',
  'error-handling',
  'async',
  'imports',
  'types',
  'testing',
  'api-contract',
];

/** How many extraction calls may be in flight at once. */
export const EXTRACTION_CONCURRENCY = 4;

/** Per-call ceilings. A stuck provider must not hold the job open. */
export const LLM_TIMEOUT_MS = 90_000;
export const LLM_MAX_RETRIES = 1;

// --- Sampling strata --------------------------------------------------------

/** Source files, spread across top-level directories rather than by rank alone. */
export const SOURCE_SAMPLE_COUNT = 12;
export const SOURCE_PER_DIR_CAP = 3;
/** Test files — their own stratum, because rank-based sampling drops them all. */
export const TEST_SAMPLE_COUNT = 3;
/** Prose docs where house rules are often already written down. */
export const DOC_SAMPLE_COUNT = 3;
/** Config files (all that are found, capped). */
export const CONFIG_SAMPLE_CAP = 8;
/** Recent commit subjects — fuel for commit-message conventions. */
export const COMMIT_SAMPLE_COUNT = 40;

/** Per-file slice ceiling. Long files contribute their head, not their bulk. */
export const MAX_LINES_PER_FILE = 160;
export const MAX_CHARS_PER_FILE = 8_000;
/** Total sample budget handed to one extraction call. */
export const MAX_TOTAL_SAMPLE_CHARS = 60_000;
/** Repo-map slice added as structural context. */
export const MAX_REPO_MAP_CHARS = 6_000;

/**
 * Config files read verbatim. Two jobs: they feed `config-rules.ts` (which
 * derives candidates with NO model at all) and they give the extraction passes
 * the project's declared settings.
 */
export const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'prettier.config.cjs',
  '.editorconfig',
] as const;

/** Prose files scanned for already-written house rules. */
export const DOC_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'CONVENTIONS.md',
  'STYLEGUIDE.md',
  'README.md',
] as const;

// --- Quality thresholds -----------------------------------------------------

/**
 * A convention REPEATS by definition. One occurrence is a coincidence, so an
 * LLM-proposed candidate needs two verified evidence sites to survive.
 * Config-derived candidates are exempt — their single site is the config itself.
 */
export const MIN_EVIDENCE_LLM = 2;
export const MIN_EVIDENCE_CONFIG = 1;

/**
 * Measured conformance floor. Below this the "rule" is a preference some files
 * happen to share, not a house rule — and telling a reviewer to enforce it would
 * generate noise on every PR.
 */
export const MIN_ADHERENCE = 0.8;
/** Conforming matches a probe must find before its adherence number means anything. */
export const MIN_PROBE_SUPPORT = 2;
/** Confidence ceiling for a candidate that shipped no probe (unmeasured). */
export const UNPROBED_CONFIDENCE_CAP = 0.7;

// --- Probe guards (model-authored regexes are untrusted input) ---------------

export const PROBE_MAX_PATTERN_LENGTH = 200;
export const PROBE_TIMEOUT_MS = 5_000;
export const PROBE_MAX_MATCHES = 500;

/** Rules that are true of essentially every TypeScript repo — not HOUSE rules. */
export const GENERIC_RULE_PATTERNS = [
  'use typescript',
  'use types',
  'add types',
  'use const',
  'prefer const',
  'avoid any',
  'use meaningful names',
  'descriptive names',
  'write tests',
  'add tests',
  'keep functions small',
  'follow best practices',
  'use eslint',
  'format with prettier',
  'handle errors',
  'add comments',
  'document your code',
  'avoid magic numbers',
  'dry principle',
  'single responsibility',
] as const;

/** Token-overlap above which two rules are considered the same rule. */
export const DEDUPE_SIMILARITY = 0.85;

/** Default name of the skill assembled from accepted candidates. */
export const SKILL_NAME_SUFFIX = 'conventions';
