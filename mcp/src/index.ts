import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApiClient } from './api/index.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

/**
 * Entry point. The ONLY place a real HTTP client is constructed - everything
 * else takes an `ApiClient` as an argument (see src/server.ts).
 *
 * There is deliberately NO health probe here. A stdio server has to answer
 * `initialize` immediately, and the API is perfectly entitled to still be
 * booting; whether it is reachable is discovered lazily, on the first tool
 * call, where the answer can be rendered as a message the model can act on.
 *
 * stdout belongs to JSON-RPC. Every line this process prints goes to stderr.
 */
const config = loadConfig();
const api = createApiClient(config);

serveStdio(() => createServer({ api, defaultWaitSeconds: config.defaultWaitSeconds }), {
  onerror: (err) => console.error(`devdigest-mcp: transport error - ${err.message}`),
});

console.error(`devdigest-mcp: serving stdio, API at ${config.apiUrl}`);
