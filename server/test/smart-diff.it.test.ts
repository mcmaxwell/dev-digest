/**
 * Smart Diff route (L03) — GET /pulls/:id/smart-diff.
 *
 * The classifier itself is covered hermetically in `smart-diff.test.ts`; this
 * file exercises what only a real database can show: that the route resolves
 * the PR, joins its files to the latest review's findings, serialises against
 * the shared contract, and refuses a PR belonging to another workspace.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import { SmartDiffResponse } from '@devdigest/shared';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('smart diff route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let seededPrId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    // No provider is configured, so the secrets provider must be explicitly
    // empty for the app to stay hermetic (see server/INSIGHTS.md).
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    seededPrId = pr!.id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('groups the seeded PR into core and wiring and marks its findings', async () => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${seededPrId}/smart-diff` });
    expect(res.statusCode).toBe(200);

    // Parse rather than eyeball: this is what the client's contract copy expects.
    const body = SmartDiffResponse.parse(res.json());

    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring']);

    const core = body.groups[0]!.files.map((f) => f.path);
    expect(core).toContain('src/middleware/ratelimit.ts');
    expect(core).toContain('src/api/public/webhooks.ts');
    expect(body.groups[1]!.files.map((f) => f.path)).toEqual(['src/config.ts']);

    // The two seeded findings, on the two files that carry them. The seeded
    // review has run_id = null, i.e. the pre-run-tracking fallback path.
    const byPath = new Map(body.groups.flatMap((g) => g.files).map((f) => [f.path, f]));
    expect(byPath.get('src/config.ts')!.finding_lines).toEqual([12]);
    expect(byPath.get('src/api/users.ts')!.finding_lines).toEqual([45]);
    expect(byPath.get('src/middleware/ratelimit.ts')!.finding_lines).toEqual([]);

    // A flagged file sorts ahead of larger unflagged ones inside its group.
    expect(core[0]).toBe('src/api/users.ts');

    expect(body.split_suggestion).toEqual({
      too_big: false,
      total_lines: 134,
      proposed_splits: [],
    });
    expect(byPath.get('src/config.ts')!.pseudocode_summary).toBeNull();
  });

  it('serves a PR that has never been reviewed with empty finding_lines', async () => {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'unreviewed', fullName: 'acme/unreviewed' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'No review yet',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'cafebabe',
        additions: 3,
        deletions: 1,
        filesCount: 2,
        status: 'open',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/billing/invoice.ts', additions: 3, deletions: 1 },
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 0, deletions: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    expect(body.groups.every((g) => g.files.every((f) => f.finding_lines.length === 0))).toBe(true);
  });

  it('404s on an unknown PR id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/smart-diff',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s on a PR belonging to another workspace', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: other!.id,
        owner: 'other',
        name: 'secret',
        fullName: 'other/secret',
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: other!.id,
        repoId: repo!.id,
        number: 9,
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
    await pg.handle.db
      .insert(t.prFiles)
      .values([{ prId: pr!.id, path: 'src/secret.ts', additions: 1, deletions: 0 }]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
  });

  it('422s on a non-uuid id before the handler runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
  });
});
