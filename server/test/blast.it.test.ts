/**
 * Blast radius routes (L04) — GET /pulls/:id/blast (+ the summary POST's gate).
 *
 * The derivation table, the caps and the reverse walk are covered hermetically
 * in `blast-status`, `blast-build` and `blast-reverse-bfs`. This file exercises
 * what only a real database can show:
 *
 *  - the whole envelope round-trips through the CLIENT's copy of the contract,
 *    so a drift between the two vendored copies fails HERE and not in a browser;
 *  - an endpoint reachable ONLY through a depth-2 import edge still lands on the
 *    changed symbol (the `routes -> service -> repository` case the walk exists
 *    for);
 *  - a PR from another workspace 404s, which proves the tenancy lookup runs
 *    before any repo data is read;
 *  - a repo with NO `repo_index_state` answers 200 with `not_indexed` instead of
 *    500, and does so WITHOUT touching `container.codeIndex` — that spy is the
 *    mechanical proof the request never falls into the ripgrep/clone fallback;
 *  - a `partial` index with an empty `file_rank` still returns callers, which is
 *    the exact regression the old INNER JOIN caused.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
// The CLIENT's copy of the contract, on purpose: parsing the server's response
// with it is what turns a silent drift between the two vendored copies into a
// failing test.
import { PrBlastResponse } from '../../client/src/vendor/shared/contracts/blast.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Changed files of the seeded PR #482 that this fixture builds an index around. */
const RATELIMIT = 'src/middleware/ratelimit.ts';
const CONFIG = 'src/config.ts';

d('blast radius route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prId: string;
  const codeIndexSpy = {
    symbols: vi.fn(async () => []),
    references: vi.fn(async () => []),
    grep: vi.fn(async () => []),
  };

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
        // Any call on this adapter means the request fell through to the clone
        // fallback, which the degraded gate exists to prevent.
        codeIndex: codeIndexSpy as never,
      },
    });
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    repoId = pr!.repoId;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  /** Seed a full, healthy index over the two changed files of PR #482. */
  async function seedIndex(opts: { withRank?: boolean; status?: 'full' | 'partial' } = {}) {
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
      {
        repoId,
        path: RATELIMIT,
        name: 'rateLimit',
        kind: 'function',
        line: 24,
        endLine: 40,
        exported: true,
        signature: 'function rateLimit(req, res, next)',
        contentHash: 'h1',
      },
      {
        repoId,
        path: CONFIG,
        name: 'loadConfig',
        kind: 'function',
        line: 12,
        endLine: 20,
        exported: true,
        signature: 'function loadConfig()',
        contentHash: 'h2',
      },
      // The caller file's own symbol, so the enclosing-symbol lookup has a name.
      {
        repoId,
        path: 'src/server.ts',
        name: 'buildServer',
        kind: 'function',
        line: 1,
        endLine: 60,
        exported: true,
        signature: 'function buildServer()',
        contentHash: 'h3',
      },
    ]);

    await db.insert(t.references).values([
      {
        repoId,
        fromPath: 'src/server.ts',
        toSymbol: 'rateLimit',
        line: 30,
        declFile: RATELIMIT,
        contentHash: 'h3',
      },
      {
        repoId,
        fromPath: 'src/server.ts',
        toSymbol: 'loadConfig',
        line: 8,
        declFile: CONFIG,
        contentHash: 'h3',
      },
    ]);

    if (opts.withRank !== false) {
      await db.insert(t.fileRank).values([
        { repoId, filePath: 'src/server.ts', pagerank: 0.4, hotness: 0, rank: 0.4, percentile: 90 },
        { repoId, filePath: RATELIMIT, pagerank: 0.2, hotness: 0, rank: 0.2, percentile: 60 },
      ]);
    }

    // routes.ts imports server.ts imports ratelimit.ts. `routes.ts` never names
    // `rateLimit`, so ONLY the depth-2 walk can reach its endpoint.
    await db.insert(t.fileEdges).values([
      { repoId, fromFile: 'src/server.ts', toFile: RATELIMIT },
      { repoId, fromFile: 'src/routes.ts', toFile: 'src/server.ts' },
    ]);

    await db.insert(t.fileFacts).values([
      { repoId, filePath: 'src/routes.ts', endpoints: ['GET /users'], crons: [] },
      { repoId, filePath: 'src/server.ts', endpoints: [], crons: ['nightly-purge'] },
    ]);
  }

  it('serves the whole envelope, parsed by the CLIENT copy of the contract', async () => {
    await seedIndex();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);

    const body = PrBlastResponse.parse(res.json());

    expect(body.index).toMatchObject({
      status: 'ok',
      reason: 'none',
      ranked: true,
      facts: true,
      graph: true,
      last_indexed_sha: 'indexedsha1',
    });
    expect(body.changed_files).toBe(4);
    expect(body.summary).toBeNull();

    const symbols = body.blast.changed_symbols.map((s) => s.name).sort();
    expect(symbols).toEqual(['loadConfig', 'rateLimit']);

    const down = body.blast.downstream.find((x) => x.symbol === 'rateLimit')!;
    expect(down.callers).toEqual([
      { name: 'buildServer', file: 'src/server.ts', line: 30, rank: 0.4 },
    ]);
    expect(down.caller_total).toBe(1);
  });

  it('reaches an endpoint that ONLY a depth-2 import edge can see', async () => {
    await seedIndex();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    const body = PrBlastResponse.parse(res.json());

    const down = body.blast.downstream.find((x) => x.symbol === 'rateLimit')!;
    // src/routes.ts is two hops from ratelimit.ts and names nothing in it.
    expect(down.endpoints_affected).toEqual(['GET /users']);
    // The cron sits on the direct caller, and crons make it out of the facade
    // at all — they used to stop inside `factsByFile`.
    expect(down.crons_affected).toEqual(['nightly-purge']);
  });

  it('still returns callers when the index is partial and file_rank is empty', async () => {
    await seedIndex({ withRank: false, status: 'partial' });
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);
    const body = PrBlastResponse.parse(res.json());

    // The honest warning...
    expect(body.index).toMatchObject({ status: 'partial', reason: 'no_rank', ranked: false });
    // ...and the callers are STILL there. The old INNER JOIN on file_rank
    // returned an empty list here while claiming the answer was not degraded.
    const down = body.blast.downstream.find((x) => x.symbol === 'rateLimit')!;
    expect(down.callers.map((c) => c.file)).toEqual(['src/server.ts']);
    expect(down.callers[0]!.rank).toBe(0);
  });

  it('answers 200 with not_indexed — and never touches the code index', async () => {
    await pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));
    codeIndexSpy.symbols.mockClear();
    codeIndexSpy.references.mockClear();

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });

    expect(res.statusCode).toBe(200);
    const body = PrBlastResponse.parse(res.json());
    expect(body.index).toMatchObject({ status: 'degraded', reason: 'not_indexed' });
    expect(body.blast.changed_symbols).toEqual([]);
    expect(body.blast.downstream).toEqual([]);
    // The proof: the ripgrep fallback was never entered, so no clone was read
    // and no index was rebuilt on the request path.
    expect(codeIndexSpy.symbols).not.toHaveBeenCalled();
    expect(codeIndexSpy.references).not.toHaveBeenCalled();
  });

  it('refuses to spend a model call when there is nothing to summarise', async () => {
    await pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/blast/summary` });
    expect(res.statusCode).toBe(409);
  });

  it('404s on a PR belonging to another workspace — tenancy is resolved first', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant-blast' })
      .returning();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: other!.id,
        owner: 'other',
        name: 'blast-secret',
        fullName: 'other/blast-secret',
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: other!.id,
        repoId: repo!.id,
        number: 11,
        title: 'Not yours',
        author: 'someone',
        branch: 'feat/y',
        base: 'main',
        headSha: 'f00d',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/blast` });
    expect(res.statusCode).toBe(404);
    expect(workspaceId).not.toBe(other!.id);
  });

  it('422s on a non-uuid id before the handler runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(res.statusCode).toBe(422);
  });
});
