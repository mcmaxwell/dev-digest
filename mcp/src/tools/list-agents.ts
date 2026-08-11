import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ApiClient } from '../api/index.js';
import { describeApiError } from '../format/errors.js';
import { renderAgents } from '../format/render.js';
import { ambiguousSlugs } from '../format/slug.js';
import { detailParam, ENABLED_ONLY_DESC, fail, ok } from './shared.js';

/**
 * `Call this before run_agent_on_pr` orients the model in the tool graph, and
 * `UUIDs that cannot be guessed from a name` heads off the single most likely
 * hallucination here: an invented agent id.
 */
export const LIST_AGENTS_DESCRIPTION =
  'List the reviewer agents configured in this DevDigest workspace. Call this before run_agent_on_pr: it returns the agent slug and id that tool needs, and agent ids are UUIDs that cannot be guessed from a name.';

export function registerListAgents(server: McpServer, deps: { api: ApiClient }): void {
  server.registerTool(
    'list_agents',
    {
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: z.object({
        enabled_only: z.boolean().default(true).describe(ENABLED_ONLY_DESC),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ enabled_only, detail }) => {
      let agents;
      try {
        agents = await deps.api.listAgents();
      } catch (err) {
        return fail(describeApiError(err));
      }

      // Empty is a RESULT, not an error: "you have no agents" is a fact the
      // model should report, and an isError here would make it retry.
      if (agents.length === 0) {
        return ok(
          'This DevDigest workspace has no reviewer agents yet. Create one at ' +
            'http://localhost:3000/agents, then call list_agents again.',
        );
      }

      const shown = enabled_only ? agents.filter((a) => a.enabled) : agents;
      if (shown.length === 0) {
        return ok(
          `All ${agents.length} reviewer agents in this workspace are disabled. Enable one at ` +
            'http://localhost:3000/agents, or call list_agents with enabled_only=false to see them.',
        );
      }

      return ok(
        renderAgents(shown, {
          total: agents.length,
          enabledOnly: enabled_only,
          detail,
          ambiguous: ambiguousSlugs(agents),
        }),
      );
    },
  );
}
