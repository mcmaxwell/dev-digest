import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockEmbedder,
  MockGitClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [],
};

/** Minimal multipart body for app.inject (one file field). */
function multipart(filename: string, content: string) {
  const boundary = '----devdigest-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

d('L02 skills (Testcontainers pg)', () => {
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
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        // No stored keys. Without this the container falls back to the
        // DEVELOPER'S ~/.devdigest/secrets.json, and L03's intent classifier
        // (which resolves `review_intent` → openrouter) would make a real,
        // billable network call on every review run in this file.
        secrets: new MockSecretsProvider({}),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  const createSkill = {
    name: 'no-console-log',
    description: 'Flag stray console.log calls.',
    type: 'convention' as const,
    body: '# No console.log\nFlag any added console.log.',
  };

  it('skills CRUD: create v1, body edit bumps version + snapshots, metadata edit does not', async () => {
    const app = await makeApp();

    const created = await app.inject({ method: 'POST', url: '/skills', payload: createSkill });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({ ...createSkill, source: 'manual', enabled: true, version: 1 });

    // seed skills + this one are all in the list
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === skill.id)).toBe(true);

    // metadata-only edit → same version
    const renamed = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { description: 'Flag console.log left in production code.' },
      })
    ).json();
    expect(renamed.version).toBe(1);

    // body edit → version 2 + an immutable snapshot
    const edited = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { body: '# No console.log\nFlag console.* in src/** (tests exempt).' },
      })
    ).json();
    expect(edited.version).toBe(2);
    const snapshots = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skill.id));
    expect(snapshots.map((s) => s.version).sort()).toEqual([1, 2]);

    // delete → gone
    expect(
      (await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('import preview parses the upload and persists NOTHING until confirmed', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json().length;

    const md = `---\nname: imported-rule\ndescription: Imported directive.\ntype: security\n---\n# Imported rule\nFlag things.`;
    const { payload, headers } = multipart('rule.md', md);
    const res = await app.inject({ method: 'POST', url: '/skills/import', payload, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'imported-rule',
      description: 'Imported directive.',
      type: 'security',
      skipped_entries: [],
    });

    const after = (await app.inject({ method: 'GET', url: '/skills' })).json().length;
    expect(after).toBe(before);

    // confirmed import = a plain POST /skills with the previewed core
    const saved = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'imported-rule',
          description: 'Imported directive.',
          type: 'security',
          body: '# Imported rule\nFlag things.',
          source: 'imported_file',
          enabled: false,
        },
      })
    ).json();
    expect(saved.source).toBe('imported_file');
    expect(saved.enabled).toBe(false);
    await app.close();
  });

  it('linking/reordering skills bumps the agent version and snapshots the ordered set', async () => {
    const app = await makeApp();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Linky', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const mk = async (name: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { ...createSkill, name },
        })
      ).json().id as string;
    const a = await mk('skill-a');
    const b = await mk('skill-b');

    // set [a, b] → v2
    const links = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [a, b] },
      })
    ).json();
    expect(links.map((l: { skill_id: string }) => l.skill_id)).toEqual([a, b]);
    expect((await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json()).toMatchObject(
      { version: 2, skill_count: 2 },
    );
    const v2 = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions/2` })
    ).json();
    expect(v2.config.skills).toEqual([a, b]);

    // reorder [b, a] → v3
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [b, a] },
    });
    const v3 = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions/3` })
    ).json();
    expect(v3.config.skills).toEqual([b, a]);

    // identical set again → NO new version
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [b, a] },
    });
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json().version,
    ).toBe(3);
    await app.close();
  });

  it('review run: enabled linked skills enter the prompt (ordered, untrusted-wrapped for imports); disabled ones do not', async () => {
    const app = await makeApp();
    const db = pg.handle.db;

    // a repo + PR to review
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'skills-run', fullName: 'acme/skills-run' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'x',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'ff00',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skilled', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const mkSkill = async (payload: Record<string, unknown>) =>
      (await app.inject({ method: 'POST', url: '/skills', payload })).json().id as string;
    const manual = await mkSkill({
      name: 'manual-rule',
      description: 'd',
      type: 'rubric',
      body: 'MANUAL_BODY_MARKER',
    });
    const imported = await mkSkill({
      name: 'imported-rule-live',
      description: 'd',
      type: 'security',
      body: 'IMPORTED_BODY_MARKER',
      source: 'imported_file',
    });
    const disabled = await mkSkill({
      name: 'disabled-rule',
      description: 'd',
      type: 'custom',
      body: 'DISABLED_BODY_MARKER',
      enabled: false,
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [manual, imported, disabled] },
    });

    const body = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr!.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    const runs = await waitForPrRuns(db, pr!.id, { expected: 1 });
    expect(runs[0]!.error).toBeNull();
    expect(runs[0]!.status).toBe('done');

    // The run row turns `done` INSIDE the persistence transaction; the trace
    // document is written just after it — poll briefly so we don't race it.
    let trace: { prompt_assembly?: { skills: string } } = {};
    for (let i = 0; i < 40 && !trace.prompt_assembly; i++) {
      trace = (
        await app.inject({ method: 'GET', url: `/runs/${body.runs[0].run_id}/trace` })
      ).json();
      if (!trace.prompt_assembly) await new Promise((r) => setTimeout(r, 25));
    }
    const skillsBlock: string = trace.prompt_assembly.skills;

    expect(skillsBlock).toContain('### Skill: manual-rule');
    expect(skillsBlock).toContain('MANUAL_BODY_MARKER');
    // manual = trusted, NOT delimiter-wrapped
    expect(skillsBlock).not.toContain('<untrusted source="skill:manual-rule">');
    // imported = untrusted-wrapped
    expect(skillsBlock).toContain('<untrusted source="skill:imported-rule-live">');
    expect(skillsBlock).toContain('IMPORTED_BODY_MARKER');
    // manual comes before imported (link order)
    expect(skillsBlock.indexOf('MANUAL_BODY_MARKER')).toBeLessThan(
      skillsBlock.indexOf('IMPORTED_BODY_MARKER'),
    );
    // globally-disabled skill is absent entirely
    expect(skillsBlock).not.toContain('DISABLED_BODY_MARKER');

    // per-block token attribution + the live-log line
    expect(trace.prompt_assembly.skills_tokens).toBeGreaterThan(0);
    expect(
      trace.log.some((l: { msg: string }) => l.msg.includes('2 enabled skill(s) attached')),
    ).toBe(true);

    // the user-message prompt carries the section header
    expect(trace.prompt_assembly.user).toContain('## Skills / rules');
    await app.close();
  });

  it('workspace scoping: a skill from another workspace 404s', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-skills' }).returning();
    const [foreign] = await db
      .insert(t.skills)
      .values({
        workspaceId: otherWs!.id,
        name: 'foreign',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'x',
        enabled: true,
        version: 1,
      })
      .returning();

    expect(
      (await app.inject({ method: 'GET', url: `/skills/${foreign!.id}` })).statusCode,
    ).toBe(404);
    // and it never shows in the default workspace list
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === foreign!.id)).toBe(false);

    // clean up so other tests' seed-based counts stay stable
    await db.delete(t.workspaces).where(and(eq(t.workspaces.id, otherWs!.id)));
    await app.close();
  });
});
