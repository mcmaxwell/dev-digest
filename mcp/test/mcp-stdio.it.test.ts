import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * OPT-IN integration lane: `pnpm test:it`. Not in CI.
 *
 * This is the one thing the hermetic lane cannot cover - stdio has no
 * in-process shortcut, so the only way to prove `bin/devdigest-mcp` really
 * speaks the protocol (and that nothing writes a banner to stdout ahead of the
 * handshake) is to spawn the real process.
 *
 * Two of the three cases need a live, seeded stack (`./scripts/dev.sh`). The
 * third is the most valuable and needs nothing: pointed at a dead port, a read
 * tool must come back with the ./scripts/dev.sh instruction instead of hanging
 * or throwing a protocol error.
 *
 * `run_agent_on_pr` end to end is DELIBERATELY not automated: it spends real
 * money and needs a provider key. It is a documented manual check, on the same
 * reasoning that keeps `e2e/` free of LLM calls.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = resolve(HERE, '..', 'bin', 'devdigest-mcp');
const API_URL = process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001';

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function spawnServer(apiUrl: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: LAUNCHER,
    args: [],
    env: { ...process.env, DEVDIGEST_API_URL: apiUrl } as Record<string, string>,
    stderr: 'pipe',
  });
  const c = new Client({ name: 'mcp-stdio-it', version: '1' });
  await c.connect(transport);
  return c;
}

function textOf(result: unknown): string {
  const res = result as { content?: { type: string; text?: string }[] };
  return (res.content ?? []).map((c) => c.text ?? '').join('\n');
}

/** A successful result OMITS `isError` rather than setting it to false. */
function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe('devdigest-mcp over real stdio', () => {
  it('completes the handshake and advertises five tools', async () => {
    client = await spawnServer(API_URL);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual([
      'get_blast_radius',
      'get_conventions',
      'get_findings',
      'list_agents',
      'run_agent_on_pr',
    ]);
  });

  it('tells the caller to start the stack when the API is dead', async () => {
    // Port 9 (discard) is closed everywhere, so this case needs no stack at all.
    client = await spawnServer('http://localhost:9');
    const res = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(isError(res)).toBe(true);
    expect(textOf(res)).toContain('./scripts/dev.sh');
  });

  it('reads the live workspace (needs ./scripts/dev.sh and a seeded DB)', async () => {
    client = await spawnServer(API_URL);
    const agents = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(isError(agents)).toBe(false);
    expect(textOf(agents)).toMatch(/reviewer agents|no reviewer agents/);

    const conventions = await client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });
    // Either real conventions or the "run the extractor" instruction - both are
    // successes; only an unreachable API is a failure here.
    expect(textOf(conventions)).not.toContain('Cannot reach the DevDigest API');
  });
});
