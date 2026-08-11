import { afterEach, describe, expect, it } from 'vitest';
import { callText, connect, type Harness } from './helpers/client.js';
import { fakeApi, fixtures, REPO_FULL_NAME } from './helpers/fake-api.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('get_conventions', () => {
  it('returns accepted rules by default, strongest first', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
    });

    expect(isError).toBe(false);
    expect(text).toContain('acme/payments-api: 3 of 3 conventions (status=accepted');
    // accepted first, then adherence descending, then confidence.
    const order = ['error-handling', 'naming', 'imports'].map((c) => text.indexOf(`[${c}]`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).not.toContain('[testing]'); // pending
  });

  it('NEVER returns a rejected candidate, at any status', async () => {
    // A rejected candidate is a human saying "no". Handing it to a model would
    // make it apply a rule the team threw out.
    expect(JSON.stringify(fixtures.conventions)).toContain('REJECTED-CANARY');

    harness = await connect({ api: fakeApi() });
    for (const status of ['accepted', 'pending', 'all']) {
      const { text } = await callText(harness.client, 'get_conventions', {
        repo: REPO_FULL_NAME,
        status,
      });
      expect(text, `status=${status}`).not.toContain('REJECTED-CANARY');
    }
  });

  it('status=all means accepted plus pending', async () => {
    harness = await connect({ api: fakeApi() });
    const { text } = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
      status: 'all',
    });

    expect(text).toContain('4 of 4 conventions');
    expect(text).toContain('[testing]');
    expect(text).toContain('pending');
  });

  it('renders a measured rate as a percentage and an unprobed one as unmeasured', async () => {
    harness = await connect({ api: fakeApi() });
    const { text } = await callText(harness.client, 'get_conventions', { repo: REPO_FULL_NAME });

    expect(text).toContain('adherence 96%');
    // "the repo does this 96% of the time" and "a model believes it" must not
    // look the same.
    expect(text).toContain('adherence unmeasured');
  });

  it('adds a file:line pointer only when evidence is requested', async () => {
    harness = await connect({ api: fakeApi() });
    const without = await callText(harness.client, 'get_conventions', { repo: REPO_FULL_NAME });
    const with_ = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
      evidence: true,
    });

    expect(without.text).not.toContain('evidence:');
    expect(with_.text).toContain('evidence: src/routes/charges.ts:44');
  });

  it('filters by category and names the categories that do have rules', async () => {
    harness = await connect({ api: fakeApi() });
    const hit = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
      category: 'naming',
    });
    const miss = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
      category: 'async',
    });

    expect(hit.text).toContain('[naming]');
    expect(hit.text).not.toContain('[imports]');
    expect(miss.isError).toBe(false);
    expect(miss.text).toContain('No "async" conventions');
    expect(miss.text).toContain('error-handling, imports, naming');
  });

  it('treats a never-scanned repo as a result with an instruction', async () => {
    harness = await connect({
      api: fakeApi({ conventions: async () => ({ scan: null, candidates: [] }) }),
    });
    const { text, isError } = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
    });

    expect(isError).toBe(false);
    expect(text).toContain('never extracted conventions');
    expect(text).toContain('http://localhost:3000/conventions');
  });

  it('serves the previous rules with a prefix while a scan is running', async () => {
    harness = await connect({
      api: fakeApi({
        conventions: async () => ({
          ...fixtures.conventions,
          scan: { ...fixtures.conventions.scan!, status: 'running' as const },
        }),
      }),
    });
    const { text, isError } = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
    });

    expect(isError).toBe(false);
    expect(text).toContain('a conventions scan is running right now');
    expect(text).toContain('[error-handling]');
  });

  it('points at the pending queue when nothing is accepted yet', async () => {
    const pendingOnly = fixtures.conventions.candidates.map((c) => ({
      ...c,
      status: 'pending' as const,
    }));
    harness = await connect({
      api: fakeApi({
        conventions: async () => ({ ...fixtures.conventions, candidates: pendingOnly }),
      }),
    });
    const { text, isError } = await callText(harness.client, 'get_conventions', {
      repo: REPO_FULL_NAME,
    });

    expect(isError).toBe(false);
    expect(text).toContain('No conventions have been accepted');
    expect(text).toContain('waiting for review');
  });

  it('rejects an unknown repo and lists the imported ones', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_conventions', {
      repo: 'nope/missing',
    });

    expect(isError).toBe(true);
    expect(text).toContain('no repository "nope/missing"');
    expect(text).toContain('acme/payments-api, acme/web-console');
  });
});
