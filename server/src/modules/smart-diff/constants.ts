/**
 * Every pattern and threshold the classifier uses. Kept out of `classify.ts` so
 * the rules can be read (and argued with) without reading the algorithm, and so
 * a lesson that tunes the heuristics touches one file.
 *
 * Patterns are matched against the POSIX path of a changed file, lower-cased.
 * Order inside a list does not matter; order BETWEEN the lists does — see
 * `roleFor`, which tries boilerplate first and falls through to core.
 */

/**
 * Matched against a path segment at ANY depth, e.g. `dist/` in `pkg/dist/a.js`.
 * Only names that cannot plausibly be hand-written source belong here.
 */
export const BOILERPLATE_DIRS = [
  'dist',
  '.next',
  'coverage',
  'node_modules',
  '__snapshots__',
  'migrations',
  'generated',
] as const;

/**
 * Matched ONLY as the first path segment. `out/` and `build/` are build output
 * at the repo root, but `src/out/handlers.ts` and `src/build/pipeline.ts` are
 * ordinary source — and misfiling real source as skimmable is the one direction
 * the "core is the default" safety argument does not cover.
 */
export const BOILERPLATE_ROOT_DIRS = ['out', 'build'] as const;

/** Exact basenames. Lock files are the archetypal "huge diff, zero signal" file. */
export const BOILERPLATE_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'cargo.lock',
  'poetry.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
  'podfile.lock',
] as const;

/** Suffix matches: generated code, build artefacts, snapshots and binary assets. */
export const BOILERPLATE_SUFFIXES = [
  '.snap',
  '.min.js',
  '.min.css',
  '.map',
  '.pb.go',
  '_pb2.py',
  '.pb.cc',
  '.pb.h',
  '.g.dart',
  '.freezed.dart',
  // assets: a changed binary has no reviewable diff at all
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
  '.zip',
] as const;

/** Infix matches for the `*.generated.*` / `*.gen.*` naming conventions. */
export const BOILERPLATE_INFIXES = ['.generated.', '.gen.', '.g.'] as const;

/**
 * Company / assistant context: knowledge a team keeps beside the code —
 * decisions, onboarding notes, agent instructions. It is not application code
 * and reviewing it line by line is not what the PR is about, so it joins the
 * collapsed group. It is kept SEPARATE from the boilerplate lists above because
 * the reason differs: boilerplate is mechanical bulk, this is prose context.
 *
 * Matched as a path segment at any depth, so `packages/api/.company/notes.md`
 * counts as well as a root-level `.company/`.
 */
export const CONTEXT_DIRS = ['.company', '.claude', '.cursor'] as const;

/** Exact basenames (lower-cased) that are company memory wherever they sit. */
export const CONTEXT_FILES = ['memory.md'] as const;

/** Infix match, so `team.memory.md` / `product.memory.mdx` count too. */
export const CONTEXT_INFIXES = ['.memory.'] as const;

/**
 * Copilot's instruction files, which live INSIDE `.github` — a directory that
 * is otherwise wiring. Matched as a basename prefix scoped to `.github`, so a
 * real `src/copilot-session.ts` is untouched.
 */
export const CONTEXT_GITHUB_PREFIXES = ['copilot-'] as const;

/** Exact basenames that hook code together rather than implement behaviour. */
export const WIRING_FILES = [
  'package.json',
  'dockerfile',
  'makefile',
  'procfile',
  'go.mod',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'gemfile',
] as const;

/** Basenames without their extension: barrels, bootstrap and entrypoints. */
export const WIRING_STEMS = [
  'index',
  'main',
  'app',
  'server',
  'config',
  'settings',
  'routes',
  'router',
  'mod',
  '__init__',
  'setup',
] as const;

/** Basename prefixes — dotfile config (`.eslintrc.json`, `.prettierrc`). */
export const WIRING_PREFIXES = ['.eslintrc', '.prettierrc', '.babelrc', '.editorconfig'] as const;

/** Suffix matches for config and CI descriptors. */
export const WIRING_SUFFIXES = [
  '.config.ts',
  '.config.js',
  '.config.mjs',
  '.config.cjs',
  '.config.json',
  '.cjs',
  '.env',
  '.env.example',
  '.lock.json',
] as const;

/** Path segments whose whole subtree is wiring (CI, container and infra descriptors). */
export const WIRING_DIRS = ['.github', '.circleci', '.husky', 'deploy', 'k8s', 'helm'] as const;

/** `tsconfig.json`, `tsconfig.build.json`, … all wire the toolchain together. */
export const WIRING_STEM_PREFIXES = ['tsconfig', 'docker-compose', 'compose'] as const;

/**
 * Longest changed line `isPlumbingOnlyPatch` will even look at. Patch text comes
 * from GitHub and is attacker-controlled; nothing this long is an import
 * statement, and refusing to match it fails toward `core` — the safe direction.
 */
export const MAX_PLUMBING_LINE_CHARS = 500;

/**
 * Split suggestion. These are review-effort heuristics, not hard limits: a PR
 * over EITHER threshold is flagged, because "too many lines" and "too many
 * files" are independently exhausting to review.
 */
export const SPLIT_LINE_THRESHOLD = 400;
export const SPLIT_FILE_THRESHOLD = 20;

/**
 * How many leading path segments name a proposed split (`src/api/x.ts` →
 * `src/api`). Two is the level at which most repos separate concerns; one is
 * usually just `src`.
 */
export const SPLIT_DIR_DEPTH = 2;

/**
 * Below this many distinct buckets there is nothing to split INTO, so the
 * suggestion is suppressed even on an oversized PR — proposing a single split
 * containing every file is noise, not advice.
 */
export const SPLIT_MIN_BUCKETS = 2;

/** Group render order. The reviewer reads top-down; substance comes first. */
export const ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const;
