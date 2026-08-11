import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  fail,
  INCLUDE_ENDPOINTS_DESC,
  MAX_CALLERS_DESC,
  MIN_RANK_DESC,
  prNumberParam,
  repoParam,
  type ToolDeps,
} from './shared.js';

/**
 * Real capability first, so the schema below makes sense, then the flag, so no
 * call is wasted. The long "how to build it" instruction lives in the ERROR
 * BODY, not here: a description is taxed on every session, an error body only
 * when it fires.
 */
export const GET_BLAST_RADIUS_DESCRIPTION =
  'Map the impact of a pull request: which symbols it changes, which files call them, and which HTTP endpoints sit behind those callers. NOT IMPLEMENTED YET - this is the L04 exercise; calling it returns an error that spells out exactly what to build.';

/**
 * The ONLY tool here with an `outputSchema`, because the schema IS the exercise
 * contract: it is what the finished body has to produce.
 *
 * It mirrors the ENGINE's `BlastResult`
 * (server/src/modules/repo-intel/types.ts:57-87) one to one - `changedSymbols`,
 * `callers[].viaSymbol -> via`, `impactedEndpoints`, with `factsByFile` and
 * `reason` dropped as noise.
 *
 * CAREFUL: the repo already has a contract NAMED `BlastRadius`
 * (contracts/brief.ts:39, exported from the barrel, with a client copy) and it
 * is a DIFFERENT shape - `{ changed_symbols, downstream, summary }`, the
 * higher-level PR Brief view of later lessons. Do not merge the two, and do not
 * let the exercise create a third.
 */
const OUTPUT_SCHEMA = z.object({
  changed_symbols: z.array(z.string()).describe('Symbols the PR adds, removes or edits.'),
  callers: z
    .array(
      z.object({
        file: z.string().describe('File containing the caller.'),
        symbol: z.string().describe('The calling symbol.'),
        via: z.string().describe('Which changed symbol it reaches.'),
        line: z.number().int().describe('1-based line of the reference.'),
        rank: z.number().describe('Importance of the caller file, 0 to 1.'),
      }),
    )
    .describe('Files that reference a changed symbol, highest-ranked first.'),
  impacted_endpoints: z
    .array(z.string())
    .describe('HTTP endpoints as "METHOD /path" reachable from the callers.'),
  degraded: z.boolean().describe('True when the answer came from the ripgrep fallback.'),
});

/**
 * The homework. Written against the `onion-architecture` skill rather than as
 * "do it all in the route": step 1 is a SERVICE method, step 2 leaves the route
 * as pure transport.
 */
export const BLAST_RADIUS_HOMEWORK = [
  'get_blast_radius is not implemented yet - it is the L04 exercise. The input and output',
  'schemas advertised above are the contract; only the body is missing.',
  '',
  'Build it in this order:',
  '',
  '1. server/src/modules/repo-intel/service.ts - add',
  '   RepoIntelService.blastRadiusForPull(workspaceId, repoId, prNumber). It resolves the',
  "   PR's changed files through PullsService.detailByNumber(...).files (PrDetail.files:",
  '   PrFile[], contracts/platform.ts:223) and delegates to the existing',
  '   getBlastRadius(repoId, changedFiles) at server/src/modules/repo-intel/service.ts:220.',
  "   Constructing another module's SERVICE is the documented composition seam the",
  '   no-cross-module-imports rule allows (the same one polling -> pulls already uses).',
  '   PullsRepository is not an option: it is not in the container.',
  '',
  '2. server/src/modules/repo-intel/routes.ts - add GET /repos/:id/blast?pr=<number>. It stays',
  '   transport only: zod schemas for params, querystring and response, ONE service call,',
  '   status mapping. Nothing to register - repo-intel is already in modules/index.ts.',
  '',
  '3. The response zod schema is a CONTRACT, so it goes under vendor/shared/contracts/ and',
  '   into BOTH physical copies (server/src/vendor/shared and client/src/vendor/shared).',
  '   Do NOT reuse the existing BlastRadius in contracts/brief.ts:39 - that is a different,',
  '   higher-level PR Brief shape ({ changed_symbols, downstream, summary }). This tool',
  "   mirrors the engine's BlastResult (server/src/modules/repo-intel/types.ts:57-87):",
  '   changedSymbols, callers[].viaSymbol -> via, impactedEndpoints; factsByFile and reason',
  '   are dropped as noise.',
  '',
  '4. mcp/src/tools/get-blast-radius.ts - replace this body with a call to that route,',
  '   honour max_callers, min_rank and include_endpoints, and return BOTH `content` and',
  '   `structuredContent` matching the outputSchema already declared here.',
  '',
  '5. mcp/test/get-blast-radius.test.ts - replace the stub assertion with a real test over a',
  '   fixture, the way the other tool tests are written.',
  '',
  '6. cd server && pnpm arch:check must pass, and so must cd mcp && pnpm test && pnpm budget.',
].join('\n');

export function registerGetBlastRadius(server: McpServer, _deps: ToolDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: z.object({
        repo: repoParam,
        pr_number: prNumberParam,
        max_callers: z.number().int().min(1).max(100).default(25).describe(MAX_CALLERS_DESC),
        min_rank: z.number().min(0).max(1).default(0).describe(MIN_RANK_DESC),
        include_endpoints: z.boolean().default(true).describe(INCLUDE_ENDPOINTS_DESC),
      }),
      outputSchema: OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    // The tool STAYS in tools/list. A schema with no body is the exercise: it
    // shows the shape to build against, and it makes the gap discoverable
    // instead of invisible.
    async () => fail(BLAST_RADIUS_HOMEWORK),
  );
}
