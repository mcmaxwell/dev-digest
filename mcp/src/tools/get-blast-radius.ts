import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { describeApiError, unknownRepoMessage } from '../format/errors.js';
import { renderBlast } from '../format/render.js';
import { MAX_LINE, shape, type ShapeOptions } from '../rules/blast-shape.js';
import {
  INCLUDE_ENDPOINTS_DESC,
  MAX_CALLERS_DESC,
  MIN_RANK_DESC,
  fail,
  ok,
  prNumberParam,
  repoParam,
  type ToolDeps,
} from './shared.js';

/**
 * What it does, then the two things that decide whether the model should trust
 * the answer: it is free (so there is no reason not to call it), and it says
 * when the index is partial (so an empty caller list is never read as proof).
 */
export const GET_BLAST_RADIUS_DESCRIPTION =
  'Map the impact of a pull request: which symbols it changes, which files call them, and which HTTP endpoints and cron jobs sit behind those callers. Reads a prebuilt index, costs nothing, and reports when that index is partial so missing callers are never mistaken for none.';

/** Per-symbol caller ceiling. The result text always says how many were hidden. */
const MAX_CALLERS_LIMIT = 100;

/**
 * GROUPED BY CHANGED SYMBOL, not a flat caller list.
 *
 * The flat shape this replaced made the model re-join `callers[].via` back onto
 * `changed_symbols` itself, and it had no way at all to express "this symbol has
 * no known callers" - the row simply was not there, which reads as absence of
 * data rather than as a fact.
 *
 * `index_status` replaces the old `degraded: boolean` at the same token cost and
 * carries strictly more: `partial` is precisely the case a boolean could not
 * name, and the case where an empty `callers` array must NOT be read as "nothing
 * calls this".
 *
 * The truncation counters (`caller_total`) are deliberately NOT here. A schema
 * is loaded into the system prompt of every session; a sentence in the result
 * text costs nothing until the tool is actually called.
 *
 * Every numeric field carries an explicit `.max()`: `z.number().int()` alone
 * emits `"maximum": 9007199254740991` into the advertised schema, which is
 * visible noise in every session's prompt (see mcp/INSIGHTS.md).
 */
const OUTPUT_SCHEMA = z.object({
  changed_symbols: z
    .array(
      z.object({
        name: z.string().describe('Symbol declared in a changed file.'),
        file: z.string().describe('File that declares it.'),
        kind: z.string().describe('function, class, method, …'),
      }),
    )
    .describe('Symbols this PR changes, most-called first.'),
  downstream: z
    .array(
      z.object({
        symbol: z.string().describe('Which changed symbol this row is about.'),
        callers: z
          .array(
            z.object({
              name: z.string().describe('The calling symbol.'),
              file: z.string().describe('File containing the caller.'),
              line: z.number().int().min(0).max(MAX_LINE).describe('1-based line of the call.'),
              rank: z.number().min(0).max(1).describe('Importance of the caller file.'),
            }),
          )
          .describe('Files that call it, highest-ranked first.'),
        endpoints_affected: z
          .array(z.string())
          .describe('HTTP endpoints as "METHOD /path" reachable from those callers.'),
        crons_affected: z.array(z.string()).describe('Scheduled jobs reachable from them.'),
      }),
    )
    .describe('One entry per changed symbol. An empty callers list is a real answer.'),
  summary: z.string().describe('One-paragraph impact summary, or empty if none was generated.'),
  index_status: z
    .enum(['ok', 'partial', 'degraded'])
    .describe('partial means callers or endpoints may be missing; degraded means no index.'),
});

export function registerGetBlastRadius(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: z.object({
        repo: repoParam,
        pr_number: prNumberParam,
        max_callers: z
          .number()
          .int()
          .min(1)
          .max(MAX_CALLERS_LIMIT)
          .default(25)
          .describe(MAX_CALLERS_DESC),
        min_rank: z.number().min(0).max(1).default(0).describe(MIN_RANK_DESC),
        include_endpoints: z.boolean().default(true).describe(INCLUDE_ENDPOINTS_DESC),
      }),
      outputSchema: OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ repo, pr_number, max_callers, min_rank, include_endpoints }) => {
      try {
        const resolved = await deps.resolvers.repo(repo);
        if (!resolved.ok) return fail(unknownRepoMessage(repo, resolved.known));

        const pull = await deps.api.pullByNumber(resolved.repo.id, pr_number);
        if (!pull.id) {
          return fail(
            `DevDigest knows PR #${pr_number} of ${resolved.repo.full_name} but has no internal id ` +
              `for it, so its blast radius cannot be read. Re-import the pull request and retry.`,
          );
        }

        const opts: ShapeOptions = {
          maxCallers: max_callers,
          minRank: min_rank,
          includeEndpoints: include_endpoints,
        };
        const page = await deps.api.blastRadius(pull.id);
        const shaped = shape(page, opts);
        const text = renderBlast(page, shaped, {
          ...opts,
          repo: resolved.repo.full_name,
          prNumber: pr_number,
        });

        return { ...ok(text), structuredContent: shaped };
      } catch (err) {
        return fail(describeApiError(err));
      }
    },
  );
}
