/**
 * L05 project context — browsing and attachments, end to end through
 * `buildApp` + `app.inject`.
 *
 * The clone is a `mkdtemp` fixture tree; `overrides.git` is a stub whose
 * `clonePathFor` points at it and whose `readFile` reads from it, so the
 * discovery walk and the body read exercise real filesystem behaviour without
 * touching `server/clones/**`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFile as readFileFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import {
  MockEmbedder,
  MockGitClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../../adapters/mocks.js';
import type { RepoRef, Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REVIEW_FIXTURE: Review = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };

/** A git stub rooted at a real fixture directory, one per repository. */
class FixtureGitClient extends MockGitClient {
  /** Paths whose read must THROW, to cover the read failure branch. */
  public unreadable = new Set<string>();

  constructor(private roots: Map<string, string>) {
    super({});
  }
  override clonePathFor(repo: RepoRef): string {
    return this.roots.get(`${repo.owner}/${repo.name}`) ?? '/mock/clones/missing';
  }
  override async readFile(repo: RepoRef, path: string): Promise<string> {
    if (this.unreadable.has(path)) throw new Error(`EACCES: ${path}`);
    return readFileFs(join(this.clonePathFor(repo), path), 'utf8');
  }
}

async function writeAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

d('L05 project context — browsing + attachments (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let root: string;
  // One shared stub, like `assembly.it.test.ts`, so a test can flip a path to
  // unreadable and have the app built by `makeApp()` see it.
  let git: FixtureGitClient;
  const roots = new Map<string, string>();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    root = await mkdtemp(join(tmpdir(), 'pc-clone-'));
    await writeAt(root, 'specs/public-api.md', '# Public API\n\nNever expose internal account ids.');
    await writeAt(root, 'docs/architecture.md', '# Architecture\n\nOne service per bounded context.');
    await writeAt(root, 'insights/incident.md', '# Incident\n\nThe checkout outage of April.');
    await writeAt(root, 'README.md', '# not a project document');
    await writeAt(root, '.env', 'SECRET=nope');
    roots.set('acme/payments-api', root);

    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoId = repo!.id;
    // The seed inserts the repository with `clonePath: null`; the fixture tree
    // is what a finished clone job would have produced.
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath: root })
      .where(eq(t.repos.id, repoId));

    git = new FixtureGitClient(roots);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git,
        // Without this the container falls back to the DEVELOPER's
        // ~/.devdigest/secrets.json and makes real, billable calls.
        secrets: new MockSecretsProvider({}),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  it('lists only markdown under the four roots, and reads one body', async () => {
    const app = await makeApp();

    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context` })).json();
    expect(list.docs.map((doc: { path: string }) => doc.path)).toEqual([
      'docs/architecture.md',
      'insights/incident.md',
      'specs/public-api.md',
    ]);
    expect(list.scan).toMatchObject({ status: 'ok', doc_count: 3, skipped_too_large: 0, bounded: 0 });
    expect(list.scan.scanned_at).not.toBeNull();
    expect(list.docs[2]).toMatchObject({ category: 'specs', used_by_agents: 0 });

    const body = (
      await app.inject({
        method: 'GET',
        url: `/repos/${repoId}/context/doc?path=specs/public-api.md`,
      })
    ).json();
    expect(body.content).toContain('Never expose internal account ids.');

    await app.close();
  });

  it('refresh picks up a document added to the clone', async () => {
    const app = await makeApp();
    await writeAt(root, 'specs/rate-limiting.md', '# Rate limiting\n\n100 req/min.');

    const refreshed = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/context/refresh` })
    ).json();
    expect(refreshed.docs.map((doc: { path: string }) => doc.path)).toContain(
      'specs/rate-limiting.md',
    );
    expect(refreshed.scan.doc_count).toBe(4);

    // Leave the fixture as the other tests found it.
    await rm(join(root, 'specs/rate-limiting.md'));
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/refresh` });
    await app.close();
  });

  it('rejects a traversal path and a path outside the discovery globs, reading no file', async () => {
    const app = await makeApp();

    const traversal = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=${encodeURIComponent('specs/../../../etc/passwd')}`,
    });
    expect(traversal.statusCode).toBe(422);

    const dotEnv = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=.env`,
    });
    expect(dotEnv.statusCode).toBe(422);

    // A legal-looking path the globs never matched is a 404, not a read.
    const unlisted = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=specs/never-scanned.md`,
    });
    expect(unlisted.statusCode).toBe(404);

    await app.close();
  });

  it('surfaces a read that FAILS as an error carrying the path, not as empty content', async () => {
    const app = await makeApp();

    // A document that IS in the current scan, but whose read rejects — the
    // server half of AC-13. (A blank body is a different thing: an empty
    // document is a legal 200, and stays one.)
    git.unreadable.add('docs/architecture.md');

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=docs/architecture.md`,
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).not.toHaveProperty('content');
    // The path is what the client renders next to its retry control. Outside
    // production the 5xx message is relayed verbatim (see `app.ts`), so this is
    // where the failing document is named.
    expect(body.error.message).toContain('docs/architecture.md');

    // The neighbouring document is unaffected — the failure is per-read.
    const ok = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=specs/public-api.md`,
    });
    expect(ok.statusCode).toBe(200);

    // Leave the stub as the other tests found it.
    git.unreadable.clear();
    await app.close();
  });

  it('a repository outside the workspace 404s on the list and on an attachment write', async () => {
    const app = await makeApp();

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'private',
        fullName: 'other/private',
      })
      .returning();

    expect(
      (await app.inject({ method: 'GET', url: `/repos/${foreign!.id}/context` })).statusCode,
    ).toBe(404);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Scoped', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const write = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { docs: [{ repo_id: foreign!.id, path: 'specs/public-api.md' }] },
    });
    expect(write.statusCode).toBe(404);

    await app.close();
  });

  it('attachments persist with their order across a reload', async () => {
    const app = await makeApp();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Ordered', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context?repo_id=${repoId}`,
      payload: {
        docs: [
          { repo_id: repoId, path: 'specs/public-api.md' },
          { repo_id: repoId, path: 'docs/architecture.md' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);

    // A fresh app = a fresh read path; nothing is cached in process.
    const reloaded = await makeApp();
    const after = (
      await reloaded.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context?repo_id=${repoId}`,
      })
    ).json();
    expect(after.direct.map((row: { path: string }) => row.path)).toEqual([
      'specs/public-api.md',
      'docs/architecture.md',
    ]);
    expect(after.direct[0]).toMatchObject({
      status: 'ok',
      origin: 'direct',
      skill_name: null,
      repo_full_name: 'acme/payments-api',
    });
    expect(after.available_count).toBe(3);
    expect(after.tokens_total).toBeGreaterThan(0);

    // Reordering is the same full replace.
    await reloaded.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context?repo_id=${repoId}`,
      payload: {
        docs: [
          { repo_id: repoId, path: 'docs/architecture.md' },
          { repo_id: repoId, path: 'specs/public-api.md' },
        ],
      },
    });
    const reordered = (
      await reloaded.inject({ method: 'GET', url: `/agents/${agent.id}/context` })
    ).json();
    expect(reordered.direct.map((row: { path: string }) => row.path)).toEqual([
      'docs/architecture.md',
      'specs/public-api.md',
    ]);

    await app.close();
    await reloaded.close();
  });

  it('counts an agent once when it holds a document directly AND through an enabled skill', async () => {
    const app = await makeApp();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: `ctx-skill-${Date.now()}`,
          description: 'd',
          type: 'security',
          body: '# rules',
        },
      })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Counted-${Date.now()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const doc = { repo_id: repoId, path: 'insights/incident.md' };
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { docs: [doc] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { docs: [doc] },
    });

    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context` })).json();
    const row = list.docs.find((doc2: { path: string }) => doc2.path === 'insights/incident.md');
    expect(row.used_by_agents).toBe(1);

    // The same document is in the agent's inherited group too, named by skill.
    const context = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context?repo_id=${repoId}` })
    ).json();
    expect(context.inherited).toHaveLength(1);
    expect(context.inherited[0]).toMatchObject({
      path: 'insights/incident.md',
      origin: 'skill',
      skill_name: skill.name,
    });

    // A globally disabled skill contributes nothing.
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { enabled: false },
    });
    const afterDisable = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context?repo_id=${repoId}` })
    ).json();
    expect(afterDisable.inherited).toEqual([]);

    await app.close();
  });

  it('cascades attachment rows when the agent, the skill or the repository goes', async () => {
    const app = await makeApp();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `doomed-skill-${Date.now()}`, description: 'd', type: 'security', body: '# b' },
      })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Doomed-${Date.now()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    const doc = { repo_id: repoId, path: 'docs/architecture.md' };
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}/context`, payload: { docs: [doc] } });
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}/context`, payload: { docs: [doc] } });

    await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    expect(
      await pg.handle.db
        .select()
        .from(t.agentContextDocs)
        .where(eq(t.agentContextDocs.agentId, agent.id)),
    ).toEqual([]);

    await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(
      await pg.handle.db
        .select()
        .from(t.skillContextDocs)
        .where(eq(t.skillContextDocs.skillId, skill.id)),
    ).toEqual([]);

    // Deleting a repository takes its docs, its scan row and every attachment.
    const [throwaway] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `throwaway-${Date.now()}`,
        fullName: `acme/throwaway-${Date.now()}`,
      })
      .returning();
    await pg.handle.db
      .insert(t.projectDocs)
      .values({ repoId: throwaway!.id, path: 'docs/a.md', category: 'docs', sizeBytes: 1, tokens: 1 });
    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, throwaway!.id));
    expect(
      await pg.handle.db
        .select()
        .from(t.projectDocs)
        .where(eq(t.projectDocs.repoId, throwaway!.id)),
    ).toEqual([]);

    await app.close();
  });

  it('keeps a detachable row for a document that vanished from the clone', async () => {
    const app = await makeApp();
    await writeAt(root, 'docs/temporary.md', '# Temporary\n\nabout to vanish');
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/refresh` });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Missing-${Date.now()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { docs: [{ repo_id: repoId, path: 'docs/temporary.md' }] },
    });

    await rm(join(root, 'docs/temporary.md'));
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/refresh` });

    const context = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context?repo_id=${repoId}` })
    ).json();
    expect(context.direct).toHaveLength(1);
    expect(context.direct[0]).toMatchObject({ path: 'docs/temporary.md', status: 'missing' });

    // The row is still detachable: an empty replace clears it.
    const detached = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { docs: [] },
      })
    ).json();
    expect(detached.direct).toEqual([]);

    await app.close();
  });
});
