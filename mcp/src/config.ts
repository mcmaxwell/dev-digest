import * as z from 'zod';

/**
 * Everything this process reads from the environment. The list is short on
 * purpose: there is NO secret here. Reviews are triggered through the local
 * API, which owns the provider keys (`~/.devdigest/secrets.json`), so an MCP
 * host never has to be handed one.
 */
const Env = z.object({
  DEVDIGEST_API_URL: z.url().default('http://localhost:3001'),
  DEVDIGEST_MCP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  DEVDIGEST_MCP_WAIT_SECONDS: z.coerce.number().int().min(10).max(300).default(180),
});

export interface Config {
  /** Base URL of the DevDigest API, no trailing slash. */
  apiUrl: string;
  /** Per-request timeout for ordinary reads. */
  timeoutMs: number;
  /** Default for `run_agent_on_pr`'s `wait_seconds`. */
  defaultWaitSeconds: number;
}

/**
 * Parse once, at startup. A bad URL is fatal rather than deferred: a server
 * that answers `initialize` and then fails every single tool call is a worse
 * experience than one that refuses to start with a readable reason.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('; ');
    console.error(`devdigest-mcp: invalid environment - ${detail}`);
    process.exit(1);
  }
  return {
    apiUrl: parsed.data.DEVDIGEST_API_URL.replace(/\/+$/, ''),
    timeoutMs: parsed.data.DEVDIGEST_MCP_TIMEOUT_MS,
    defaultWaitSeconds: parsed.data.DEVDIGEST_MCP_WAIT_SECONDS,
  };
}
