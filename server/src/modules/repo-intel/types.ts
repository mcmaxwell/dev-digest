/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

export type DegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`). Adopted by blast/service.ts in
// T2; in T1 the facade returns a degraded best-effort over container.codeIndex.
// ---------------------------------------------------------------------------

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCallerRow {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: number;
  /** file_rank.rank of the caller file (0 in the degraded/ripgrep path). */
  rank: number;
}

export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  callers: BlastCallerRow[];
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: string[];
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Index health (L04 blast). An HONEST projection of `repo_index_state` plus the
// three tables whose emptiness silently changes what a read can answer.
// ---------------------------------------------------------------------------

/**
 * What a consumer needs to decide how much of an index-backed answer to trust.
 *
 * `ranked` / `edgesWritten` / `factsWritten` are COUNTED from the tables, not
 * read out of `repo_index_state.stats`: the incremental pipeline recomputes rank
 * and facts but does not re-record their counts in `stats`, so a stats-derived
 * `ranked` would report 0 after every "Re-analyze" on a perfectly ranked repo.
 * Everything that IS taken from `stats` is coerced defensively - it is untyped
 * jsonb written by two different pipelines.
 */
export interface IndexHealth {
  /** False when repo-intel is switched off for this deployment. */
  enabled: boolean;
  /** False when the repo has no `repo_index_state` row at all. */
  present: boolean;
  status: IndexStatus | null;
  indexerVersion: number;
  lastIndexedSha: string;
  updatedAt: Date | null;
  /** The indexer ran out of its soft time budget and skipped rank/graph/facts. */
  softBudgetReached: boolean;
  /** The dependency-cruiser graph build failed; the message, or null. */
  graphFailed: string | null;
  parseDegradedCount: number;
  /** Rows in `file_rank`. Zero means callers come back unranked, not absent. */
  ranked: number;
  /** Rows in `file_edges`. Zero means the reverse walk cannot run. */
  edgesWritten: number;
  /** Rows in `file_facts`. Zero means no endpoint or cron is answerable. */
  factsWritten: number;
}

/** One hop of the reverse (who-imports-me) walk. */
export interface ReverseLevel {
  /** 1 = imports a changed file directly; 2 = imports one of those importers. */
  depth: number;
  /** `file` transitively imports the changed file `target`. */
  importers: Array<{ file: string; target: string }>;
}

/** Precomputed per-file facts, as the facade exposes them. */
export interface FileFactsRow {
  file: string;
  endpoints: string[];
  crons: string[];
}

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
  /**
   * L04 — how trustworthy an index-backed read is right now. ALWAYS works: a
   * repo that was never indexed returns `{ present: false }`, never a throw.
   */
  getIndexHealth(repoId: string): Promise<IndexHealth>;
  /**
   * L04 — who imports these files, up to `depth` hops out. Feeds endpoint/cron
   * attribution only (an import edge does not prove a call).
   */
  getReverseImporters(
    repoId: string,
    files: string[],
    depth: number,
  ): Promise<ReverseLevel[]>;
  /** L04 — precomputed endpoints/crons for the given files (no clone reads). */
  getFileFactsFor(repoId: string, files: string[]): Promise<FileFactsRow[]>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;
  /**
   * Ranked paths for a SAMPLING stratum (L02 conventions extractor).
   *
   * Two things `getConventionSamples` cannot express:
   *  - `kind: 'tests'` reaches test files, which the convention sampler
   *    unconditionally drops — so "tests are named `*.it.test.ts`" is otherwise
   *    structurally unextractable;
   *  - `perDirCap` spreads the sample across top-level directories instead of
   *    returning N files from whichever layer happens to rank highest.
   */
  getRankedSample(
    repoId: string,
    opts: { n: number; kind?: 'source' | 'tests'; perDirCap?: number },
  ): Promise<Array<{ path: string; rank: number }>>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
}
