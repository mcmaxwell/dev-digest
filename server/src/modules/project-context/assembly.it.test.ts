/**
 * L05 project context — run assembly, end to end through a real review run.
 *
 * Asserts what lands in the trace: `prompt_assembly.specs`, a non-null
 * `specs_tokens`, statused `specs_read` entries, the once-only rule for a
 * document reachable both directly and through a skill, the per-repository
 * filter, and that the clone is byte-for-byte unchanged afterwards (AC-50).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, readFile as readFileFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
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
import type { RepoRef, Review, RunTrace, SpecsReadEntry } from '@devdigest/shared';

const execFileAsync = promisify(execFile);

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context assembly] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };

const API_SPEC = '# Public API\n\nNever expose internal account ids in a response body.';
const ARCH_DOC = '# Architecture\n\nOne service per bounded context.';

/** A git stub rooted at real fixture directories, one per repository. */
class FixtureGitClient extends MockGitClient {
  /** Paths whose read must THROW, to cover the non-blank failure shape. */
  public unreadable = new Set<string>();

  constructor(private roots: Map<string, string>) {
    super({ diff: DIFF });
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

d('L05 project context — run assembly (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  let otherRepoId: string;
  let root: string;
  let otherRoot: string;
  let git: FixtureGitClient;
  const roots = new Map<string, string>();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    root = await mkdtemp(join(tmpdir(), 'pc-run-clone-'));
    await writeAt(root, 'specs/public-api.md', API_SPEC);
    await writeAt(root, 'docs/architecture.md', ARCH_DOC);
    await writeAt(root, 'docs/blank.md', '   \n');
    // A real git working tree, so AC-50's assertion has something to observe.
    await execFileAsync('git', ['init', '-q'], { cwd: root });
    await execFileAsync('git', ['add', '-A'], { cwd: root });
    await execFileAsync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], {
      cwd: root,
    });

    otherRoot = await mkdtemp(join(tmpdir(), 'pc-run-other-'));
    await writeAt(otherRoot, 'specs/other-repo.md', '# Other repo\n\nNothing to do with this PR.');

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'assembly-api',
        fullName: 'acme/assembly-api',
        clonePath: root,
      })
      .returning();
    repoId = repo!.id;
    roots.set('acme/assembly-api', root);

    const [other] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'other-api',
        fullName: 'acme/other-api',
        clonePath: otherRoot,
      })
      .returning();
    otherRepoId = other!.id;
    roots.set('acme/other-api', otherRoot);

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting.',
      })
      .returning();
    prId = pr!.id;
    await pg.handle.db.insert(t.prFiles).values({
      prId,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    git = new FixtureGitClient(roots);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
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

  /** Poll for the TRACE document, never for `agent_runs.status` (it races). */
  async function traceAfterRun(
    app: Awaited<ReturnType<typeof buildApp>>,
    agentId: string,
  ): Promise<RunTrace> {
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, prId, { expected: 1 });

    for (let i = 0; i < 200; i += 1) {
      const rows = await pg.handle.db
        .select()
        .from(t.runTraces)
        .where(eq(t.runTraces.runId, runId));
      if (rows[0]) return rows[0].trace as RunTrace;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no trace persisted for run ${runId}`);
  }

  async function makeAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
  }

  it('injects attached documents, records specs_tokens and statused specs_read', async () => {
    const app = await makeApp();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/refresh` });
    const agent = await makeAgent(app, `Injector-${Date.now()}`);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: {
        docs: [
          { repo_id: repoId, path: 'specs/public-api.md' },
          { repo_id: repoId, path: 'docs/architecture.md' },
        ],
      },
    });

    const trace = await traceAfterRun(app, agent.id);

    expect(trace.prompt_assembly.specs).toContain('Never expose internal account ids');
    expect(trace.prompt_assembly.specs).toContain('One service per bounded context');
    // Untrusted-wrapped, in the attachment order.
    expect(trace.prompt_assembly.specs).toContain('<untrusted source="spec-0">');
    expect(trace.prompt_assembly.specs!.indexOf('Public API')).toBeLessThan(
      trace.prompt_assembly.specs!.indexOf('Architecture'),
    );
    expect(trace.prompt_assembly.specs_tokens).toBeGreaterThan(0);
    // The engine's own section order: project context before the repo skeleton.
    expect(trace.prompt_assembly.user).toContain('## Project context');

    const entries = trace.specs_read as SpecsReadEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      path: 'specs/public-api.md',
      status: 'ok',
      origin: 'agent',
    });
    expect(entries[0]!.tokens).toBeGreaterThan(0);

    await app.close();
  });

  it('includes a document reachable directly AND through a skill exactly once', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, `Deduper-${Date.now()}`);
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `dedupe-${Date.now()}`, description: 'd', type: 'security', body: '# b' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const doc = { repo_id: repoId, path: 'specs/public-api.md' };
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}/context`, payload: { docs: [doc] } });
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}/context`, payload: { docs: [doc] } });

    const trace = await traceAfterRun(app, agent.id);
    const occurrences = trace.prompt_assembly.specs!.match(/Never expose internal account ids/g);
    expect(occurrences).toHaveLength(1);
    // Earliest position wins, so the direct attachment's origin is the record.
    expect(trace.specs_read).toHaveLength(1);
    expect((trace.specs_read as SpecsReadEntry[])[0]).toMatchObject({
      path: 'specs/public-api.md',
      origin: 'agent',
    });

    await app.close();
  });

  it('inherits a document from an enabled skill, and nothing from a disabled one', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, `Inheritor-${Date.now()}`);
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `inherit-${Date.now()}`, description: 'd', type: 'security', body: '# b' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { docs: [{ repo_id: repoId, path: 'docs/architecture.md' }] },
    });

    const inherited = await traceAfterRun(app, agent.id);
    expect(inherited.prompt_assembly.specs).toContain('One service per bounded context');
    expect((inherited.specs_read as SpecsReadEntry[])[0]!.origin).toBe(`skill:${skill.name}`);

    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    const afterDisable = await traceAfterRun(app, agent.id);
    expect(afterDisable.prompt_assembly.specs ?? null).toBeNull();
    expect(afterDisable.specs_read).toEqual([]);

    await app.close();
  });

  it('omits another repository’s attachments from this PR’s run', async () => {
    const app = await makeApp();
    await app.inject({ method: 'POST', url: `/repos/${otherRepoId}/context/refresh` });
    const agent = await makeAgent(app, `CrossRepo-${Date.now()}`);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: {
        docs: [
          { repo_id: otherRepoId, path: 'specs/other-repo.md' },
          { repo_id: repoId, path: 'specs/public-api.md' },
        ],
      },
    });

    const trace = await traceAfterRun(app, agent.id);
    expect(trace.prompt_assembly.specs).not.toContain('Nothing to do with this PR');
    expect(trace.prompt_assembly.specs).toContain('Never expose internal account ids');
    expect(trace.specs_read).toHaveLength(1);

    await app.close();
  });

  it('records an unreadable document as missing and keeps the run going', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, `Missing-${Date.now()}`);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: {
        docs: [
          // Reads as BLANK, not as a rejection — the mock-git failure shape.
          { repo_id: repoId, path: 'docs/blank.md' },
          { repo_id: repoId, path: 'docs/architecture.md' },
          { repo_id: repoId, path: 'specs/public-api.md' },
        ],
      },
    });
    // …and one that actually throws.
    git.unreadable.add('docs/architecture.md');

    const trace = await traceAfterRun(app, agent.id);
    const entries = trace.specs_read as SpecsReadEntry[];
    expect(entries.find((e) => e.path === 'docs/blank.md')).toMatchObject({
      status: 'missing',
      tokens: 0,
    });
    expect(entries.find((e) => e.path === 'docs/architecture.md')).toMatchObject({
      status: 'missing',
      tokens: 0,
    });
    // The run still completed and still carried the readable document.
    expect(trace.prompt_assembly.specs).toContain('Never expose internal account ids');
    expect(trace.log.some((l) => l.msg.includes('docs/architecture.md'))).toBe(true);

    git.unreadable.clear();
    await app.close();
  });

  it('leaves the clone untouched after browsing, attaching and running', async () => {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: root });
    expect(stdout.trim()).toBe('');
  });
});
