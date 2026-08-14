/**
 * blast module constants. Every ceiling this feature applies is here, so the
 * limits can be read without reading the algorithm.
 */

/** Callers shown per changed symbol. Mirrors the SQL cap in repo-intel. */
export { MAX_CALLERS_PER_SYMBOL, BFS_DEPTH } from '../repo-intel/constants.js';

/**
 * Changed symbols carried in one response.
 *
 * A PR that touches a barrel file can declare hundreds; past this point the
 * card is unreadable and the payload is mostly noise. Truncation is reported
 * (`PrBlastRadius.changed_symbols.length` vs the count in the summary line), it
 * is never silent.
 */
export const MAX_CHANGED_SYMBOLS = 60;

/** Endpoints and crons listed per symbol, after the union. */
export const MAX_ENDPOINTS_PER_SYMBOL = 25;
export const MAX_CRONS_PER_SYMBOL = 25;

/** Characters of model-written summary we persist and serve. */
export const MAX_SUMMARY_CHARS = 400;

/** LLM ceilings for the optional summary. One cheap call, no retry storm. */
export const SUMMARY_LLM_TIMEOUT_MS = 30_000;
export const SUMMARY_LLM_MAX_RETRIES = 1;

/** Digest limits for the summary prompt - it never sees a diff or file body. */
export const SUMMARY_PROMPT_MAX_SYMBOLS = 12;
export const SUMMARY_PROMPT_MAX_FILES_PER_SYMBOL = 5;
export const SUMMARY_PROMPT_MAX_ENDPOINTS = 12;
export const SUMMARY_PROMPT_MAX_CRONS = 8;
