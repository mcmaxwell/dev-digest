/**
 * project-context constants — the discovery scope and every budget the feature
 * enforces, in one file so they can be read without reading the algorithm.
 */

/**
 * The four discovery roots. A document is a project document only when its
 * repo-relative path starts with one of these AND ends in `.md`; a
 * repository-root `README.md` is deliberately not one.
 *
 * A document's `category` is the first segment of its path, so this list is
 * also the `ProjectDocCategory` enum in `vendor/shared`.
 */
export const DOC_ROOTS = ['.devdigest', 'docs', 'specs', 'insights'] as const;

export const DOC_EXT = '.md';

/** Per-document size cap. A larger file is never listed, so never attachable. */
export const MAX_DOC_BYTES = 256 * 1024;

/** Per-repository document cap; the first N in path order are kept. */
export const MAX_DOCS = 500;

/** Per-document prompt ceiling; above it the body is truncated at a heading. */
export const MAX_DOC_TOKENS = 8_000;

/** Per-run project-context ceiling; the tail beyond it is dropped and logged. */
export const MAX_RUN_TOKENS = 20_000;

// --- Job kind (registered on JobRunner; enqueued after clone and resync) -----
export const SCAN_JOB_KIND = 'project-context-scan';

/**
 * Per-kind budget for the scan job. A walk of four roots over at most 500
 * documents is designed to finish in 5 s; 60 s is the honest worst case on a
 * cold filesystem, and a ceiling BELOW the worst case fails in the worst way
 * (`withTimeout` cannot cancel the work it abandons).
 */
export const SCAN_TIMEOUT_MS = 60_000;
