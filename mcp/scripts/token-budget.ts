import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { getEncoding } from 'js-tiktoken';
import { createServer } from '../src/server.js';
import type { ApiClient } from '../src/api/index.js';

/**
 * Measure the REAL `tools/list` payload, not an approximation of it.
 *
 * Tool definitions are loaded into the system prompt at the start of EVERY new
 * chat, before the user has typed anything - seven ordinary MCP servers eat
 * ~67k tokens that way. So this number is a hard gate, checked mechanically,
 * not a thing anyone eyeballs.
 *
 * `cl100k_base` is not Claude's tokenizer; on JSON-shaped ASCII it lands within
 * 5-10%, runs offline, and is already the repo's established choice
 * (server/src/adapters/tokenizer/index.ts). What is needed here is a stable
 * number that MOVES when the schema grows, not an exact one.
 *
 * Two artefacts on purpose: this script is the human report during development
 * (`pnpm budget`), and `test/tools-list.test.ts` imports the same counter so CI
 * enforces it.
 */

export const TOKEN_BUDGET = 2500;
/** Warning band: the design measures well under this, so crossing it means the
 *  descriptions grew and somebody should look before it becomes a failure. */
export const TOKEN_WARN_BAND = 2200;

const encoding = getEncoding('cl100k_base');

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

/** Nothing here is called: `tools/list` never enters a handler. */
const inertApi = new Proxy({} as ApiClient, {
  get() {
    return async () => {
      throw new Error('token-budget: no tool handler should run while listing tools');
    };
  },
});

export interface ToolCost {
  name: string;
  tokens: number;
  bytes: number;
}

export async function measureToolsList(): Promise<{ tools: ToolCost[]; total: number; payload: string }> {
  const server = createServer({ api: inertApi });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'token-budget', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  // Exactly what a host serialises into the system prompt.
  const payload = JSON.stringify(listed.tools);
  const tools = listed.tools.map((tool) => {
    const one = JSON.stringify(tool);
    return { name: tool.name, tokens: countTokens(one), bytes: one.length };
  });

  await client.close();
  await server.close();

  return { tools, total: countTokens(payload), payload };
}

async function main(): Promise<void> {
  const { tools, total } = await measureToolsList();
  const width = Math.max(...tools.map((t) => t.name.length), 5);

  console.log(`${'tool'.padEnd(width)}  tokens   bytes`);
  console.log('-'.repeat(width + 16));
  for (const t of [...tools].sort((a, b) => b.tokens - a.tokens)) {
    console.log(`${t.name.padEnd(width)}  ${String(t.tokens).padStart(6)}  ${String(t.bytes).padStart(6)}`);
  }
  console.log('-'.repeat(width + 16));
  console.log(`${'TOTAL'.padEnd(width)}  ${String(total).padStart(6)}`);
  console.log('');
  console.log(`budget ${TOKEN_BUDGET} - warn band ${TOKEN_WARN_BAND} - measured ${total}`);

  if (total > TOKEN_BUDGET) {
    console.error(
      `token budget exceeded: ${total} > ${TOKEN_BUDGET}. Shorten a tool or parameter ` +
        `description, or drop a parameter - do not raise the budget.`,
    );
    process.exit(1);
  }
  if (total > TOKEN_WARN_BAND) {
    console.error(`WARNING: ${total} tokens is inside the ${TOKEN_WARN_BAND} warn band.`);
  }
}

// Only run the report when invoked directly; `test/tools-list.test.ts` imports
// `countTokens` from here.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
