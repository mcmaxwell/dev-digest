/**
 * repo-intel constants. Phase-tagged: [T1] used now; [T2]/[T3]
 * exported early so the pipeline lands against a single source of truth.
 */

// --- Job kinds (registered on JobRunner; enqueued from repos/service.ts) ----
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
/** Manual "re-analyze": fetch latest from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';

// --- Walk / parse scope -----------------------------------------------------
/** [T1] Files we parse (diff-scoped in T1; whole walk in T2). */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** [T1] Directories never walked. `.gitignore` is layered on top in T2 walk. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

// --- Junk paths -------------------------------------------------------------
/**
 * Path kinds excluded from rank-driven file samples (conventions, onboarding).
 *
 * Split into three lists rather than one blob because the conventions sampler
 * needs to ASK FOR tests (a stratum of its own) while still excluding configs
 * and generated output; `JUNK_PATH_PATTERNS` is the union, and is what
 * `getTopFilesByRank` applies.
 *
 * They live in `constants.ts` rather than beside their predicates in
 * `service.ts` because a second module needs the same knowledge: onboarding's
 * no-graph heuristic has no ranked input to inherit the filter from, and
 * `no-cross-module-imports` exempts only another module's `service.ts`,
 * `types.ts` or `constants.ts` — of which this is the one that may hold data.
 * A re-typed copy there was materially narrower and let test files and configs
 * in front of a newcomer.
 *
 * Every pattern is lowercase; matching lowercases the path first.
 */
export const TEST_PATH_PATTERNS = [
  '.test.',
  '.spec.',
  '__tests__/',
  '__mocks__/',
  '/test/',
  '/tests/',
  '/__fixtures__/',
  '/e2e/',
] as const;

export const CONFIG_PATH_PATTERNS = [
  '.config.',
  'vitest.',
  'jest.',
  'eslint',
  'prettier',
  'tsconfig',
] as const;

export const GENERATED_PATH_PATTERNS = [
  '.d.ts',
  '/migrations/',
  '/dist/',
  '/build/',
  '.min.',
] as const;

/** The union: nothing matching this may be shown as a file that matters. */
export const JUNK_PATH_PATTERNS: readonly string[] = [
  ...TEST_PATH_PATTERNS,
  ...CONFIG_PATH_PATTERNS,
  ...GENERATED_PATH_PATTERNS,
];

// --- Read-time limits -------------------------------------------------------
/**
 * [T1] Caller fan-out cap PER CHANGED SYMBOL.
 *
 * Enforced in SQL by `getResolvedCallersTopN`
 * (`row_number() OVER (PARTITION BY to_symbol ...)`), not by slicing the flat
 * result: a global slice lets one hot symbol eat every slot and starve the rest,
 * which is the opposite of what a per-symbol cap is for.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * [T3] Reverse (who-imports-me) walk limits, used by `getReverseImporters`.
 *
 * The walk exists so an endpoint two hops away (`routes -> service ->
 * repository`) is still attributed to a change in the repository: the endpoint's
 * file never names the changed symbol, so caller rows alone cannot find it.
 * It feeds ONLY endpoints/crons - an import edge is not proof of a call, so it
 * never adds callers.
 */
export const REVERSE_FANOUT_PER_LEVEL = 200;
/** Hard ceiling on rows fetched per level, before the fan-out cap is applied. */
export const REVERSE_MAX_EDGES = 2000;

/**
 * [T1] Bumped whenever the AST extractor or symbol schema changes. A mismatch
 * with `repo_index_state.indexer_version` forces a full reindex.
 *
 * v2 (T3): graph + decl_file resolution + file_rank + repo-map landed, so every
 * T2 `partial` index must be rebuilt to gain the rank-driven data.
 */
export const INDEXER_VERSION = 2;

// --- [T2] Full-index limits (documented now, enforced in the pipeline) ------
export const MAX_INDEXED_FILES = 5000;
export const MAX_FILE_SIZE = 400 * 1024; // 400 KB
export const MAX_PARSE_MS_PER_FILE = 2000;
/** Soft self-watch budget (< JobRunner hard 120s) → finish as `partial`. */
export const INDEX_SOFT_BUDGET_MS = 110_000;

// --- [T3] Graph / hotness / repo-map ---------------------------------------
export const BFS_DEPTH = 2;
export const HOTNESS_WINDOW_DAYS = 180;
export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;
/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
