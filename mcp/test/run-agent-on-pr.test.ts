import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient, RunSummary } from '../src/api/index.js';
import { RunIndex } from '../src/run-index.js';
import { POLL_DELAYS_MS } from '../src/wait.js';
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

/**
 * A virtual clock. `sleep` advances it instead of waiting, so the whole 180s
 * poll schedule runs in microseconds and the assertions are exact. Fake timers
 * would have to fight the SDK's own async machinery; an injected clock does not
 * touch it.
 */
function virtualClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
  };
}

const DONE_RUN = fixtures.runs.find((r) => r.run_id === SECURITY_RUN_ID)!;
const RUNNING_RUN: RunSummary = { ...DONE_RUN, status: 'running', duration_ms: null };

function startingApi(over: Partial<ApiClient> = {}): ApiClient {
  return fakeApi({
    startReview: async () => ({
      pr_id: PR_ID,
      runs: [
        {
          run_id: SECURITY_RUN_ID,
          agent_id: fixtures.agents[0]!.id,
          agent_name: fixtures.agents[0]!.name,
        },
      ],
    }),
    ...over,
  });
}

const ARGS = { repo: REPO_FULL_NAME, pr_number: PR_NUMBER, agent: 'security' };

describe('run_agent_on_pr happy path', () => {
  it('waits, then renders the verdict and findings from the run row', async () => {
    const clock = virtualClock();
    let polls = 0;
    harness = await connect({
      api: startingApi({
        listRuns: async () => {
          polls += 1;
          return [polls < 3 ? RUNNING_RUN : DONE_RUN];
        },
      }),
      ...clock,
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);

    expect(isError).toBe(false);
    expect(polls).toBe(3);
    // The fast first probes catch a cheap run quickly.
    expect(clock.slept).toEqual([POLL_DELAYS_MS[0], POLL_DELAYS_MS[1], POLL_DELAYS_MS[2]]);
    expect(text).toContain(
      'acme/payments-api#482 reviewed by Security Reviewer: request_changes (score 42)',
    );
    // The header comes entirely from the run row the poll already fetched.
    expect(text).toContain('2 findings (1 critical, 0 warning, 1 suggestion) - 12.4s - $0.0031');
    expect(text).toContain('[CRITICAL] src/charges/idempotency.ts:27');
    // run_agent_on_pr always includes the body: five fields per finding.
    expect(text).toContain("why: A caller can pick another tenant's key");
    expect(text).toContain('fix: Namespace the key');
  });

  it('remembers the run so get_findings can answer by run_id afterwards', async () => {
    const runIndex = new RunIndex();
    harness = await connect({
      api: startingApi({ listRuns: async () => [DONE_RUN] }),
      runIndex,
      ...virtualClock(),
    });

    await callText(harness.client, 'run_agent_on_pr', ARGS);
    expect(runIndex.lookup(SECURITY_RUN_ID)).toMatchObject({
      prId: PR_ID,
      repo: REPO_FULL_NAME,
      prNumber: PR_NUMBER,
    });

    const { text, isError } = await callText(harness.client, 'get_findings', {
      run_id: SECURITY_RUN_ID,
    });
    expect(isError).toBe(false);
    expect(text).toContain('Security Reviewer: request_changes');
  });

  it('truncates loudly, with counts from the full set', async () => {
    harness = await connect({
      api: startingApi({ listRuns: async () => [DONE_RUN] }),
      ...virtualClock(),
    });
    const { text } = await callText(harness.client, 'run_agent_on_pr', { ...ARGS, limit: 1 });

    // The "(1 findings)" is counted over the FULL set, not the truncated one,
    // which is what makes the advice worth following.
    expect(text).toContain('Showing 1 of 2 findings (severity_min=SUGGESTION).');
    expect(text).toContain('Narrow with severity_min="WARNING" (1 findings) or raise limit (max 50).');
  });
});

describe('run_agent_on_pr wait outcomes', () => {
  it('returns status running on timeout, and that is NOT an error', async () => {
    const clock = virtualClock();
    harness = await connect({
      api: startingApi({ listRuns: async () => [RUNNING_RUN] }),
      ...clock,
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', {
      ...ARGS,
      wait_seconds: 10,
    });

    // The degradation contract the tool description promises. An isError here
    // would make the model retry, i.e. pay twice.
    expect(isError).toBe(false);
    expect(text).toContain('status: running');
    expect(text).toContain(`run_id: ${SECURITY_RUN_ID}`);
    expect(text).toContain('Nothing was cancelled');
    expect(text).toContain(`get_findings with run_id="${SECURITY_RUN_ID}"`);
    expect(text).toContain('Do NOT call run_agent_on_pr again');
    // The last sleep is trimmed so the loop never overshoots wait_seconds.
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('holds the 5s plateau and never overshoots a 180s budget', async () => {
    const clock = virtualClock();
    harness = await connect({
      api: startingApi({ listRuns: async () => [RUNNING_RUN] }),
      ...clock,
    });

    await callText(harness.client, 'run_agent_on_pr', { ...ARGS, wait_seconds: 180 });

    expect(clock.slept.slice(0, 6)).toEqual([...POLL_DELAYS_MS]);
    // Plateau at 5s, except the final sleep, which is trimmed to land exactly
    // on wait_seconds instead of overshooting it.
    const plateau = clock.slept.slice(6, -1);
    expect(new Set(plateau)).toEqual(new Set([5000]));
    expect(clock.slept.at(-1)).toBeLessThanOrEqual(5000);
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBe(180_000);
    // Worst case: 40 reads spread over three minutes, i.e. ~14/min against the
    // API's global 120/min limit. If a schedule change pushes this up, it is
    // the rate that matters, not the count.
    expect(clock.slept.length).toBe(40);
    expect(clock.slept.length / 3).toBeLessThan(120);
  });

  it('reports a failed run with the error verbatim and an API-key hint', async () => {
    const failed: RunSummary = {
      ...DONE_RUN,
      status: 'failed',
      error: '401 Unauthorized from openai: incorrect API key provided',
    };
    harness = await connect({
      api: startingApi({ listRuns: async () => [failed] }),
      ...virtualClock(),
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);

    expect(isError).toBe(true);
    expect(text).toContain('401 Unauthorized from openai: incorrect API key provided');
    expect(text).toContain('~/.devdigest/secrets.json');
  });

  it('reports a cancelled run', async () => {
    harness = await connect({
      api: startingApi({ listRuns: async () => [{ ...DONE_RUN, status: 'cancelled' as const }] }),
      ...virtualClock(),
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);
    expect(isError).toBe(true);
    expect(text).toContain('was cancelled before it finished');
  });

  it('reports a run row that vanished from the history', async () => {
    harness = await connect({
      api: startingApi({ listRuns: async () => [] }),
      ...virtualClock(),
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);
    expect(isError).toBe(true);
    expect(text).toContain('no longer in the run history');
  });
});

describe('run_agent_on_pr resolution failures', () => {
  it('names the imported repos when the repo is unknown', async () => {
    harness = await connect({ api: startingApi(), ...virtualClock() });
    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', {
      ...ARGS,
      repo: 'nope/missing',
    });

    expect(isError).toBe(true);
    expect(text).toContain('acme/payments-api, acme/web-console');
  });

  it('explains that an un-imported PR has no GitHub fallback', async () => {
    harness = await connect({
      api: startingApi({ pullByNumber: async () => ({ ...fixtures.pull, id: null }) }),
      ...virtualClock(),
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);
    expect(isError).toBe(true);
    expect(text).toContain('has not been imported into DevDigest');
    expect(text).toContain('no fallback that fetches a PR from GitHub by number');
  });

  it('lists the valid agents when the agent is unknown', async () => {
    harness = await connect({ api: startingApi(), ...virtualClock() });
    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', {
      ...ARGS,
      agent: 'nonsense',
    });

    expect(isError).toBe(true);
    expect(text).toContain('security, test-quality, api-contract');
    expect(text).toContain('Call list_agents');
  });

  it('refuses an ambiguous slug rather than guessing which agent to bill', async () => {
    const collide = [
      { ...fixtures.agents[0]!, id: 'id-a', name: 'Security Reviewer' },
      { ...fixtures.agents[0]!, id: 'id-b', name: 'Security Agent' },
    ];
    harness = await connect({
      api: startingApi({ listAgents: async () => collide }),
      ...virtualClock(),
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);
    expect(isError).toBe(true);
    expect(text).toContain('matches 2 agents');
    expect(text).toContain('id=id-a');
    expect(text).toContain('call it again with the id'.replace('call', 'Call'));
  });

  it('accepts a raw uuid as the agent', async () => {
    harness = await connect({
      api: startingApi({ listRuns: async () => [DONE_RUN] }),
      ...virtualClock(),
    });

    const { isError } = await callText(harness.client, 'run_agent_on_pr', {
      ...ARGS,
      agent: fixtures.agents[0]!.id,
    });
    expect(isError).toBe(false);
  });

  it('explains an accepted request that started no run', async () => {
    harness = await connect({
      api: startingApi({ startReview: async () => ({ pr_id: PR_ID, runs: [] }) }),
      ...virtualClock(),
    });

    const { text, isError } = await callText(harness.client, 'run_agent_on_pr', ARGS);
    expect(isError).toBe(true);
    expect(text).toContain('started no run');
    expect(text).toContain('agent is disabled');
  });
});
