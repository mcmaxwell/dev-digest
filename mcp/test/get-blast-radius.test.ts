import { afterEach, describe, expect, it } from 'vitest';
import { callText, connect, type Harness } from './helpers/client.js';
import { fakeApi, PR_NUMBER, REPO_FULL_NAME } from './helpers/fake-api.js';

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * The deliberate stub. It stays in `tools/list` with both schemas because the
 * SCHEMA is the exercise contract - a missing tool would make the gap
 * invisible, and an undocumented one would make it unbuildable.
 *
 * Replace this file with a real fixture-driven test as step 5 of the exercise.
 */
describe('get_blast_radius (L04 exercise stub)', () => {
  it('returns an error that tells the reader exactly what to build', async () => {
    harness = await connect({ api: fakeApi() });
    const { text, isError } = await callText(harness.client, 'get_blast_radius', {
      repo: REPO_FULL_NAME,
      pr_number: PR_NUMBER,
    });

    expect(isError).toBe(true);
    // The three places the work lands, named so the reader does not have to
    // search for them.
    expect(text).toContain('server/src/modules/repo-intel/routes.ts');
    expect(text).toContain('server/src/modules/repo-intel/service.ts:220');
    expect(text).toContain('RepoIntelService.blastRadiusForPull');
    // The route stays transport-only; the work goes in a service method. This
    // is the onion-architecture correction, and losing it would push a
    // cross-module read into routes.ts.
    expect(text).toContain('transport only');
    expect(text).toContain('no-cross-module-imports');
    // The trap: the repo ALREADY has a differently-shaped `BlastRadius`.
    expect(text).toContain('contracts/brief.ts:39');
    expect(text).toContain('server/src/vendor/shared and client/src/vendor/shared');
  });

  it('advertises the output schema the finished tool has to produce', async () => {
    harness = await connect({ api: fakeApi() });
    const listed = await harness.client.listTools();
    const tool = listed.tools.find((t) => t.name === 'get_blast_radius');
    const output = tool?.outputSchema as { properties?: Record<string, unknown> } | undefined;

    expect(Object.keys(output?.properties ?? {})).toEqual([
      'changed_symbols',
      'callers',
      'impacted_endpoints',
      'degraded',
    ]);
  });
});
