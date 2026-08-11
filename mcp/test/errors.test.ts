import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  ApiShapeError,
  ApiTimeoutError,
  ApiUnreachableError,
} from '../src/api/index.js';
import { describeApiError } from '../src/format/errors.js';
import { callText, connect, type Harness } from './helpers/client.js';
import { fakeApi, REPO_FULL_NAME } from './helpers/fake-api.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * A table over every failure the model can be shown. The invariant is not the
 * wording - it is that EVERY message names a next action. An MCP error is not a
 * log line; it is the only thing the model has to decide what to do next.
 */
const CASES: { name: string; err: unknown; contains: string[] }[] = [
  {
    name: 'API not running',
    err: new ApiUnreachableError('http://localhost:3001'),
    contains: [
      'Cannot reach the DevDigest API at http://localhost:3001',
      './scripts/dev.sh',
      'then retry',
    ],
  },
  {
    name: 'API too slow',
    // Distinct from unreachable on purpose: "still booting" and "not running"
    // need different actions.
    err: new ApiTimeoutError('http://localhost:3001', 15000, '/repos'),
    contains: ['did not answer /repos within 15000ms', 'wait a few seconds and retry'],
  },
  {
    name: 'rate limited',
    // @fastify/rate-limit's 429 is NOT an AppError, so it arrives with
    // code "internal_error". Matching on the code would call a rate limit a
    // server crash; this branch keys on the STATUS.
    err: new ApiError(429, 'internal_error', 'Rate limit exceeded'),
    contains: ['rate limiting this client (HTTP 429)', '10 per minute', 'Wait about a minute'],
  },
  {
    name: 'not found',
    err: new ApiError(404, 'not_found', 'Pull request not found'),
    contains: ['Pull request not found', 'call list_agents', '"owner/name"'],
  },
  {
    name: 'validation error',
    err: new ApiError(422, 'validation_error', 'body/agentId must be a string'),
    contains: ['body/agentId must be a string', 'Fix the arguments and call the tool again'],
  },
  {
    name: 'invalid run request',
    err: new ApiError(400, 'invalid_run_request', 'agent is disabled'),
    contains: ['agent is disabled', 'Call list_agents'],
  },
  {
    name: 'scan in progress',
    err: new ApiError(409, 'scan_in_progress', 'a scan started 20s ago'),
    contains: ['a scan started 20s ago', 'call get_conventions again'],
  },
  {
    name: 'github unavailable',
    err: new ApiError(502, 'github_unavailable', 'bad credentials'),
    contains: ['bad credentials', '~/.devdigest/secrets.json', 'retry'],
  },
  {
    name: 'repo not cloned',
    err: new ApiError(409, 'repo_not_cloned', 'no clone on disk'),
    contains: ['no clone on disk', 'POST /repos/:id/refresh', 'then retry'],
  },
  {
    name: 'unmapped 4xx API error',
    err: new ApiError(409, 'some_new_code', 'the branch moved under you'),
    contains: ['HTTP 409 (some_new_code): the branch moved under you', './scripts/dev.sh'],
  },
  {
    name: 'unmapped 5xx API error',
    err: new ApiError(500, 'internal_error', 'boom'),
    contains: ['HTTP 500', './scripts/dev.sh'],
  },
  {
    name: 'unreadable response shape',
    err: new ApiShapeError('/agents', '0.model: expected string'),
    contains: ['/agents', 'out of sync', 'restart both'],
  },
  {
    name: 'anything else',
    err: new Error('ENOSPC'),
    contains: ['ENOSPC', './scripts/dev.sh is still running'],
  },
];

describe('describeApiError', () => {
  it.each(CASES)('maps $name to a message with a next action', ({ err, contains }) => {
    const message = describeApiError(err);
    for (const fragment of contains) expect(message).toContain(fragment);
  });

  it('never returns an empty or one-word message', () => {
    for (const { err } of CASES) {
      expect(describeApiError(err).split(' ').length).toBeGreaterThan(5);
    }
  });
});

describe('a dead API through the real tool surface', () => {
  const dead = () => {
    throw new ApiUnreachableError('http://localhost:3001');
  };

  it.each([
    ['list_agents', {}],
    ['get_conventions', { repo: REPO_FULL_NAME }],
    ['get_findings', { repo: REPO_FULL_NAME, pr_number: 482 }],
  ] as const)('%s returns isError with the dev.sh instruction', async (tool, args) => {
    harness = await connect({
      api: fakeApi({
        listAgents: async () => dead(),
        listRepos: async () => dead(),
        conventions: async () => dead(),
        reviewsForPull: async () => dead(),
        pullByNumber: async () => dead(),
      }),
    });

    const { text, isError } = await callText(harness.client, tool, args);
    // Nothing hangs, and nothing surfaces as a JSON-RPC protocol error: the
    // model sees a message it can act on.
    expect(isError).toBe(true);
    expect(text).toContain('./scripts/dev.sh');
  });
});

/**
 * A 5xx body is not safe to relay: outside production the API's error handler
 * sends the raw `e.message` for any non-AppError, which its own comment says
 * can be a DB error, a filesystem path or adapter output. Relaying that hands
 * the machine's paths to the model, and they leave with the next completion.
 */
describe('5xx bodies are not relayed', () => {
  it('drops the server message but keeps the status and the next action', () => {
    const leak = '/Users/someone/projects/dev-digest/server/clones/acme/secret.ts ENOENT';
    const message = describeApiError(new ApiError(503, 'internal_error', leak));
    expect(message).not.toContain(leak);
    expect(message).not.toContain('/Users/');
    expect(message).toContain('HTTP 503');
    expect(message).toContain('./scripts/dev.sh');
  });

  it('still relays a 4xx message, which is the API telling the caller what to fix', () => {
    const message = describeApiError(new ApiError(400, 'invalid_run_request', 'pick an agent'));
    expect(message).toContain('pick an agent');
  });
});
