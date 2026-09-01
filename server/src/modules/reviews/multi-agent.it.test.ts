import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  Finding,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockEmbedder, MockGitClient, MockSecretsProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';

/**
 * L07 - the whole multi-agent path, against a real Postgres.
 *
 * The provider stand-in below is the point of this file: it counts CONCURRENT
 * `completeStructured` calls, which is how "at most three agents at a time"
 * (AC-17) becomes a real assertion. All N `agent_runs` rows are created up
 * front with the same `ran_at`, so their recorded start times cannot answer it
 * and no column was added to make them able to.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff touching two files, so a finding can be grounded on either. */
const DIFF = `diff --git a/src/middleware/ratelimit.ts b/src/middleware/ratelimit.ts
--- a/src/middleware/ratelimit.ts
+++ b/src/middleware/ratelimit.ts
@@ -26,3 +26,8 @@
   const window = 60;
+  const ttl = 3600;
+  res.status(429).end();
+  const burst = 10;
+  const key = ip;
+  const bucket = key;
   return next();
diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const INTENT_FIXTURE = {
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['rate limiting'],
  out_of_scope: [],
  risk_areas: [],
  confidence: 0.8,
};

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Magic number 3600',
    file: 'src/middleware/ratelimit.ts',
    start_line: 28,
    end_line: 30,
    rationale: 'A raw TTL constant.',
    confidence: 0.8,
    kind: 'finding',
    ...over,
  } as Finding;
}

/** What one agent's review call should answer, keyed by the agent's name. */
type Script = Record<string, Review | 'throw'>;

/**
 * An LLM stand-in shared by every provider key in one app.
 *
 * It reads the agent's system prompt out of the assembled messages to decide
 * which script entry to answer with, and it maintains ONE concurrency counter
 * across every provider, so the peak it records is the peak of the whole
 * fan-out rather than of one provider's share of it.
 */
class CountingLlm implements LLMProvider {
  readonly id = 'openrouter' as const;
  /** Highest number of `completeStructured` calls in flight at any moment. */
  public peak = 0;
  public inFlight = 0;
  /** Every structured call, in completion order, with its schema name. */
  public calls: { schemaName: string; text: string }[] = [];

  constructor(
    private script: Script,
    private shared: { peak: number; inFlight: number } = { peak: 0, inFlight: 0 },
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete() {
    return { text: '', model: 'm', tokensIn: 0, tokensOut: 0, costUsd: 0 } as never;
  }
  async embed() {
    return [[0]];
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const text = req.messages.map((m) => m.content).join('\n');
    this.calls.push({ schemaName: req.schemaName, text });

    if (req.schemaName === 'Intent') {
      return this.result(req, INTENT_FIXTURE as unknown as T, 0.001);
    }

    this.shared.inFlight += 1;
    this.shared.peak = Math.max(this.shared.peak, this.shared.inFlight);
    this.peak = this.shared.peak;
    try {
      // A real provider call is not instantaneous; without a yield every task
      // would resolve before the next one starts and the peak would read 1
      // against a correctly parallel implementation too.
      await new Promise((r) => setTimeout(r, 40));
      const which = Object.keys(this.script).find((name) => text.includes(`AGENT:${name}`));
      const answer = which ? this.script[which]! : { verdict: 'approve', summary: 'none', score: 100, findings: [] };
      if (answer === 'throw') throw new Error(`provider refused for ${which}`);
      return this.result(req, answer as unknown as T, 0.02);
    } finally {
      this.shared.inFlight -= 1;
    }
  }

  private result<T>(req: StructuredRequest<T>, data: T, costUsd: number): StructuredResult<T> {
    return {
      data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd,
      raw: JSON.stringify(data),
      attempts: 1,
    };
  }
}

function review(findings: Finding[], over: Partial<Review> = {}): Review {
  return {
    verdict: findings.length > 0 ? 'request_changes' : 'approve',
    summary: 'scripted summary',
    score: 60,
    findings,
    ...over,
  };
}

let repoSeq = 0;

d('L07 multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * A hermetic app. `secrets: new MockSecretsProvider({})` is not optional:
   * without it the container falls back to the DEVELOPER'S
   * ~/.devdigest/secrets.json and every provider this test does not mock makes
   * a real, billable call.
   */
  function appWith(llm: CountingLlm) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        secrets: new MockSecretsProvider({}),
        llm: { openai: llm, anthropic: llm, openrouter: llm },
      },
    });
  }

  async function setupRepoAndPr() {
    const name = `payments-api-ma-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: `sha-${repoSeq}`,
        additions: 6,
        deletions: 0,
        filesCount: 2,
        status: 'needs_review',
        body: 'Add rate limiting.',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  /** Create N agents whose system prompt names them, so the script can answer per agent. */
  async function createAgents(
    app: Awaited<ReturnType<typeof buildApp>>,
    names: string[],
  ): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    for (const name of names) {
      const res = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: `AGENT:${name} reviews this diff.`,
          repo_intel: false,
        },
      });
      out.push({ id: res.json().id, name });
    }
    return out;
  }

  /**
   * Wait for every member run's TRACE document, not for `agent_runs.status`.
   * The status flips inside the persistence transaction while `saveRunTrace`
   * runs just after it, so polling the status races with the trace read - and
   * the race is invisible when this file runs alone.
   */
  async function waitForTraces(runIds: string[], timeoutMs = 20_000) {
    const start = Date.now();
    for (;;) {
      const rows = await pg.handle.db.select().from(t.runTraces);
      const have = new Set(rows.map((r) => r.runId));
      if (runIds.every((id) => have.has(id))) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`traces never appeared for ${runIds.filter((id) => !have.has(id)).join(', ')}`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('runs five agents at most three at a time, over one diff and one intent', async () => {
    const shared = { peak: 0, inFlight: 0 };
    const llm = new CountingLlm(
      {
        Security: review([finding({ id: 'sec', severity: 'CRITICAL', file: 'src/config.ts', start_line: 11, end_line: 11, title: 'Hardcoded key' })]),
        Performance: review([finding({ id: 'perf' })]),
        Mentor: review([finding({ id: 'mentor', severity: 'SUGGESTION' })]),
        Customer: review([]),
        Architecture: review([]),
      },
      shared,
    );
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr();
    const agents = await createAgents(app, [
      'Security',
      'Performance',
      'Mentor',
      'Customer',
      'Architecture',
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: agents.map((a) => a.id) },
    });
    expect(res.statusCode).toBe(201);
    const started = res.json();
    // AC-16: exactly one agent run per selected agent, all of them `running`.
    expect(started.columns).toHaveLength(5);
    expect(started.columns.every((c: { status: string }) => c.status === 'running')).toBe(true);

    await waitForTraces(started.columns.map((c: { run_id: string }) => c.run_id));

    // AC-17: never more than three model calls in flight.
    expect(shared.peak).toBeGreaterThan(1);
    expect(shared.peak).toBeLessThanOrEqual(3);

    // AC-18 / AC-19: ONE diff load and ONE intent classification for the whole
    // fan-out, and five review calls - not five of each.
    const intentCalls = llm.calls.filter((c) => c.schemaName === 'Intent');
    const reviewCalls = llm.calls.filter((c) => c.schemaName === 'Review');
    expect(intentCalls).toHaveLength(1);
    expect(reviewCalls).toHaveLength(5);
    // Every agent got the SAME diff and the same derived intent.
    for (const call of reviewCalls) {
      expect(call.text).toContain('sk_live_xxx');
      expect(call.text).toContain('Adds rate limiting to the public API.');
    }

    // AC-20: no agent's output, name or score reaches another agent's prompt.
    const traces = await pg.handle.db.select().from(t.runTraces);
    const runIds = new Set<string>(started.columns.map((c: { run_id: string }) => c.run_id));
    for (const row of traces.filter((r) => runIds.has(r.runId))) {
      const trace = row.trace as { config: { agent: string }; prompt_assembly: Record<string, unknown> };
      const assembly = JSON.stringify(trace.prompt_assembly);
      for (const other of agents.filter((a) => a.name !== trace.config.agent)) {
        expect(assembly).not.toContain(`AGENT:${other.name}`);
      }
      expect(assembly).not.toContain('scripted summary');
    }

    // AC-21: the rows are ordinary agent runs carrying the PR's identity.
    const rows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.status).toBe('done');
      expect(row.prId).toBe(pr.id);
      expect(row.source).toBe('local');
      expect(row.multiAgentRunId).toBe(started.id);
      expect(row.durationMs).toBeGreaterThan(0);
      expect(row.costUsd).toBeGreaterThan(0);
      expect(row.score).not.toBeNull();
      expect(row.findingsCount).not.toBeNull();
      expect(row.blockers).not.toBeNull();
      expect(row.grounding).toMatch(/passed$/);
    }

    await app.close();
  }, 60_000);

  it('reads the results with zero provider calls, clusters overlapping findings, and drops a finding off the diff', async () => {
    const shared = { peak: 0, inFlight: 0 };
    const llm = new CountingLlm(
      {
        // Two findings on ONE file at 28-30 and 29-31 - the criterion's own case.
        Alpha: review([finding({ id: 'a1', severity: 'WARNING', start_line: 28, end_line: 30 })]),
        Beta: review([finding({ id: 'b1', severity: 'SUGGESTION', start_line: 29, end_line: 31, title: 'Extract the constant', rationale: 'Reads better as a named constant.\nSecond line.' })]),
        // Everyone agrees here, so this cluster must NOT reach the section...
        Gamma: review([
          finding({ id: 'g1', severity: 'WARNING', file: 'src/config.ts', start_line: 11, end_line: 11, title: 'Key' }),
          // ...and this one cites a line the diff does not contain, so the
          // citation gate must drop it before it can become a column entry.
          finding({ id: 'g2', severity: 'CRITICAL', file: 'src/config.ts', start_line: 999, end_line: 999, title: 'Phantom' }),
        ]),
      },
      shared,
    );
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr();
    const agents = await createAgents(app, ['Alpha', 'Beta', 'Gamma']);

    const started = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: agents.map((a) => a.id) },
      })
    ).json();
    await waitForTraces(started.columns.map((c: { run_id: string }) => c.run_id));

    const callsBeforeRead = llm.calls.length;
    const read = await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.id}` });
    expect(read.statusCode).toBe(200);
    const run = read.json();

    // AC-36 / AC-42: reading the results issues no provider request at all.
    expect(llm.calls).toHaveLength(callsBeforeRead);

    // Columns are in agent order (name ascending), one per agent in the run.
    expect(run.columns.map((c: { agent_name: string }) => c.agent_name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(run.status).toBe('done');

    // AC-54: the phantom finding never reaches a column.
    const gamma = run.columns.find((c: { agent_name: string }) => c.agent_name === 'Gamma');
    expect(gamma.findings.map((f: { title: string }) => f.title)).toEqual(['Key']);

    // AC-41: 28-30 and 29-31 on one file are ONE cluster, and it diverges
    // (WARNING vs SUGGESTION vs silence), so it is in the section.
    const ratelimit = run.conflicts.filter(
      (c: { file: string }) => c.file === 'src/middleware/ratelimit.ts',
    );
    expect(ratelimit).toHaveLength(1);
    expect(ratelimit[0].takes).toHaveLength(3);
    expect(ratelimit[0].takes.map((t2: { verdict: string }) => t2.verdict)).toEqual([
      'WARNING',
      'SUGGESTION',
      'did_not_flag',
    ]);
    // AC-50: the flagging cell carries that finding's own rationale, one line.
    expect(ratelimit[0].takes[1].note).toBe('Reads better as a named constant.');
    // AC-48: the silent cell carries no prose at all.
    expect(ratelimit[0].takes[2].note).toBeNull();

    // AC-46: only Gamma flagged src/config.ts, but the others were silent, so
    // that cluster DIVERGES and appears; the phantom one does not exist at all.
    expect(
      run.conflicts.some((c: { title: string }) => c.title === 'Phantom'),
    ).toBe(false);

    await app.close();
  }, 60_000);

  it('keeps the surviving agents when one fails, and reports the whole run failed when every agent does', async () => {
    // AC-22 - one agent's provider refuses.
    const partial = new CountingLlm({ Alpha: review([finding({ id: 'a1' })]), Beta: 'throw' });
    const app = await appWith(partial);
    const { pr } = await setupRepoAndPr();
    const agents = await createAgents(app, ['Alpha', 'Beta']);
    const started = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: agents.map((a) => a.id) },
      })
    ).json();
    await waitForTraces(started.columns.map((c: { run_id: string }) => c.run_id));

    const run = (await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.id}` })).json();
    expect(run.status).toBe('done');
    const alpha = run.columns.find((c: { agent_name: string }) => c.agent_name === 'Alpha');
    const beta = run.columns.find((c: { agent_name: string }) => c.agent_name === 'Beta');
    expect(alpha.status).toBe('done');
    expect(alpha.findings).toHaveLength(1);
    // AC-39: the failed agent shows its recorded error IN PLACE OF a score and
    // a findings list.
    expect(beta.status).toBe('failed');
    expect(beta.error).toContain('provider refused for Beta');
    expect(beta.score).toBeNull();
    expect(beta.findings).toEqual([]);

    // AC-24 / AC-25 / AC-26: duration is the MAX, cost is the SUM of the known
    // costs, and the failed agent's unknown cost marks the total partial.
    const durations = run.columns.map((c: { duration_ms: number | null }) => c.duration_ms ?? 0);
    expect(run.total_duration_ms).toBe(Math.max(...durations));
    expect(run.total_cost_usd).toBeCloseTo(alpha.cost_usd, 6);
    expect(run.total_cost_partial).toBe(true);

    // AC-23 - every agent fails.
    const allFail = new CountingLlm({ Alpha: 'throw', Beta: 'throw' });
    const app2 = await appWith(allFail);
    const { pr: pr2 } = await setupRepoAndPr();
    const agents2 = await createAgents(app2, ['Alpha', 'Beta']);
    const started2 = (
      await app2.inject({
        method: 'POST',
        url: `/pulls/${pr2.id}/multi-agent-run`,
        payload: { agent_ids: agents2.map((a) => a.id) },
      })
    ).json();
    await waitForTraces(started2.columns.map((c: { run_id: string }) => c.run_id));

    const run2 = (await app2.inject({ method: 'GET', url: `/multi-agent-runs/${started2.id}` })).json();
    expect(run2.status).toBe('failed');
    for (const column of run2.columns) {
      expect(column.status).toBe('failed');
      expect(column.error).toBeTruthy();
    }

    await app.close();
    await app2.close();
  }, 90_000);

  it('refuses a second run on a pull request whose run is still in flight, naming it', async () => {
    // A provider that never answers keeps the first run's members `running`.
    const stalled = new CountingLlm({});
    stalled.completeStructured = (async (req: StructuredRequest<unknown>) => {
      if (req.schemaName === 'Intent') {
        return {
          data: INTENT_FIXTURE,
          model: req.model,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          raw: '{}',
          attempts: 1,
        };
      }
      await new Promise((r) => setTimeout(r, 5_000));
      throw new Error('stalled');
    }) as CountingLlm['completeStructured'];

    const app = await appWith(stalled);
    const { pr } = await setupRepoAndPr();
    const agents = await createAgents(app, ['Alpha', 'Beta']);
    const first = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: agents.map((a) => a.id) },
      })
    ).json();

    const second = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: agents.map((a) => a.id) },
    });
    expect(second.statusCode).toBe(409);
    // The refusal NAMES the run holding the slot, so the user can go to it.
    expect(JSON.stringify(second.json())).toContain(first.id);

    await app.close();
  }, 60_000);

  it('refuses fewer than two agents at the boundary, and lists a repository run without any finding', async () => {
    const llm = new CountingLlm({ Alpha: review([finding({ id: 'a1' })]), Beta: review([]) });
    const app = await appWith(llm);
    const { repo, pr } = await setupRepoAndPr();
    const agents = await createAgents(app, ['Alpha', 'Beta']);

    // `agent_ids.min(2)` is a SCHEMA rule, so this is a 422 before the handler.
    const tooFew = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agents[0]!.id] },
    });
    expect(tooFew.statusCode).toBe(422);

    const started = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: agents.map((a) => a.id) },
      })
    ).json();
    await waitForTraces(started.columns.map((c: { run_id: string }) => c.run_id));

    // Amendment 01 - the landing list carries headers only.
    const list = await app.inject({ method: 'GET', url: `/repos/${repo.id}/multi-agent-runs` });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(started.id);
    expect(rows[0].agent_count).toBe(2);
    expect(rows[0].pr_number).toBe(482);
    expect(rows[0].status).toBe('done');
    expect(rows[0].findings_count).toBe(1);
    expect(JSON.stringify(rows)).not.toContain('rationale');
    expect(rows[0].columns).toBeUndefined();
    expect(rows[0].conflicts).toBeUndefined();

    // The estimate reads recorded history only - no run started, no model call.
    const before = llm.calls.length;
    const estimates = (
      await app.inject({ method: 'GET', url: '/agents/run-estimates' })
    ).json();
    expect(llm.calls).toHaveLength(before);
    const alpha = estimates.find((e: { agent_id: string }) => e.agent_id === agents[0]!.id);
    expect(alpha.samples).toBe(1);
    expect(alpha.median_duration_ms).toBeGreaterThan(0);

    await app.close();
  }, 60_000);
});
