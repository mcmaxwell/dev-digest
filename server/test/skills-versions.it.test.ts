import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-versions] Docker not available — skipping integration tests.');
}

/**
 * Skill version history + rollback + stats — the read paths over the
 * `skill_versions` snapshots that POST/PUT /skills already write, and the
 * rollback that restores an old body AS A NEW version (history is immutable).
 */
d('skill versions, rollback and stats', () => {
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

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createSkill = {
    name: 'versioned-skill',
    description: 'd',
    type: 'convention' as const,
    body: 'BODY_V1',
  };

  const mkSkill = async (app: Awaited<ReturnType<typeof makeApp>>, name: string) =>
    (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createSkill, name } })
    ).json() as { id: string; version: number };

  it('GET /skills/:id/versions lists snapshots newest-first; metadata edits add none', async () => {
    const app = await makeApp();
    const skill = await mkSkill(app, 'history-list');

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'BODY_V2' },
    });
    // metadata-only edit → no new snapshot
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { description: 'renamed' },
    });

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(res.statusCode).toBe(200);
    const versions = res.json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ skill_id: skill.id, version: 2, body: 'BODY_V2' });
    expect(versions[1].body).toBe('BODY_V1');
    expect(typeof versions[0].created_at).toBe('string');
    await app.close();
  });

  it('rollback restores an old body AS A NEW version; history stays intact', async () => {
    const app = await makeApp();
    const skill = await mkSkill(app, 'rollback-target');
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'BODY_V2' } });

    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/rollback`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: skill.id, version: 3, body: 'BODY_V1' });

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].body).toBe('BODY_V1'); // restored
    expect(versions[1].body).toBe('BODY_V2'); // untouched
    await app.close();
  });

  it('rolling back to the current body is a no-op (no version bump)', async () => {
    const app = await makeApp();
    const skill = await mkSkill(app, 'rollback-noop');
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/rollback`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(1);
    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('404s: unknown skill, unknown version; 422 on a malformed version', async () => {
    const app = await makeApp();
    const skill = await mkSkill(app, 'rollback-404s');
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect(
      (await app.inject({ method: 'GET', url: `/skills/${ghost}/versions` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${ghost}/stats` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/skills/${ghost}/rollback`,
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/skills/${skill.id}/rollback`,
          payload: { version: 99 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/skills/${skill.id}/rollback`,
          payload: { version: 'abc' },
        })
      ).statusCode,
    ).toBe(422);
    await app.close();
  });

  it('stats: zeros for an unlinked skill; linked agents + their runs/findings roll up', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const skill = await mkSkill(app, 'stats-skill');

    const zero = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })).json();
    expect(zero).toEqual({
      agents: [],
      runs_count: 0,
      last_run_at: null,
      findings_count: 0,
      accepted_count: 0,
      dismissed_count: 0,
    });

    // link the skill to a fresh agent, then give that agent one run + one
    // review with two findings (one accepted)
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Stats Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'stats-repo', fullName: 'acme/stats-repo' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 9,
        title: 'x',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'aa11',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent.id, prId: pr!.id, status: 'done' })
      .returning();
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: agent.id,
        runId: run!.id,
        kind: 'review',
      })
      .returning();
    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        severity: 'warning',
        category: 'style',
        title: 'f1',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      },
      {
        reviewId: review!.id,
        file: 'b.ts',
        startLine: 2,
        endLine: 2,
        severity: 'critical',
        category: 'bug',
        title: 'f2',
        rationale: 'r',
        confidence: 0.9,
      },
    ]);

    const stats = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })).json();
    expect(stats.agents).toEqual([{ id: agent.id, name: 'Stats Agent', enabled: true }]);
    expect(stats).toMatchObject({
      runs_count: 1,
      findings_count: 2,
      accepted_count: 1,
      dismissed_count: 0,
    });
    expect(typeof stats.last_run_at).toBe('string');

    // clean up the run/review rows so other suites' aggregates stay stable
    await db.delete(t.repos).where(eq(t.repos.id, repo!.id));
    await app.close();
  });

  it('workspace scoping: a foreign skill 404s on versions, rollback and stats', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-vers' }).returning();
    const [foreign] = await db
      .insert(t.skills)
      .values({
        workspaceId: otherWs!.id,
        name: 'foreign-versioned',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'x',
        enabled: true,
        version: 1,
      })
      .returning();

    expect(
      (await app.inject({ method: 'GET', url: `/skills/${foreign!.id}/versions` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${foreign!.id}/stats` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/skills/${foreign!.id}/rollback`,
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(404);

    await db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
    await app.close();
  });
});
