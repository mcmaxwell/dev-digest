/** First version recorded for a new skill (mirrors agents' INITIAL_AGENT_VERSION). */
export const INITIAL_SKILL_VERSION = 1;

/** Upload cap for skill imports (.md or .zip) — a skill is prose, not a dataset. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Cap on a derived description (first-paragraph fallback). */
export const DERIVED_DESCRIPTION_MAX_CHARS = 200;
