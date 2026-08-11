import { afterEach, describe, expect, it } from 'vitest';
import { RunIndex } from '../src/run-index.js';
import { callText, connect, type Harness } from './helpers/client.js';
import {
  fakeApi,
  fixtures,
  PR_ID,
  PR_NUMBER,
  REPO_FULL_NAME,
  SECURITY_RUN_ID,
} from './helpers/fake-api.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function seededIndex(): RunIndex {
  const index = new RunIndex();
  index.remember({
    runId: SECURITY_RUN_ID,
    prId: PR_ID,
    repo: REPO_FULL_NAME,
    prNumber: PR_NUMBER,
    agent: { id: fixtures.agents[0]!.id, name: fixtures.agents[0]!.name },
  });
  return index;
}

describe('get_findings argument validation', () => {
  // The XOR is checked in the handler rather than in the schema, because
  // `.refine()` or a discriminated union would emit `anyOf` and break the flat
  // schema rule the whole design rests on. These two tests are the price.
  it('fails with teaching text when given neither run_id nor repo/pr_number', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_findings');

    expect(isError).toBe(true);
    expect(text).toContain('needs either run_id, or repo plus pr_number');
  });

  it('fails when repo is given without pr_number', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      repo: REPO_FULL_NAME,
    });

    expect(isError).toBe(true);
    expect(text).toContain('repo without pr_number');
    expect(text).toContain('pass run_id instead');
  });

  it('fails when pr_number is given without repo', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      pr_number: PR_NUMBER,
    });

    expect(isError).toBe(true);
    expect(text).toContain('pr_number without repo');
  });
});

describe('get_findings by run_id', () => {
  it('answers from the in-process run index', async () => {
    harness = await connect({ api: fakeApi(), runIndex: seededIndex() });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      run_id: SECURITY_RUN_ID,
    });

    expect(isError).toBe(false);
    expect(text).toContain('acme/payments-api#482 reviewed by Security Reviewer: request_changes');
    expect(text).toContain('[CRITICAL] src/charges/idempotency.ts:27');
  });

  it('explains the limitation when the run is not in the index', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      run_id: SECURITY_RUN_ID,
    });

    expect(isError).toBe(true);
    expect(text).toContain('only remembers runs it started itself');
    expect(text).toContain('repo="owner/name"');
  });

  it('adds rationale and fix only at detail=full', async () => {
    harness = await connect({ api: fakeApi(), runIndex: seededIndex() });
    const concise = await callText(harness.client, 'get_findings', { run_id: SECURITY_RUN_ID });
    const full = await callText(harness.client, 'get_findings', {
      run_id: SECURITY_RUN_ID,
      detail: 'full',
    });

    expect(concise.text).not.toContain('why:');
    expect(full.text).toContain("why: A caller can pick another tenant's key");
    expect(full.text).toContain('fix: Namespace the key');
  });
});

describe('get_findings by repo + pr_number', () => {
  it('groups by agent, taking each agent’s LATEST review', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      repo: REPO_FULL_NAME,
      pr_number: PR_NUMBER,
    });

    expect(isError).toBe(false);
    expect(text).toContain('latest review from each of 2 agent(s)');
    expect(text).toContain('## Test Quality: comment');
    expect(text).toContain('## Security Reviewer: request_changes');
    // The Security Reviewer's older `approve` pass is superseded, not unioned.
    expect(text).not.toContain('Security Reviewer: approve');
  });

  it('filters by severity_min and says what was withheld', async () => {
    harness = await connect({ api: fakeApi() });
    const { text } = await callText(harness.client, 'get_findings', {
      repo: REPO_FULL_NAME,
      pr_number: PR_NUMBER,
      severity_min: 'CRITICAL',
    });

    expect(text).toContain('1 findings at severity_min=CRITICAL');
    expect(text).toContain('[CRITICAL] src/charges/idempotency.ts:27');
    expect(text).not.toContain('[SUGGESTION]');
  });

  it('reports truncation with counts drawn from the FULL set', async () => {
    harness = await connect({ api: fakeApi() });
    const { text } = await callText(harness.client, 'get_findings', {
      repo: REPO_FULL_NAME,
      pr_number: PR_NUMBER,
      limit: 1,
    });

    expect(text).toContain('Showing 1 of 2 findings (severity_min=SUGGESTION).');
    expect(text).toContain('Narrow with severity_min="WARNING"');
    expect(text).toContain('raise limit (max 50)');
  });

  it('is a result, not an error, when the PR has no reviews', async () => {
    harness = await connect({ api: fakeApi({ reviewsForPull: async () => [] }) });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      repo: REPO_FULL_NAME,
      pr_number: PR_NUMBER,
    });

    expect(isError).toBe(false);
    expect(text).toContain('has no reviews yet');
    expect(text).toContain('run_agent_on_pr');
  });

  it('prefixes the answer when a run is still in flight', async () => {
    harness = await connect({
      api: fakeApi({
        activeRuns: async () => [
          { run_id: 'in-flight', agent_id: null, agent_name: 'Security Reviewer', ran_at: null },
        ],
      }),
    });
    const { text } = await callText(harness.client, 'get_findings', {
      repo: REPO_FULL_NAME,
      pr_number: PR_NUMBER,
    });

    expect(text).toContain('still in flight');
  });

  it('names the imported repos when the repo is unknown', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_findings', {
      repo: 'nope/missing',
      pr_number: 1,
    });

    expect(isError).toBe(true);
    expect(text).toContain('acme/payments-api');
    expect(text).toContain('acme/web-console');
  });
});
