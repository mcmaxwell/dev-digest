import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Finding, LLMProvider, Review, StructuredRequest } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available - skipping integration tests.');
}

function finding(file: string, start: number, end = start): Finding {
  return {
    id: `f-${file}-${start}`,
    severity: 'CRITICAL',
    category: 'security',
    title: `issue in ${file}`,
    file,
    start_line: start,
    end_line: end,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
  } as Finding;
}

/**
 * An LLM stand-in that answers per CASE.
 *
 * `MockLLMProvider` returns one fixture for every call, which cannot express
 * "found this one, missed that one" - and a harness test whose agent behaves
 * identically on all twelve cases proves nothing. This one reads the diff out
 * of the assembled prompt and replies from a script, so a run can be authored
 * to hit, miss, or invent whatever the assertion needs.
 */
class ScriptedLlm implements LLMProvider {
  readonly id = 'openrouter' as const;
  public calls: StructuredRequest<unknown>[] = [];

  constructor(private script: (promptText: string) => Finding[]) {}

  async listModels() {
    return [];
  }
  async complete() {
    return { text: '', model: 'm', tokensIn: 0, tokensOut: 0, costUsd: 0, raw: '' } as never;
  }
  async embed() {
    return [[0]];
  }

  async completeStructured<T>(req: StructuredRequest<T>) {
    this.calls.push(req as StructuredRequest<unknown>);
    const text = req.messages.map((m) => m.content).join('\n');
    const findings = this.script(text);
    const review: Review = {
      verdict: findings.length > 0 ? 'request_changes' : 'approve',
      summary: 'scripted',
      score: findings.length > 0 ? 20 : 95,
      findings,
    };
    return {
      data: review as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
}

d('eval pipeline', () => {
  let pg: PgFixture;
  let agentId: string;
  let SECURITY_PROMPT: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'Security Reviewer'));
    agentId = agent!.id;
    SECURITY_PROMPT = agent!.systemPrompt;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * One test edits the seeded agent's system prompt (that is the point of it).
   * Restored HERE rather than at the end of that test, so a failure mid-way
   * cannot leave the fixture edited for every test that follows - the file is
   * one container and one accumulated fixture.
   */
  beforeEach(async () => {
    await pg.handle.db
      .update(t.agents)
      .set({ systemPrompt: SECURITY_PROMPT })
      .where(eq(t.agents.id, agentId));
  });

  /**
   * `secrets: new MockSecretsProvider({})` is not optional decoration: without
   * it the container falls back to `~/.devdigest/secrets.json` and any provider
   * this test forgot to override makes real, billable calls.
   */
  function makeApp(llm: LLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider({}),
        llm: { openrouter: llm },
      },
    });
  }

  /** An agent that finds exactly the seeded `must_find` locations and nothing else. */
  const perfectScript = (text: string): Finding[] => {
    if (text.includes('src/config.ts')) return [finding('src/config.ts', 12)];
    if (text.includes('src/db/users.ts')) return [finding('src/db/users.ts', 21, 22)];
    if (text.includes('src/auth/token.ts')) return [finding('src/auth/token.ts', 15, 16)];
    if (text.includes('src/api/webhooks.ts')) return [finding('src/api/webhooks.ts', 31, 33)];
    if (text.includes('src/auth/apikey.ts')) return [finding('src/auth/apikey.ts', 12)];
    if (text.includes('src/routes/login.ts')) return [finding('src/routes/login.ts', 43, 44)];
    if (text.includes('src/routes/index.ts')) return [finding('src/routes/index.ts', 20)];
    if (text.includes('src/middleware/logging.ts')) return [finding('src/middleware/logging.ts', 8)];
    return []; // the noise and clean cases: say nothing
  };

  it('ships a seeded gold set of at least 8 cases', async () => {
    const app = await makeApp(new ScriptedLlm(() => []));
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
    expect(res.statusCode).toBe(200);
    const cases = res.json() as { name: string; expectations: unknown[] }[];
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.some((c) => c.name === 'stripe-key-leak')).toBe(true);
  });

  it('scores a perfect agent at 1.0 and calls the model once per case, never for scoring', async () => {
    const llm = new ScriptedLlm(perfectScript);
    const app = await makeApp(llm);

    const casesRes = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
    const caseCount = (casesRes.json() as unknown[]).length;

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const run = res.json();

    expect(run.recall).toBe(1);
    expect(run.precision).toBe(1);
    expect(run.citation_accuracy).toBe(1);
    expect(run.traces_passed).toBe(caseCount);
    expect(run.agent_version).toBe(1);

    // THE claim of this feature: every model call is a review of one case, and
    // scoring adds none. Each seeded case is a single-file diff, so a
    // single-pass agent is exactly one call per case.
    expect(llm.calls).toHaveLength(caseCount);
    expect(llm.calls.every((c) => c.schemaName === 'Review')).toBe(true);
  });

  it('sends no temperature of its own, so an unchanged prompt is as repeatable as the provider allows', async () => {
    const llm = new ScriptedLlm(perfectScript);
    const app = await makeApp(llm);
    await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    expect(llm.calls.length).toBeGreaterThan(0);
    expect(llm.calls.every((c) => c.temperature === undefined)).toBe(true);
  });

  it('drops recall when the agent misses a must_find, and fails only that case', async () => {
    const llm = new ScriptedLlm((text) =>
      text.includes('src/config.ts') ? [] : perfectScript(text),
    );
    const app = await makeApp(llm);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    const run = res.json();
    expect(run.recall).toBeLessThan(1);
    expect(run.traces_passed).toBe(run.traces_total - 1);

    const detail = await app.inject({ method: 'GET', url: `/eval-runs/${run.id}` });
    const cases = detail.json().cases as { case_name: string; pass: boolean }[];
    expect(cases.find((c) => c.case_name === 'stripe-key-leak')?.pass).toBe(false);
  });

  it('drops precision when the agent flags a must_not_flag location', async () => {
    // This is the dismissed-finding half of the dataset earning its keep: the
    // agent finds everything it should AND repeats something a reviewer rejected.
    const llm = new ScriptedLlm((text) =>
      text.includes('src/reporting/summary.ts')
        ? [finding('src/reporting/summary.ts', 2)]
        : perfectScript(text),
    );
    const app = await makeApp(llm);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    const run = res.json();
    expect(run.recall).toBe(1);
    expect(run.precision).toBeLessThan(1);

    const detail = await app.inject({ method: 'GET', url: `/eval-runs/${run.id}` });
    const cases = detail.json().cases as { case_name: string; pass: boolean }[];
    expect(cases.find((c) => c.case_name === 'unused-import-added')?.pass).toBe(false);
  });

  it('counts an unrelated finding as a false positive without failing the case', async () => {
    const llm = new ScriptedLlm((text) =>
      text.includes('src/util/money.ts') ? [finding('src/util/money.ts', 5)] : perfectScript(text),
    );
    const app = await makeApp(llm);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    const run = res.json();
    expect(run.precision).toBeLessThan(1);
    // The clean case forbids nothing, so noise costs precision, not the verdict.
    expect(run.traces_passed).toBe(run.traces_total);
  });

  it('reports citation accuracy below 1 when the model cites a line outside the diff', async () => {
    const llm = new ScriptedLlm((text) =>
      text.includes('src/config.ts')
        ? [finding('src/config.ts', 12), finding('src/config.ts', 900)]
        : perfectScript(text),
    );
    const app = await makeApp(llm);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    const run = res.json();
    expect(run.citation_accuracy).toBeLessThan(1);
    // The hallucinated citation never reaches precision - it was dropped first.
    expect(run.recall).toBe(1);
  });

  it('pairs two runs case by case and names what regressed', async () => {
    const good = await makeApp(new ScriptedLlm(perfectScript));
    const before = (
      await good.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} })
    ).json();

    const worse = await makeApp(
      new ScriptedLlm((text) => (text.includes('src/auth/apikey.ts') ? [] : perfectScript(text))),
    );
    const after = (
      await worse.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} })
    ).json();

    const res = await good.inject({
      method: 'GET',
      url: `/eval-runs/compare?left=${before.id}&right=${after.id}`,
    });
    expect(res.statusCode).toBe(200);
    const cmp = res.json();

    expect(cmp.delta.recall).toBeLessThan(0);
    const lost = cmp.case_deltas.filter((c: { change: string }) => c.change === 'lost');
    expect(lost).toHaveLength(1);
    expect(lost[0].case_name).toBe('timing-unsafe-token-compare');
    // Everything else held: this is what separates a real regression from noise.
    expect(
      cmp.case_deltas.filter((c: { change: string }) => c.change === 'unchanged').length,
    ).toBe(cmp.case_deltas.length - 1);
    // The prompts come from the version snapshots, so the diff shown is what ran.
    expect(typeof cmp.left_prompt).toBe('string');
    expect(cmp.right_prompt).toBe(cmp.left_prompt);
  });

  it('moves recall and precision when the SYSTEM PROMPT changes between two runs', async () => {
    // The acceptance criterion of the whole lesson, made falsifiable without a
    // provider: the scripted agent reads the system prompt out of the assembled
    // messages and behaves the way that prompt tells it to. So the only thing
    // that differs between these two runs is the prompt text - exactly the
    // experiment the harness exists to support.
    const promptAware = (text: string): Finding[] => {
      const base = perfectScript(text);
      // A prompt broadened to chase lint noise starts flagging the unused
      // import a reviewer already dismissed, and stops at the subtle timing bug.
      if (text.includes('Flag unused imports as suggestions.')) {
        if (text.includes('src/reporting/summary.ts'))
          return [finding('src/reporting/summary.ts', 2)];
        if (text.includes('src/auth/apikey.ts')) return [];
      }
      return base;
    };

    const app = await makeApp(new ScriptedLlm(promptAware));

    const before = (
      await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} })
    ).json();

    // Edit the prompt exactly as a user would - through the agent editor, which
    // bumps the config version and snapshots it.
    const edited = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: `${SECURITY_PROMPT}\nFlag unused imports as suggestions.` },
    });
    expect(edited.statusCode).toBe(200);

    const after = (
      await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} })
    ).json();

    // The version moved, so the two runs are attributable to two prompts.
    expect(after.agent_version).toBe(before.agent_version + 1);
    // Precision falls: it now reports something a reviewer had dismissed.
    expect(after.precision).toBeLessThan(before.precision);
    // Recall falls: it traded a real defect for the noise.
    expect(after.recall).toBeLessThan(before.recall);
    expect(after.traces_passed).toBeLessThan(before.traces_passed);

    // And the comparison names WHICH cases moved, which is the readable half.
    const cmp = (
      await app.inject({
        method: 'GET',
        url: `/eval-runs/compare?left=${before.id}&right=${after.id}`,
      })
    ).json();
    const lost = cmp.case_deltas
      .filter((c: { change: string }) => c.change === 'lost')
      .map((c: { case_name: string }) => c.case_name)
      .sort();
    expect(lost).toEqual(['timing-unsafe-token-compare', 'unused-import-added']);
    // The two prompts differ, and the compare view can show that.
    expect(cmp.right_prompt).toContain('Flag unused imports as suggestions.');
    expect(cmp.left_prompt).not.toContain('Flag unused imports as suggestions.');
  });

  it('mints a case from a decision, in both expectation kinds', async () => {
    const app = await makeApp(new ScriptedLlm(() => []));
    for (const kind of ['must_find', 'must_not_flag'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-cases`,
        payload: {
          name: `minted-${kind}`,
          input_diff:
            'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n',
          expected_output: {
            expectations: [{ kind, file: 'src/x.ts', start_line: 2, end_line: 2 }],
          },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().expectations[0].kind).toBe(kind);
    }
  });

  it('refuses a case whose diff would score zero no matter what the agent does', async () => {
    const app = await makeApp(new ScriptedLlm(() => []));
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: { name: 'not-a-diff', input_diff: 'just some prose', expected_output: {} },
    });
    expect(res.statusCode).toBe(422);
  });

  it('refuses a case whose diff is too large to replay on every run', async () => {
    const app = await makeApp(new ScriptedLlm(() => []));
    const huge =
      'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,2 @@\n' +
      '+'.padEnd(400_001, 'x') +
      '\n';
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: { name: 'too-big', input_diff: huge, expected_output: {} },
    });
    expect(res.statusCode).toBe(422);
  });

  it('refuses to record a run for an agent with no cases', async () => {
    const app = await makeApp(new ScriptedLlm(() => []));
    const [empty] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.name, 'General Reviewer')));
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${empty!.id}/eval-runs`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists an agent on the dashboard with its case count and latest run', async () => {
    const app = await makeApp(new ScriptedLlm(perfectScript));
    await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    const res = await app.inject({ method: 'GET', url: '/eval/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.agents.find((a: { agent_id: string }) => a.agent_id === agentId);
    expect(row.cases_total).toBeGreaterThanOrEqual(8);
    expect(row.last_run.traces_total).toBeGreaterThanOrEqual(8);
    expect(body.recent_runs[0].agent_name).toBe('Security Reviewer');
  });
});
