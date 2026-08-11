import { afterEach, describe, expect, it } from 'vitest';
import { callText, connect, type Harness } from './helpers/client.js';
import { fakeApi, fixtures, RAW_FIXTURES } from './helpers/fake-api.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('list_agents', () => {
  it('returns slug AND uuid for every enabled agent', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'list_agents');

    expect(isError).toBe(false);
    // The slug is the semantic handle a model can reason about; the uuid is
    // what run_agent_on_pr actually needs and cannot be guessed from a name.
    expect(text).toContain('security | Security Reviewer');
    expect(text).toContain('id=6f1c2b3a-0000-4a1e-9f2b-1a2b3c4d5e01');
    expect(text).toContain('test-quality | Test Quality');
    // "API Contract Agent" is disabled, and enabled_only defaults to true.
    expect(text).not.toContain('api-contract');
    expect(text).toContain('2 of 3 reviewer agents');
  });

  it('shows disabled agents when asked, marked as such', async () => {
    harness = await connect({ api: fakeApi() });
    const { text } = await callText(harness.client, 'list_agents', { enabled_only: false });

    expect(text).toContain('api-contract | API Contract Agent');
    expect(text).toContain('disabled');
  });

  it('adds the description only at detail=full', async () => {
    harness = await connect({ api: fakeApi() });
    const concise = await callText(harness.client, 'list_agents');
    const full = await callText(harness.client, 'list_agents', { detail: 'full' });

    expect(concise.text).not.toContain('Auth, secrets, injection');
    expect(full.text).toContain('Auth, secrets, injection');
  });

  it('NEVER emits system_prompt or output_schema', async () => {
    // The canary is in the fixture, so this exercises the real path: the fake
    // parses through src/api/schemas.ts exactly as the live client does, and
    // `Agent` there has no such key. If someone widens that schema, this fails.
    expect(JSON.stringify(RAW_FIXTURES.agents)).toContain('LEAK-CANARY-SYSTEM-PROMPT');

    harness = await connect({ api: fakeApi() });
    for (const args of [{}, { enabled_only: false }, { detail: 'full' }]) {
      const { text } = await callText(harness.client, 'list_agents', args);
      expect(text).not.toContain('LEAK-CANARY-SYSTEM-PROMPT');
      expect(text).not.toContain('output_schema');
      expect(text).not.toContain('system_prompt');
    }
    // The parsed fixture itself must already be clean.
    expect(JSON.stringify(fixtures.agents)).not.toContain('LEAK-CANARY');
  });

  it('flags an ambiguous slug instead of letting a tool guess', async () => {
    const collide = [
      { ...fixtures.agents[0]!, id: 'id-a', name: 'Security Reviewer' },
      { ...fixtures.agents[0]!, id: 'id-b', name: 'Security Agent' },
    ];
    harness = await connect({ api: fakeApi({ listAgents: async () => collide }) });
    const { text } = await callText(harness.client, 'list_agents');

    expect(text).toContain('AMBIGUOUS SLUG - use the id');
    expect(text).toContain('id=id-a');
    expect(text).toContain('id=id-b');
  });

  it('treats zero agents as a result, not an error', async () => {
    harness = await connect({ api: fakeApi({ listAgents: async () => [] }) });
    const { text, isError } = await callText(harness.client, 'list_agents');

    expect(isError).toBe(false);
    expect(text).toContain('no reviewer agents yet');
    expect(text).toContain('http://localhost:3000/agents');
  });

  it('treats all-disabled as a result, and says how to see them', async () => {
    const disabled = fixtures.agents.map((a) => ({ ...a, enabled: false }));
    harness = await connect({ api: fakeApi({ listAgents: async () => disabled }) });
    const { text, isError } = await callText(harness.client, 'list_agents');

    expect(isError).toBe(false);
    expect(text).toContain('are disabled');
    expect(text).toContain('enabled_only=false');
  });

  it('lets the SDK reject an invalid enum before the handler runs', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'list_agents', { detail: 'nope' });

    expect(isError).toBe(true);
    expect(text).toContain('Invalid');
  });
});
