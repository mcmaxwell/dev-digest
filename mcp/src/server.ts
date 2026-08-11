import { McpServer } from '@modelcontextprotocol/server';
import { createResolvers, type ApiClient } from './api/index.js';
import { RunIndex } from './run-index.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import type { ToolDeps } from './tools/shared.js';

export const SERVER_NAME = 'devdigest';
export const SERVER_VERSION = '0.1.0';

/** Default for `run_agent_on_pr`'s `wait_seconds`, mirrored from src/config.ts
 *  so a test can build a server without touching the environment. */
export const DEFAULT_WAIT_SECONDS = 180;

export interface ServerDeps {
  /**
   * THE design decision that makes the hermetic test lane possible: the HTTP
   * client is an argument. Only src/index.ts builds a real one; every handler
   * test hands over a plain object. Nothing is mocked by module path.
   */
  api: ApiClient;
  /** Defaults to a fresh in-process index; a test passes its own to pre-seed it. */
  runIndex?: RunIndex;
  defaultWaitSeconds?: number;
  /** Test seams for the poll schedule in run_agent_on_pr. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const toolDeps: ToolDeps = {
    api: deps.api,
    resolvers: createResolvers(deps.api),
    runIndex: deps.runIndex ?? new RunIndex(),
    defaultWaitSeconds: deps.defaultWaitSeconds ?? DEFAULT_WAIT_SECONDS,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  };

  // Registration order is the order a host lists them in, and the order the
  // model reads them in: the cheap orientation tool first, the paid one second,
  // the free reads after it, the unimplemented one last.
  registerListAgents(server, toolDeps);
  registerRunAgentOnPr(server, toolDeps);
  registerGetFindings(server, toolDeps);
  registerGetConventions(server, toolDeps);
  registerGetBlastRadius(server, toolDeps);

  return server;
}
