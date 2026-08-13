/** Per-run project-context ceiling the server enforces (MAX_RUN_TOKENS). */
export const TOKEN_BUDGET = 20_000;

/** 80 percent of the run ceiling — where the footer switches to a warning. */
export const TOKEN_WARN_AT = 16_000;

/** Above this many rows the available list renders through a virtualiser. */
export const VIRTUALIZE_ABOVE = 100;

/** Row height fed to the virtualiser's `estimateSize`. */
export const ROW_HEIGHT = 52;
