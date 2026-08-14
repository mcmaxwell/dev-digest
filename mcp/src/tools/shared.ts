import * as z from 'zod';
import type { ApiClient, Resolvers } from '../api/index.js';
import type { RunIndex } from '../run-index.js';

/**
 * Schema fragments and result helpers shared by the five tools.
 *
 * EVERY STRING IN THIS FILE IS TAXED ON EVERY SESSION OF EVERY USER. A host
 * loads `tools/list` into the system prompt before the first message, so a word
 * added here is a word paid for forever, whether or not the tool is ever
 * called. Changing one of these texts is a deliberate decision followed by
 * `pnpm budget`, never a drive-by rewrite - and `test/tools-list.test.ts` holds
 * an independent copy of the approved wording so drift fails as a test.
 *
 * The counterpart is in src/format/errors.ts: an error body is paid for only
 * when it fires, which is why the long, teaching messages live there.
 */

/**
 * What a tool handler is allowed to reach. `api` is the whole reason the
 * hermetic lane exists (see src/api/index.ts); `sleep`/`now` are injected only
 * so `run_agent_on_pr`'s poll schedule can run instantly in a test.
 */
export interface ToolDeps {
  api: ApiClient;
  resolvers: Resolvers;
  runIndex: RunIndex;
  defaultWaitSeconds: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Parameter descriptions (limit: 160 characters)
// ---------------------------------------------------------------------------

export const REPO_DESC = 'Repository as "owner/name", exactly as listed in DevDigest.';
/** `get_findings` is the one place `repo` is OPTIONAL, so it has to say what it
 *  relates to. That relation is prose here because encoding "run_id XOR (repo +
 *  pr_number)" in JSON Schema would emit an `anyOf`. */
export const REPO_DESC_FINDINGS =
  'Repository as "owner/name". Use with pr_number when you have no run_id.';
export const PR_NUMBER_DESC = 'Pull request number.';
export const AGENT_DESC = 'Agent slug or id from list_agents.';
export const SEVERITY_MIN_DESC = 'Drop findings below this severity.';
export const LIMIT_DESC = 'Maximum findings returned; the response says how many were withheld.';
/** `get_conventions` returns rules, not findings. Sharing LIMIT_DESC would tell
 *  the model this tool is about findings, which is the one thing it is not. */
export const LIMIT_RULES_DESC = 'Maximum rules returned; the response says how many were withheld.';
export const WAIT_SECONDS_DESC =
  'How long to wait before returning status running instead of results.';
export const RUN_ID_DESC = 'Run id from run_agent_on_pr. Takes precedence over repo and pr_number.';
export const DETAIL_DESC =
  'concise lists severity, location and title; full adds rationale and suggested fix.';
export const ENABLED_ONLY_DESC = 'Only agents that can run. Set false to also see disabled ones.';
export const CATEGORY_DESC = 'Only rules in this category.';
export const STATUS_DESC =
  'accepted means a human confirmed the rule; all adds unreviewed candidates.';
export const EVIDENCE_DESC = 'Include one file:line pointer proving each rule.';
export const MAX_CALLERS_DESC = 'Maximum callers listed per changed symbol, highest-ranked first.';
export const MIN_RANK_DESC = 'Drop callers whose file rank is below this. Ignored on an unranked index.';
export const INCLUDE_ENDPOINTS_DESC = 'Include the endpoints and scheduled jobs the callers sit behind.';

// ---------------------------------------------------------------------------
// Shared parameter schemas
// ---------------------------------------------------------------------------

export const repoParam = z.string().min(1).describe(REPO_DESC);
export const prNumberParam = z.number().int().min(1).describe(PR_NUMBER_DESC);
export const severityMinParam = z
  .enum(['SUGGESTION', 'WARNING', 'CRITICAL'])
  .default('SUGGESTION')
  .describe(SEVERITY_MIN_DESC);
export const detailParam = z.enum(['concise', 'full']).default('concise').describe(DETAIL_DESC);
/** Findings limit. `get_conventions` needs a different ceiling and builds its own. */
export const findingsLimitParam = z.number().int().min(1).max(50).default(20).describe(LIMIT_DESC);

export const MAX_FINDINGS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** A normal result. */
export function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * A result the model SEES and can act on. The SDK turns an uncaught throw into
 * the same shape, but with the exception's message - which is written for a
 * developer reading a stack trace, not for a model deciding what to do next.
 * Always return, never throw.
 */
export function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
