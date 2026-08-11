import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer, type ServerDeps } from '../../src/server.js';

/**
 * Every test drives the server through a REAL `Client` over a linked in-memory
 * transport pair, so what it asserts is the wire result - including the
 * `isError` payloads the SDK itself generates for invalid arguments, which a
 * direct handler call would never produce.
 */
export interface Harness {
  client: Client;
  close(): Promise<void>;
}

export async function connect(deps: ServerDeps): Promise<Harness> {
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-harness', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface ToolText {
  text: string;
  isError: boolean;
}

/** Flatten a `tools/call` result to the text a model would actually read. */
export async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolText> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = (res.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  return { text, isError: res.isError === true };
}
