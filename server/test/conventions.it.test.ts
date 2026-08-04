import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockCodeIndex, MockEmbedder, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { ConventionCandidate, ConventionsPage, ConventionSkillDraft, Skill } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// --- the fake repository the scan reads ------------------------------------

const TSCONFIG = `{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}`;

const ROUTES_TS = [
  `import { z } from 'zod';`,
  `import { getContext } from '../_shared/context.js';`,
  ``,
  `const Body = z.object({ name: z.string() });`,
  ``,
  `export default async function routes(app) {`,
  `  app.post('/things', { schema: { body: Body } }, async (req) => {`,
  `    const { workspaceId } = await getContext(app.container, req);`,
  `    return service.create(workspaceId, req.body);`,
  `  });`,
  `}`,
].join('\n');

const OTHER_ROUTES_TS = [
  `import { z } from 'zod';`,
  ``,
  `const Params = z.object({ id: z.string().uuid() });`,
  ``,
  `export default async function repoRoutes(app) {`,
  `  app.get('/repos/:id', { schema: { params: Params } }, async (req) => {`,
  `    return service.get(req.params.id);`,
  `  });`,
  `}`,
].join('\n');

const IT_TEST_TS = [
  `import { describe, it, expect } from 'vitest';`,
  `import { startPg } from './helpers/pg.js';`,
  ``,
  `describe('things (Testcontainers pg)', () => {`,
  `  it('creates a thing', async () => {`,
  `    expect(true).toBe(true);`,
  `  });`,
  `});`,
].join('\n');

const FILES: Record<string, string> = {
  'tsconfig.json': TSCONFIG,
  'src/modules/things/routes.ts': ROUTES_TS,
  'src/modules/repos/routes.ts': OTHER_ROUTES_TS,
  'test/things.it.test.ts': IT_TEST_TS,
};

/** Minimal RepoIntel that serves the two ranked strata the sampler asks for. */
const repoIntelStub = {
  async getIndexState() {
    return { lastIndexedSha: 'deadbeef' };
  },
  async getRepoMap() {
    return { text: 'src/modules/**/routes.ts', tokens: 5, cached: true, degraded: false };
  },
  async getRankedSample(_repoId: string, opts: { kind?: 'source' | 'tests' }) {
    return opts.kind === 'tests'
      ? [{ path: 'test/things.it.test.ts', rank: 0.4 }]
      : [
          { path: 'src/modules/things/routes.ts', rank: 0.9 },
          { path: 'src/modules/repos/routes.ts', rank: 0.8 },
        ];
  },
} as unknown as RepoIntel;

// --- what the model "returns" ----------------------------------------------

/**
 * Deliberately mixed so the pipeline's filters are exercised, not just its happy
 * path: one grounded rule, one whose evidence does not exist in the clone, and
 * one that is generic advice.
 */
const EXTRACTION_FIXTURE = {
  conventions: [
    {
      rule: 'Route handlers validate input with a `zod` schema declared next to the route, never by parsing `req.body`.',
      rationale: 'Invalid input is rejected before the handler runs.',
      evidence: [
        { path: 'src/modules/things/routes.ts', line: 7, snippet: `app.post('/things', { schema: { body: Body } }, async (req) => {` },
        { path: 'src/modules/repos/routes.ts', line: 6, snippet: `app.get('/repos/:id', { schema: { params: Params } }, async (req) => {` },
      ],
      confidence: 0.9,
    },
    {
      rule: 'Every handler emits a `structuredLog` entry before returning to the caller.',
      evidence: [
        { path: 'src/modules/things/routes.ts', line: 3, snippet: 'structuredLog.info("handled");' },
        { path: 'src/modules/repos/routes.ts', line: 4, snippet: 'structuredLog.info("handled");' },
      ],
      confidence: 0.85,
    },
    {
      rule: 'Use meaningful names for variables and functions.',
      evidence: [
        { path: 'src/modules/things/routes.ts', line: 4, snippet: 'const Body = z.object({ name: z.string() });' },
        { path: 'src/modules/repos/routes.ts', line: 3, snippet: 'const Params = z.object({ id: z.string().uuid() });' },
      ],
      confidence: 0.7,
    },
  ],
};

const SELECTION_FIXTURE = {
  selections: [
    { category: 'api-contract', paths: ['src/modules/things/routes.ts', 'src/modules/repos/routes.ts'] },
  ],
};

d('L02 conventions extractor (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/mock/clones/acme/payments-api' })
      .where(eq(t.repos.fullName, 'acme/payments-api'))
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(overrides: { llm?: MockLLMProvider } = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        codeIndex: new MockCodeIndex(),
        git: new MockGitClient({ files: FILES }),
        repoIntel: repoIntelStub,
        llm: {
          openrouter:
            overrides.llm ??
            new MockLLMProvider('openai', {
              structuredBySchema: {
                ConventionFileSelection: SELECTION_FIXTURE,
                ConventionExtraction: EXTRACTION_FIXTURE,
              },
            }),
        },
      },
    });
  }

  /** Kick a scan and wait for the background job to settle. */
  async function runScan(app: Awaited<ReturnType<typeof buildApp>>): Promise<ConventionsPage> {
    const started = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(started.statusCode).toBe(202);
    await app.container.jobs.onIdle();
    // Poll the ARTIFACT, not the job status — the scan row is written inside the
    // persistence transaction (see server/INSIGHTS.md).
    for (let i = 0; i < 40; i += 1) {
      const page = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json<ConventionsPage>();
      if (page.scan && page.scan.status !== 'running') return page;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('scan never left running');
  }

  it('extracts, grounds and filters candidates end to end', async () => {
    const app = await makeApp();
    const page = await runScan(app);

    expect(page.scan).toMatchObject({
      status: 'done',
      sha: 'deadbeef',
      provider: 'openrouter',
    });
    expect(page.scan!.sample_count).toBeGreaterThan(0);

    const rules = page.candidates.map((c) => c.rule);

    // Grounded, repeated, specific → survives.
    expect(rules).toContain(
      'Route handlers validate input with a `zod` schema declared next to the route, never by parsing `req.body`.',
    );
    // Evidence is nowhere in the clone → dropped before it can reach the user.
    expect(rules.some((r) => r.includes('structuredLog'))).toBe(false);
    // True of every TypeScript repo → dropped as generic.
    expect(rules.some((r) => r.includes('meaningful names'))).toBe(false);

    // The deterministic config stratum contributes without any model call.
    const configRule = page.candidates.find((c) => c.origin === 'config');
    expect(configRule).toBeDefined();
    expect(configRule!.confidence).toBe(1);
    expect(configRule!.evidence[0]).toMatchObject({ path: 'tsconfig.json', verified: 'exact' });

    const grounded = page.candidates.find((c) => c.rule.includes('zod'))!;
    expect(grounded.evidence).toHaveLength(2);
    expect(new Set(grounded.evidence.map((e) => e.path)).size).toBe(2);
    expect(grounded.status).toBe('pending');
    await app.close();
  });

  it('rejects a second scan while one is running', async () => {
    const app = await makeApp();
    const [scan] = await pg.handle.db
      .insert(t.conventionScans)
      .values({ workspaceId, repoId, status: 'running' })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(409);

    await pg.handle.db
      .update(t.conventionScans)
      .set({ status: 'done' })
      .where(eq(t.conventionScans.id, scan!.id));
    await app.close();
  });

  it('accept / reject / edit a candidate, and a re-scan preserves those verdicts', async () => {
    const app = await makeApp();
    const before = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json<ConventionsPage>();

    const zodRule = before.candidates.find((c) => c.rule.includes('zod'))!;
    const configRule = before.candidates.find((c) => c.origin === 'config')!;

    const accepted = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${zodRule.id}`,
        payload: { status: 'accepted' },
      })
    ).json<ConventionCandidate>();
    expect(accepted.status).toBe('accepted');

    const rejected = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${configRule.id}`,
        payload: { status: 'rejected' },
      })
    ).json<ConventionCandidate>();
    expect(rejected.status).toBe('rejected');

    const edited = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${zodRule.id}`,
        payload: { rule: 'Routes declare their `zod` body/params schema inline — never parse `req.body`.' },
      })
    ).json<ConventionCandidate>();
    expect(edited.edited).toBe(true);
    expect(edited.rule).toContain('never parse');

    // Re-scan: the same rules come back, but the verdicts and the user's
    // wording survive — a rescan must never re-ask what was already answered.
    const after = await runScan(app);
    const zodAfter = after.candidates.find((c) => c.id === zodRule.id)!;
    expect(zodAfter.status).toBe('accepted');
    expect(zodAfter.rule).toContain('never parse');

    // An edit must not fork the card: the rescan proposes the model's ORIGINAL
    // wording, which has to be recognised as the same rule rather than added as
    // a second, pending duplicate beside the user's edited one.
    expect(after.candidates.filter((c) => c.rule.includes('zod'))).toHaveLength(1);

    // The rejected rule is not re-proposed at all.
    expect(after.candidates.some((c) => c.id === configRule.id && c.status === 'pending')).toBe(
      false,
    );
    await app.close();
  });

  it('renders accepted candidates into a skill draft that POST /skills can save', async () => {
    const app = await makeApp();
    const page = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json<ConventionsPage>();
    const acceptedIds = page.candidates.filter((c) => c.status === 'accepted').map((c) => c.id);
    expect(acceptedIds.length).toBeGreaterThan(0);

    const drafts = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill-draft`,
        payload: { candidate_ids: acceptedIds, mode: 'merged' },
      })
    ).json<ConventionSkillDraft[]>();

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.name).toBe('payments-api-conventions');
    expect(drafts[0]!.type).toBe('convention');
    expect(drafts[0]!.body).toContain('# payments-api-conventions');
    // Evidence travels into the skill so the reviewer can calibrate the rule.
    expect(drafts[0]!.body).toContain('src/modules/things/routes.ts:7');

    // The draft persists nothing — saving is the ordinary skills path.
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: drafts[0]!.name,
        description: drafts[0]!.description,
        type: drafts[0]!.type,
        body: drafts[0]!.body,
        source: 'extracted',
      },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json<Skill>();
    expect(skill.source).toBe('extracted');
    expect(skill.version).toBe(1);

    // …and it links to an agent through the existing L02 mechanism.
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'API Contract Reviewer')));
    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_id: skill.id },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json<Array<{ skill_id: string }>>().some((l) => l.skill_id === skill.id)).toBe(
      true,
    );
    await app.close();
  });

  it('never renders rejected or pending candidates into a draft, whatever ids are posted', async () => {
    const app = await makeApp();
    const page = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json<ConventionsPage>();
    const idsBy = (status: ConventionCandidate['status']) =>
      page.candidates.filter((c) => c.status === status).map((c) => c.id);
    const acceptedIds = idsBy('accepted');
    const rejectedIds = idsBy('rejected');
    expect(acceptedIds.length).toBeGreaterThan(0);
    expect(rejectedIds.length).toBeGreaterThan(0);

    // A stale client cache (or a hand-crafted request) posts EVERY id — the
    // server must keep only the accepted ones out of it.
    const drafts = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill-draft`,
        payload: {
          candidate_ids: [...acceptedIds, ...rejectedIds, ...idsBy('pending')],
          mode: 'merged',
        },
      })
    ).json<ConventionSkillDraft[]>();
    expect(drafts).toHaveLength(1);
    expect([...drafts[0]!.candidate_ids].sort()).toEqual([...acceptedIds].sort());

    // Nothing accepted in the posted set → nothing to render.
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill-draft`,
      payload: { candidate_ids: [rejectedIds[0]!], mode: 'merged' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('records the failure on the scan row when the repo is not cloned', async () => {
    const app = await makeApp();
    const [uncloned] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'no-clone',
        fullName: 'acme/no-clone',
        defaultBranch: 'main',
        clonePath: null,
      })
      .returning();

    await app.inject({ method: 'POST', url: `/repos/${uncloned!.id}/conventions/extract` });
    await app.container.jobs.onIdle();

    const page = (
      await app.inject({ method: 'GET', url: `/repos/${uncloned!.id}/conventions` })
    ).json<ConventionsPage>();
    expect(page.scan).toMatchObject({ status: 'error', error: 'repo_not_cloned' });
    expect(page.candidates).toEqual([]);
    await app.close();
  });

  it('still returns config-derived candidates when every LLM call fails', async () => {
    // No key / provider blow-up must not produce an empty page that reads as
    // "this repo has no conventions".
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        codeIndex: new MockCodeIndex(),
        git: new MockGitClient({ files: FILES }),
        repoIntel: repoIntelStub,
        llm: {},
      },
    });

    const page = await runScan(app);
    expect(page.scan!.status).toBe('done');
    expect(page.candidates.some((c) => c.origin === 'config')).toBe(true);
    await app.close();
  });
});
