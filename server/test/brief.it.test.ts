/**
 * L05 PR Brief — generation, grounding, degradation, tenancy and the two
 * histories, end to end through `buildApp` + `app.inject`.
 *
 * The derivation tables are covered hermetically in `candidates.test.ts`,
 * `ground.test.ts`, `history.test.ts` and `prompt.test.ts`. This file exercises
 * what only a real database can show:
 *
 *  - the envelope round-trips through the CLIENT's copy of the contract, so a
 *    drift between the two vendored copies fails HERE and not in a browser
 *    (AC-52);
 *  - a degraded index makes ZERO model calls and still persists a readable
 *    brief;
 *  - the read path never calls a model (AC-4) and never generates (AC-5);
 *  - no `agent_runs` row appears and `total_cost_usd` does not move (AC-3,
 *    AC-51);
 *  - two generations append two history rows and the first is byte-identical
 *    afterwards (AC-43, AC-44);
 *  - a model naming invented paths yields non-zero dropped counts and a 200
 *    (AC-17, AC-18).
 *
 * Every provider the generation can resolve is mocked AND
 * `secrets: new MockSecretsProvider({})` is passed — without the latter the
 * container falls back to the developer's `~/.devdigest/secrets.json` and spends
 * real money.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import { BRIEF_SCHEMA_NAME } from '../src/modules/brief/schemas.js';
import { BriefService } from '../src/modules/brief/service.js';
// The CLIENT's copy of the contract, on purpose: parsing the server's response
// with it is what turns a silent drift between the two vendored copies into a
// failing test.
import { PrBriefResponse } from '../../client/src/vendor/shared/contracts/pr-brief.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Changed files of the seeded PR #482 the fixture index is built around. */
const RATELIMIT = 'src/middleware/ratelimit.ts';
const CONFIG = 'src/config.ts';

const REVIEW_FIXTURE: Review = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };

/**
 * The draft the model "returns". Two of its paths are invented, so grounding has
 * something real to remove in every case that reads `dropped`.
 */
const DRAFT = {
  what: 'This change touches the rate limiter and the config loader, which the HTTP server calls.',
  why: 'It sets out to rotate the rate-limit configuration.',
  risk_level: 'high',
  risks: [
    {
      kind: 'auth surface',
      title: 'Rate limiter configuration moves',
      explanation: 'The middleware reads a value the config loader now sets.',
      severity: 'low',
      file_refs: [RATELIMIT, 'src/invented-a.ts'],
      endpoints: ['GET /users', 'POST /ghost'],
      crons: [],
    },
    {
      kind: 'invented',
      title: 'Nothing real backs this',
      explanation: 'Every path it names is made up.',
      severity: 'high',
      file_refs: ['src/invented-b.ts'],
      endpoints: [],
      crons: [],
    },
  ],
  review_focus: [
    { file: RATELIMIT, line: 11, reason: 'The limiter window changed here.' },
    // A line in the DEFAULT BRANCH, on a caller file that has no `@@` ranges.
    { file: 'src/server.ts', line: 30, reason: 'It calls the limiter.' },
    { file: 'src/invented-c.ts', line: null, reason: 'Made up.' },
  ],
};

type LlmMode = 'ok' | 'reject';

class CountingLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  public structuredCalls: { schemaName: string; model: string }[] = [];
  public mode: LlmMode = 'ok';

  get briefCalls(): number {
    return this.structuredCalls.filter((c) => c.schemaName === BRIEF_SCHEMA_NAME).length;
  }

  reset(): void {
    this.structuredCalls = [];
    this.mode = 'ok';
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'mock', model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0 };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(1536).fill(0));
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.structuredCalls.push({ schemaName: req.schemaName, model: req.model });
    const isBrief = req.schemaName === BRIEF_SCHEMA_NAME;
    if (isBrief && this.mode === 'reject') throw new Error('provider refused');

    const fixture = isBrief ? DRAFT : REVIEW_FIXTURE;
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 4_200,
      tokensOut: 310,
      costUsd: 0.0031,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }
}

d('PR brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  /** The seeded PR's own head. Read, never assumed — the seed owns the value. */
  let headSha: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const llm = new CountingLLMProvider();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        // Every provider the generation can resolve, so no path reaches a key.
        llm: { openai: llm, anthropic: llm, openrouter: llm },
      },
    });
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    repoId = pr!.repoId;
    headSha = pr!.headSha;
    // The seed leaves `clone_path` null; the brief's clone gate reads it, and a
    // clone that is not there is `clone_unavailable` by design.
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/mock/clones/acme/payments-api' })
      .where(eq(t.repos.id, repoId));
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  beforeEach(async () => {
    llm.reset();
    // Restore the head every case, so one failing case cannot cascade into the
    // next through a mutated fixture.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha })
      .where(eq(t.pullRequests.id, prId));
    await pg.handle.db.delete(t.prBriefHistory).where(eq(t.prBriefHistory.prId, prId));
    await pg.handle.db.delete(t.prBrief).where(eq(t.prBrief.prId, prId));
  });

  /** A full, healthy index over the two changed files of PR #482. */
  async function seedIndex(opts: { status?: 'full' | 'partial' } = {}) {
    const db = pg.handle.db;
    await db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));
    await db.delete(t.symbols).where(eq(t.symbols.repoId, repoId));
    await db.delete(t.references).where(eq(t.references.repoId, repoId));
    await db.delete(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    await db.delete(t.fileEdges).where(eq(t.fileEdges.repoId, repoId));
    await db.delete(t.fileFacts).where(eq(t.fileFacts.repoId, repoId));

    await db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'indexedsha1',
      indexerVersion: INDEXER_VERSION,
      status: opts.status ?? 'full',
      filesIndexed: 6,
      filesSkipped: 0,
      stats: { softBudgetReached: false, parseDegraded: [] },
    });
    await db.insert(t.symbols).values([
      { repoId, path: RATELIMIT, name: 'rateLimit', kind: 'function', line: 24, endLine: 40, exported: true, signature: 'function rateLimit()', contentHash: 'h1' },
      { repoId, path: CONFIG, name: 'loadConfig', kind: 'function', line: 12, endLine: 20, exported: true, signature: 'function loadConfig()', contentHash: 'h2' },
      { repoId, path: 'src/server.ts', name: 'buildServer', kind: 'function', line: 1, endLine: 60, exported: true, signature: 'function buildServer()', contentHash: 'h3' },
    ]);
    await db.insert(t.references).values([
      { repoId, fromPath: 'src/server.ts', toSymbol: 'rateLimit', line: 30, declFile: RATELIMIT, contentHash: 'h3' },
    ]);
    await db.insert(t.fileRank).values([
      { repoId, filePath: 'src/server.ts', pagerank: 0.4, hotness: 0, rank: 0.4, percentile: 90 },
    ]);
    await db.insert(t.fileEdges).values([{ repoId, fromFile: 'src/server.ts', toFile: RATELIMIT }]);
    await db.insert(t.fileFacts).values([
      { repoId, filePath: 'src/server.ts', endpoints: ['GET /users'], crons: [] },
    ]);
  }

  async function dropIndex() {
    await pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));
  }

  // --- generation ----------------------------------------------------------

  it('generates one brief, parsed by the CLIENT copy of the contract (AC-52)', async () => {
    await seedIndex();
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);

    const body = PrBriefResponse.parse(res.json());
    const brief = body.brief!;

    expect(brief.status).toBe('ok');
    expect(brief.degraded_reason).toBeNull();
    expect(brief.meta.provider).toBe('openai');
    expect(brief.meta.model).toBe('gpt-4.1');
    expect(brief.meta.head_sha).toBe(headSha);
    expect(brief.meta.indexed_sha).toBe('indexedsha1');
    expect(brief.meta.stale).toBe(false);
    expect(brief.index).toMatchObject({ status: 'ok', last_indexed_sha: 'indexedsha1' });
    expect(brief.prose.what).toBe(DRAFT.what);
    expect(llm.briefCalls).toBe(1);
  });

  it('grounds the model output: invented paths are dropped and counted (AC-17, AC-18)', async () => {
    await seedIndex();
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const brief = PrBriefResponse.parse(res.json()).brief!;

    // The wholly-invented risk is gone; the real one kept only its real path.
    expect(brief.risks.map((r) => r.title)).toEqual(['Rate limiter configuration moves']);
    expect(brief.risks[0]!.file_refs).toEqual([RATELIMIT]);
    expect(brief.dropped.risks).toBe(1);
    expect(brief.dropped.file_refs).toBe(1);
    expect(brief.dropped.endpoints).toBe(1);

    // The invented focus entry is gone; the caller-file entry survives with NO
    // line, because a caller line is a position in the default branch (AC-16).
    expect(brief.review_focus.map((e) => e.file)).toEqual([RATELIMIT, 'src/server.ts']);
    expect(brief.review_focus[1]!.line).toBeNull();
    expect(brief.dropped.focus).toBe(1);
    expect(brief.dropped.lines).toBeGreaterThan(0);

    // AC-19: the model claimed `high`, and the only surviving risk is `low`.
    expect(brief.risk_level).toBe('low');

    // AC-14 observable: no endpoint or job string reaches the response at all.
    expect(JSON.stringify(brief.risks)).not.toContain('/ghost');
  });

  it('issues EXACTLY one structured call, identified by the brief schema name (AC-1)', async () => {
    await seedIndex();
    // Constructed directly over `app.container` with a logger we own: routes
    // hand the service `app.log`, which is a noop under the test config.
    const lines: { obj: Record<string, unknown>; msg?: string }[] = [];
    const logger = {
      info: (obj: unknown, msg?: string) => lines.push({ obj: obj as Record<string, unknown>, msg }),
    };
    await new BriefService(app.container).generate(workspaceId, prId, { logger });

    expect(llm.structuredCalls).toEqual([{ schemaName: BRIEF_SCHEMA_NAME, model: 'gpt-4.1' }]);

    const generated = lines.find((l) => l.msg === 'brief: generated');
    expect(generated?.obj).toMatchObject({
      feature: 'risk_brief',
      call: 'brief',
      schemaName: BRIEF_SCHEMA_NAME,
      provider: 'openai',
      // Provider-reported figures, never the locally measured token count.
      tokensIn: 4_200,
      tokensOut: 310,
      costUsd: 0.0031,
    });
    // The prompt itself never reaches a log line — it lives in `pr_brief.trace`.
    expect(JSON.stringify(lines)).not.toContain('<untrusted');
  });

  it('persists the full prompt to pr_brief.trace, with the kept block list (AC-10)', async () => {
    await seedIndex();
    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    const trace = row!.trace as { system: string; user: string; blocks_kept: string[] };

    expect(trace.system).toContain('<untrusted>');
    expect(trace.user).toContain('<untrusted source=');
    expect(trace.blocks_kept).toContain('changed_files');
    // AC-6, observed against the PERSISTED prompt.
    const offenders = trace.user.split('\n').filter((l) => /^[+-]/.test(l) && !l.includes('@@'));
    expect(offenders).toEqual([]);
  });

  // --- reading -------------------------------------------------------------

  it('returns null for a PR that has never had one generated (AC-5)', async () => {
    await seedIndex();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    expect(PrBriefResponse.parse(res.json()).brief).toBeNull();
    expect(llm.briefCalls).toBe(0);
  });

  it('serves the stored brief on GET with no second model call (AC-4)', async () => {
    await seedIndex();
    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(llm.briefCalls).toBe(1);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    const brief = PrBriefResponse.parse(res.json()).brief!;
    expect(brief.prose.what).toBe(DRAFT.what);
    expect(llm.briefCalls).toBe(1);
  });

  it('marks a brief stale when the head moves, and still serves its contents (AC-24, AC-25, AC-26)', async () => {
    await seedIndex();
    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    const before = PrBriefResponse.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json(),
    ).brief!;
    expect(before.meta.stale).toBe(false);

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'moved-on-0001' })
      .where(eq(t.pullRequests.id, prId));

    const after = PrBriefResponse.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json(),
    ).brief!;
    expect(after.meta.stale).toBe(true);
    // The FULL contents, not an empty state — and nothing regenerated.
    expect(after.risks).toHaveLength(1);
    expect(after.meta.generated_at).toBe(before.meta.generated_at);
    expect(llm.briefCalls).toBe(1);
  });

  it('marks a brief stale when only the INDEX moves (AC-24)', async () => {
    await seedIndex();
    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });

    await pg.handle.db
      .update(t.repoIndexState)
      .set({ lastIndexedSha: 'reindexed-2' })
      .where(eq(t.repoIndexState.repoId, repoId));

    const after = PrBriefResponse.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json(),
    ).brief!;
    expect(after.meta.stale).toBe(true);
    expect(after.meta.head_sha).toBe(headSha);
  });

  // --- degradation ---------------------------------------------------------

  it('makes ZERO model calls on a degraded index and still persists a brief', async () => {
    await dropIndex();
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);

    const brief = PrBriefResponse.parse(res.json()).brief!;
    expect(brief.status).toBe('degraded');
    expect(brief.degraded_reason).toBe('index_degraded');
    expect(brief.risks).toEqual([]);
    expect(brief.review_focus).toEqual([]);
    expect(llm.briefCalls).toBe(0);

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(row!.status).toBe('degraded');
    expect(row!.degradedReason).toBe('index_degraded');
  });

  it('returns 200 with model_failed when the provider throws, never an error status (AC-36)', async () => {
    await seedIndex();
    llm.mode = 'reject';
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });

    expect(res.statusCode).toBe(200);
    const brief = PrBriefResponse.parse(res.json()).brief!;
    expect(brief.status).toBe('degraded');
    expect(brief.degraded_reason).toBe('model_failed');
    expect(llm.briefCalls).toBe(1);
  });

  // --- the two histories ---------------------------------------------------

  it('appends one entry per generation and never rewrites an earlier one (AC-43, AC-44)', async () => {
    await seedIndex();
    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    const first = await pg.handle.db
      .select()
      .from(t.prBriefHistory)
      .where(eq(t.prBriefHistory.prId, prId));
    expect(first).toHaveLength(1);
    const snapshot = JSON.stringify(first[0]);

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'second-head-1' })
      .where(eq(t.pullRequests.id, prId));
    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });

    const rows = await pg.handle.db
      .select()
      .from(t.prBriefHistory)
      .where(eq(t.prBriefHistory.prId, prId));
    expect(rows).toHaveLength(2);
    // Byte-identical: the earliest entry is untouched by the later generation.
    expect(JSON.stringify(rows.find((r) => r.id === first[0]!.id))).toBe(snapshot);
    // AC-48: every entry records the head the generation actually ran at.
    expect(rows.map((r) => r.headSha).sort()).toEqual([headSha, 'second-head-1'].sort());

    const brief = PrBriefResponse.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json(),
    ).brief!;
    // AC-45: newest first.
    expect(brief.brief_history).toHaveLength(2);
    expect(brief.brief_history[0]!.head_sha).toBe('second-head-1');
  });

  it('carries prior overlapping PRs, computed without a model', async () => {
    await seedIndex();
    const [prior] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 401,
        title: 'Earlier limiter work',
        author: 'octocat',
        branch: 'feat/earlier',
        base: 'main',
        headSha: 'earlier1',
        status: 'open',
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values([{ prId: prior!.id, path: RATELIMIT, additions: 1, deletions: 0, patch: null }]);

    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    const brief = PrBriefResponse.parse(res.json()).brief!;
    expect(brief.history.map((h) => h.pr_number)).toContain(401);
    expect(brief.history.find((h) => h.pr_number === 401)!.files_overlap).toEqual([RATELIMIT]);

    await pg.handle.db.delete(t.prFiles).where(eq(t.prFiles.prId, prior!.id));
    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, prior!.id));
  });

  // --- it is not an agent run ---------------------------------------------

  it('creates no agent_runs row and leaves total_cost_usd unchanged (AC-3, AC-51)', async () => {
    await seedIndex();
    const runsBefore = (await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` })).json();
    const costBefore = await totalCost();

    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });

    const runsAfter = (await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` })).json();
    expect((runsAfter as unknown[]).length).toBe((runsBefore as unknown[]).length);
    expect(await totalCost()).toBe(costBefore);
  });

  async function totalCost(): Promise<number | null> {
    const rows = await app.container.reviewRepo.totalCostByPull([prId]);
    return rows[0]?.total ?? null;
  }

  // --- tenancy and validation ---------------------------------------------

  it('404s on a PR belonging to another workspace, on both verbs (AC-49)', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant-brief' })
      .returning();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: other!.id, owner: 'other', name: 'brief-secret', fullName: 'other/brief-secret' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: other!.id,
        repoId: repo!.id,
        number: 12,
        title: 'Not yours',
        author: 'someone',
        branch: 'feat/y',
        base: 'main',
        headSha: 'f00d',
        status: 'open',
      })
      .returning();

    expect((await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/brief` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/brief` })).statusCode).toBe(404);
    expect(llm.briefCalls).toBe(0);
    expect(workspaceId).not.toBe(other!.id);
  });

  it('422s on a non-uuid id before the handler runs', async () => {
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/brief' })).statusCode).toBe(422);
  });
});
