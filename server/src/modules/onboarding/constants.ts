import type { OnboardingSectionKind } from '@devdigest/shared';
// Cross-module constant import, which `no-cross-module-imports` permits: the
// junk-path knowledge has ONE owner (repo-intel) and two consumers.
import { JUNK_PATH_PATTERNS } from '../repo-intel/constants.js';

/**
 * L06 — every budget, cap and fixed list the onboarding tour depends on, in one
 * file, so a measurement can move a number without anyone reading the algorithm
 * that consumes it. None of these was measured: they were chosen (see the
 * spec's open question 2).
 */

/** The five sections, in the order the tour is generated and rendered. */
export const SECTION_KINDS: readonly OnboardingSectionKind[] = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
] as const;

/**
 * Fallback titles. The model writes its own `title` per section; these are what
 * the deterministic skeleton uses and what a blank model title falls back to,
 * so a card is never headed by an empty string.
 */
export const DEFAULT_SECTION_TITLES: Record<OnboardingSectionKind, string> = {
  architecture: 'Architecture overview',
  critical_paths: 'Critical paths',
  run_locally: 'How to run locally',
  reading_path: 'Guided reading path',
  first_tasks: 'First tasks',
};

export const GENERATE_JOB_KIND = 'onboarding-generate';

/**
 * Per-kind job budget, deliberately ABOVE the honest worst case (90 s model +
 * fact collection + verification): `withTimeout` only rejects the awaited
 * promise, it cannot cancel the work, so an under-budgeted job is marked failed
 * while its pipeline keeps running.
 */
export const JOB_TIMEOUT_MS = 150_000;

/** The generation wall clock the spec fixes. Exceeding it is `model_failed`. */
export const MODEL_TIMEOUT_MS = 90_000;

/**
 * Schema-repair reprompts allowed on the ONE structured call. Providers loop
 * `maxRetries + 1` attempts, so this bounds `attempts` at 3 without extra code.
 */
export const MAX_SCHEMA_REPAIRS = 2;

/**
 * Assembled-prompt input ceiling, measured with OUR tokenizer over the user
 * text we build (AC-11).
 *
 * It bounds what we ASSEMBLE. It does NOT bound what a provider BILLS, and the
 * two are not close: a live generation against `openai/gpt-5.6-luna-pro` on
 * OpenRouter measured 11,376 tokens and was billed 57,243. Lowering this number
 * shrinks the prompt; it does not reliably shrink the invoice. The service logs
 * both figures and their ratio every generation so the difference is visible
 * rather than assumed away - see `OnboardingService.logTokenAccounting`.
 */
export const PROMPT_TOKEN_CEILING = 30_000;

/**
 * Ratio of billed to measured input tokens past which the token-accounting log
 * line is raised from `info` to `warn`. 2.0 is deliberately forgiving: a
 * provider's system overhead, its JSON-schema framing and a tokenizer that is
 * not ours all cost something, and none of that is a defect. Five times is.
 */
export const TOKEN_ACCOUNTING_WARN_RATIO = 2;

export const MAX_EXCERPT_FILES = 15;
export const MAX_EXCERPT_LINES = 120;

/** Above this many indexed files the generation runs facts-only, no excerpts. */
export const EXCERPT_CUTOFF_INDEXED_FILES = 50_000;

export const MAX_CRITICAL_PATHS = 8;
export const MAX_RUN_STEPS = 12;
export const MAX_READING_ENTRIES = 10;
export const MAX_FIRST_TASKS = 5;

export const MAX_ISSUES = 20;

/**
 * How deep into the file ranking a first task may be found. The marker grep is
 * filtered to this candidate set, which is what keeps a `TODO` inside a
 * vendored dependency out of the tour — and the price is that a genuine `TODO`
 * in a file ranked below this is invisible. Raising it is free.
 */
export const MAX_RANKED_FILES = 200;

/** Ceiling on the no-graph file listing, so an enormous clone stays bounded. */
export const MAX_HEURISTIC_FILES = 2_000;

export const MARKER_PATTERN = 'TODO|FIXME';
export const GOOD_FIRST_ISSUE_LABEL = 'good first issue';

/**
 * Repo-map token budgets, walked DOWN when the assembled prompt is still over
 * ceiling after every excerpt has been dropped. `0` is the last rung: no map at
 * all. Each rung is a re-FETCH, not a truncation — `getRepoMap` re-renders the
 * skeleton for the budget it is given.
 */
export const REPO_MAP_BUDGETS = [8_000, 4_000, 2_000, 0] as const;

/** Largest mermaid source persisted; anything bigger is dropped, prose kept. */
export const MAX_DIAGRAM_BYTES = 8_192;

/**
 * How far back the read path walks to answer "N commits behind". Matches the
 * depth `SimpleGitClient.sync()` fetches at, because that is the most history a
 * resynced clone can hold — beyond it the tour's sha is simply unreachable and
 * the header names both shas instead of a number. Kept local rather than
 * imported: this is a bound on a READ, not a copy of the fetch policy.
 */
export const COMMIT_DISTANCE_MAX_COUNT = 50;

/**
 * Most paths probed against the clone while verifying one draft. The draft's
 * rows are capped by its schema; its PROSE is not, so a model that wrote a
 * hundred inline-code spans must not turn into a hundred file reads.
 */
export const MAX_PATH_PROBES = 200;

/**
 * The fixed, CLIENT-INDEPENDENT read list. Nothing in a request can add to it,
 * which is what removes the path-traversal class from this feature by
 * construction rather than defending against it. `.env` is deliberately absent:
 * only `.env.example` is read, and only for variable NAMES.
 */
export const FACT_FILES: readonly string[] = [
  // manifests
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  // task runners
  'Makefile',
  'Justfile',
  'Taskfile.yml',
  // containers
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Dockerfile',
  // environment (NAMES only)
  '.env.example',
  '.env.sample',
  // prose
  'README.md',
  'CONTRIBUTING.md',
] as const;

/** Manifest files, in probe order, mapped to the stack they declare. */
export const STACK_BY_MANIFEST: Record<string, string> = {
  'package.json': 'Node.js',
  'pyproject.toml': 'Python',
  'go.mod': 'Go',
  'Cargo.toml': 'Rust',
  'pom.xml': 'Java (Maven)',
  'build.gradle': 'Java (Gradle)',
  Gemfile: 'Ruby',
  'composer.json': 'PHP',
};

/** Longest README slice that reaches the prompt. */
export const MAX_README_LINES = 120;

/**
 * Paths the no-graph heuristic drops.
 *
 * The graph-having path is filtered TWICE — at index time by `EXCLUDED_DIRS`
 * and at read time by repo-intel's junk filter — while this path has neither,
 * so a re-typed, narrower list is how a `*.test.ts`, a `tsconfig.json` or a
 * `.d.ts` ends up in front of a newcomer as a "critical path". The shared
 * knowledge is therefore IMPORTED from `repo-intel/constants.ts` (a module's
 * constants are an exempt cross-module import; its `service.ts`, where
 * `isJunkPath` lives, is not) and only the genuinely onboarding-specific
 * additions stay local.
 *
 * Local additions: `git ls-files` already excludes ignored output, but a
 * vendored dependency can be TRACKED, and lockfiles sit at root depth where the
 * heuristic's own signals cannot push them down. `.lock` alone misses the two
 * commonest ones, so both are named.
 *
 * Matched case-insensitively, so every entry is lowercase.
 */
export const HEURISTIC_EXCLUDE_PATTERNS: readonly string[] = [
  ...JUNK_PATH_PATTERNS,
  'node_modules/',
  'vendor/',
  'third_party/',
  'dist/',
  'build/',
  'fixtures/',
  '__snapshots__/',
  '.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
];

/** Basenames that read as a program's front door. */
export const ENTRY_POINT_NAMES: readonly string[] = [
  'main',
  'index',
  'app',
  'server',
  'cli',
] as const;
