/**
 * L06 onboarding tour — generation, degradation and tenancy, end to end through
 * `buildApp` + `app.inject`.
 *
 * Every case here comes from an acceptance criterion in
 * `docs/specs/L06-onboarding-tour.md`; the criterion is named on the test.
 *
 * The clone is a `mkdtemp` fixture tree and `overrides.git` reads from it, so
 * "does this path exist at head_sha" is answered by a real filesystem without
 * touching `server/clones/**`. Every provider the generation can resolve is
 * mocked AND `secrets: new MockSecretsProvider({})` is passed — without the
 * latter the container falls back to the developer's `~/.devdigest/secrets.json`
 * and spends real money.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, readdir, readFile as readFileFs, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { z } from 'zod';
import type {
  CompletionRequest,
  CompletionResult,
  IssueMeta,
  LLMProvider,
  ModelInfo,
  Onboarding,
  OnboardingPage,
  RepoRef,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import type { RepoIntel } from '../repo-intel/types.js';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockEmbedder, MockGitClient, MockSecretsProvider } from '../../adapters/mocks.js';
import { ONBOARDING_SCHEMA_NAME } from './schemas.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// --- the fixture clone ------------------------------------------------------

const ENV_SECRET = 'sk_live_EXAMPLE_KEY_LEFT_IN_THE_EXAMPLE_FILE';

const CLONE_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'payments-api', scripts: { dev: 'tsx watch src/server.ts' } }),
  Makefile: 'up:\n\tdocker compose up -d\n',
  'docker-compose.yml': 'services:\n  postgres:\n    image: pgvector/pgvector:pg16\n',
  '.env.example': `DATABASE_URL=postgres://u:p@localhost/db\nSTRIPE_KEY=${ENV_SECRET}\n`,
  'README.md': '# payments-api\n\nA rate-limited public API.',
  'src/server.ts': 'export const app = 1;\n',
  'src/middleware/auth.ts': '// TODO: rotate the signing key\nexport const auth = 1;\n',
  'src/lib/redis.ts': 'export const redis = 1;\n',
};

const RANKED = ['src/server.ts', 'src/middleware/auth.ts', 'src/lib/redis.ts'];

/** A tour draft the model "returns"; every path in it is real but one. */
const DRAFT = {
  architecture: {
    title: 'Architecture overview',
    body:
      'ONBOARDING-TOUR-MARKER. Requests enter through `src/server.ts` and pass ' +
      'the guard in `src/middleware/auth.ts`. The queue lives in `src/services/invented.ts`.',
    links: [
      { label: 'Entry point', path: 'src/server.ts' },
      { label: 'Ghost', path: 'src/services/ghost.ts' },
    ],
    diagram: 'flowchart TD\n  A["client"] --> B["api"]',
  },
  critical_paths: {
    title: 'Critical paths',
    body: '',
    links: [],
    items: [
      { path: 'src/middleware/auth.ts', reason: 'Every request passes through it.' },
      { path: 'src/services/invented.ts', reason: 'Sounds important.' },
    ],
  },
  run_locally: {
    title: 'How to run locally',
    body: '',
    links: [],
    items: [
      { command: 'npm run dev', source: 'package.json' },
      { command: 'bin/setup --all', source: 'bin/setup' },
    ],
  },
  reading_path: {
    title: 'Guided reading path',
    body: '',
    links: [],
    items: [
      { path: 'src/server.ts', reason: 'Where a request enters.' },
      { path: 'src/lib/redis.ts', reason: 'The shared cache.' },
    ],
  },
  first_tasks: {
    title: 'First tasks',
    body: '',
    links: [],
    items: [
      {
        title: 'Rotate the signing key',
        origin: 'todo' as const,
        path: 'src/middleware/auth.ts',
        line: 1,
        issue_number: null,
      },
      { title: 'Document the headers', origin: 'issue' as const, path: null, line: null, issue_number: 311 },
    ],
  },
};

const REVIEW_FIXTURE: Review = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };

const INTENT_FIXTURE = {
  summary: 'Adds rate limiting.',
  kind: 'feature',
  risk_areas: [],
  out_of_scope: [],
  confidence: 0.9,
};

// --- a provider that counts, and can be made to fail or hang ---------------

type LlmMode = 'ok' | 'reject' | 'gated';

class CountingLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  public structuredCalls: { schemaName: string; model: string }[] = [];
  public mode: LlmMode = 'ok';
  public costUsd: number | null = 0.0041;
  private gate: (() => void) | null = null;
  private waiters: (() => void)[] = [];

  get onboardingCalls(): number {
    return this.structuredCalls.filter((c) => c.schemaName === ONBOARDING_SCHEMA_NAME).length;
  }

  reset(): void {
    this.structuredCalls = [];
    this.mode = 'ok';
    this.costUsd = 0.0041;
    this.gate = null;
    this.waiters = [];
  }

  /**
   * Resolves once a gated call is really sitting at the gate. Releasing before
   * the generation has reached the provider would let it run to completion and
   * the test would pass for the wrong reason.
   */
  whenGated(): Promise<void> {
    if (this.gate) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Let a gated call through. */
  release(): void {
    const gate = this.gate;
    this.gate = null;
    gate?.();
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
    const onboarding = req.schemaName === ONBOARDING_SCHEMA_NAME;

    if (onboarding && this.mode === 'reject') {
      throw new Error(`provider refused (key sk_live_SHOULD_BE_SCRUBBED)`);
    }
    if (onboarding && this.mode === 'gated') {
      await new Promise<void>((resolve) => {
        this.gate = resolve;
        for (const waiter of this.waiters.splice(0)) waiter();
      });
    }

    const fixture =
      req.schemaName === ONBOARDING_SCHEMA_NAME
        ? DRAFT
        : req.schemaName === 'Intent'
          ? INTENT_FIXTURE
          : REVIEW_FIXTURE;
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);

    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 24_110,
      tokensOut: 1_830,
      costUsd: this.costUsd,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }
}

// --- stubs for the ports the generation reads ------------------------------

interface IntelConfig {
  filesIndexed: number;
  filesSkipped: number;
  status: 'full' | 'partial' | 'degraded' | 'failed';
  graph: boolean;
}

const intel: IntelConfig = { filesIndexed: 1200, filesSkipped: 3, status: 'full', graph: true };

const repoIntelStub = {
  async getIndexState() {
    return {
      status: intel.status,
      filesIndexed: intel.filesIndexed,
      filesSkipped: intel.filesSkipped,
      lastIndexedSha: 'index-sha-1',
      durationMs: 10,
      repoId: 'x',
      indexerVersion: 1,
      updatedAt: new Date(),
    };
  },
  async getRepoMap() {
    return { text: 'src/\n  server.ts\n  middleware/auth.ts', tokens: 12, cached: true };
  },
  async getTopFilesByRank() {
    return intel.graph ? [...RANKED] : [];
  },
  async getCriticalPaths() {
    return intel.graph ? [['src/server.ts', 'src/middleware/auth.ts']] : [];
  },
  async getFileRank(_repoId: string, paths: string[]) {
    return paths.map((path, i) => ({ path, percentile: 0.99 - i / 100 }));
  },
} as unknown as RepoIntel;

class FixtureGitClient extends MockGitClient {
  public head = 'head-sha-0000001';
  public commits = [
    { sha: 'head-sha-0000001', message: 'latest', author: 'a', date: '2026-06-03' },
  ];

  constructor(private root: string) {
    super({});
  }
  override clonePathFor(): string {
    return this.root;
  }
  override async currentHead(): Promise<string> {
    return this.head;
  }
  override async readFile(_repo: RepoRef, path: string): Promise<string> {
    try {
      return await readFileFs(join(this.root, path), 'utf8');
    } catch {
      // Same shape `MockGitClient` uses for a missing path: blank, not a throw.
      return '';
    }
  }
  override async listFiles(): Promise<string[]> {
    return Object.keys(CLONE_FILES);
  }
  override async log(): Promise<{ sha: string; message: string; author: string; date: string }[]> {
    return this.commits;
  }
}

const githubState: { issues: IssueMeta[]; fail: boolean } = {
  issues: [{ number: 311, title: 'Document the rate-limit headers', body: '', state: 'open' }],
  fail: false,
};

const githubStub = {
  async listIssues(): Promise<IssueMeta[]> {
    if (githubState.fail) throw new Error('Bad credentials');
    return githubState.issues;
  },
  async listPullRequests() {
    return [];
  },
  async getPullRequest() {
    throw new Error('not used');
  },
  async currentLogin() {
    return 'mock-user';
  },
} as unknown as import('@devdigest/shared').GitHubClient;

/** Markers live in ranked files, which is the only place the grep looks. */
const codeIndexStub = {
  async grep() {
    return [
      { path: 'src/middleware/auth.ts', line: 1, text: '// TODO: rotate the signing key' },
      { path: 'node_modules/left-pad/index.js', line: 3, text: '// TODO: vendored, must not surface' },
    ];
  },
  async symbols() {
    return [];
  },
  async references() {
    return [];
  },
} as unknown as import('@devdigest/shared').CodeIndex;

// --- helpers ---------------------------------------------------------------

async function writeAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

/** Every file under `root`, with its bytes and mtime — an unchanged-clone probe. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const [body, meta] = await Promise.all([readFileFs(full, 'utf8'), stat(full)]);
        out[relative(root, full)] = `${meta.mtimeMs}:${body}`;
      }
    }
  }
  await walk(root);
  return out;
}

d('L06 onboarding tour (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let root: string;
  let git: FixtureGitClient;
  const llm = new CountingLLMProvider();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    root = await mkdtemp(join(tmpdir(), 'ob-clone-'));
    for (const [path, body] of Object.entries(CLONE_FILES)) await writeAt(root, path, body);

    const [repo] = await pg.handle.db
      .update(t.repos)
      .set({ clonePath: root })
      .where(eq(t.repos.fullName, 'acme/payments-api'))
      .returning();
    repoId = repo!.id;

    git = new FixtureGitClient(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await pg?.stop();
  });

  beforeEach(() => {
    llm.reset();
    githubState.fail = false;
    githubState.issues = [{ number: 311, title: 'Document the rate-limit headers', body: '', state: 'open' }];
    intel.filesIndexed = 1200;
    intel.filesSkipped = 3;
    intel.status = 'full';
    intel.graph = true;
    git.head = 'head-sha-0000001';
  });

  function makeApp(over: { db?: typeof pg.handle.db } = {}) {
    return buildApp({
      config: config(),
      db: over.db ?? pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git,
        codeIndex: codeIndexStub,
        github: githubStub,
        repoIntel: repoIntelStub,
        // Every provider the generation or a review can resolve, so no path
        // reaches a real key.
        secrets: new MockSecretsProvider({}),
        llm: { openai: llm, anthropic: llm, openrouter: llm },
      },
    });
  }

  type App = Awaited<ReturnType<typeof buildApp>>;

  async function generate(app: App, id = repoId): Promise<OnboardingPage> {
    const res = await app.inject({ method: 'POST', url: `/repos/${id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    await app.container.jobs.onIdle();
    return read(app, id);
  }

  async function read(app: App, id = repoId): Promise<OnboardingPage> {
    const res = await app.inject({ method: 'GET', url: `/repos/${id}/onboarding` });
    expect(res.statusCode).toBe(200);
    return res.json<OnboardingPage>();
  }

  function tourOf(page: OnboardingPage): Onboarding {
    if (!page.tour) throw new Error('expected a stored tour');
    return page.tour;
  }

  it('generates one tour with exactly ONE structured model call, and records what it cost (AC-12, AC-13, AC-14, AC-52)', async () => {
    const app = await makeApp();
    const page = await generate(app);
    const tour = tourOf(page);

    // AC-12: one call for the generation, and no second one anywhere.
    expect(llm.onboardingCalls).toBe(1);
    expect(tour.usage?.calls).toBe(1);

    // AC-14: the provider and model come from the `onboarding` feature-model
    // setting, which falls back to the registry default.
    expect(tour.usage).toMatchObject({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });

    // AC-13 / AC-52: attempts, tokens and cost are all on the record.
    expect(tour.usage!.attempts).toBeGreaterThanOrEqual(1);
    expect(tour.usage!.attempts).toBeLessThanOrEqual(3);
    expect(tour.usage).toMatchObject({ tokens_in: 24_110, tokens_out: 1_830, cost_usd: 0.0041 });
    expect(tour.usage!.duration_ms).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it('records the clone head as the tour commit and renders five sections (AC-5, AC-17, AC-18)', async () => {
    const app = await makeApp();
    const tour = tourOf(await generate(app));

    expect(tour.head_sha).toBe('head-sha-0000001');
    expect(tour.index_sha).toBe('index-sha-1');
    expect(tour.files_indexed).toBe(1200);
    expect(tour.files_skipped).toBe(3);
    expect(tour.sections.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
    expect(tour.status).toBe('ready');
    expect(tour.degraded_reasons).toEqual([]);

    await app.close();
  });

  it('drops every row and step whose path does not exist at head_sha, and counts the drops (AC-25, AC-32, AC-33)', async () => {
    const app = await makeApp();
    const tour = tourOf(await generate(app));

    const critical = tour.sections.find((s) => s.kind === 'critical_paths')!;
    const run = tour.sections.find((s) => s.kind === 'run_locally')!;
    if (critical.kind !== 'critical_paths' || run.kind !== 'run_locally') throw new Error('kind');

    expect(critical.items.map((i) => i.path)).toEqual(['src/middleware/auth.ts']);
    expect(run.items.map((i) => i.source)).toEqual(['package.json']);
    expect(tour.dropped_rows).toBeGreaterThan(0);
    expect(tour.dropped_steps).toBe(1);

    // AC-34: the invented prose path is left plain; the real one is linked and
    // pinned to the generation commit (AC-35).
    const arch = tour.sections.find((s) => s.kind === 'architecture')!;
    expect(arch.body).toContain(`https://github.com/acme/payments-api/blob/${tour.head_sha}/src/server.ts`);
    expect(arch.body).not.toContain('blob/head-sha-0000001/src/services/invented.ts');
    expect(arch.links.map((l) => l.path)).toEqual(['src/server.ts']);

    await app.close();
  });

  it('builds first tasks only from markers we found and issues we fetched (AC-28, AC-29)', async () => {
    const app = await makeApp();
    const tour = tourOf(await generate(app));

    const tasks = tour.sections.find((s) => s.kind === 'first_tasks')!;
    if (tasks.kind !== 'first_tasks') throw new Error('kind');

    expect(tasks.items).toEqual([
      expect.objectContaining({ origin: 'todo', path: 'src/middleware/auth.ts', line: 1 }),
      expect.objectContaining({ origin: 'issue', issue_number: 311 }),
    ]);
    // The vendored marker never reaches the tour.
    expect(JSON.stringify(tasks.items)).not.toContain('node_modules');

    await app.close();
  });

  it('records issues_unavailable and still produces marker tasks when GitHub cannot be read (AC-31)', async () => {
    githubState.fail = true;
    const app = await makeApp();
    const tour = tourOf(await generate(app));

    expect(tour.degraded_reasons).toContain('issues_unavailable');
    expect(tour.status).toBe('degraded');

    const tasks = tour.sections.find((s) => s.kind === 'first_tasks')!;
    if (tasks.kind !== 'first_tasks') throw new Error('kind');
    expect(tasks.items.some((i) => i.origin === 'todo')).toBe(true);
    expect(tasks.items.some((i) => i.origin === 'issue')).toBe(false);

    await app.close();
  });

  it('falls back to the heuristic and marks both graph sections when there is no index (AC-56, AC-57, AC-58)', async () => {
    intel.graph = false;
    intel.filesIndexed = 0;
    intel.status = 'failed';

    const app = await makeApp();
    const tour = tourOf(await generate(app));

    expect(tour.degraded_reasons).toContain('no_index');

    const critical = tour.sections.find((s) => s.kind === 'critical_paths')!;
    const reading = tour.sections.find((s) => s.kind === 'reading_path')!;
    if (critical.kind !== 'critical_paths' || reading.kind !== 'reading_path') throw new Error('kind');

    // Populated from directory prominence / entry points, and marked.
    expect(reading.items.length).toBeGreaterThan(0);
    expect(critical.items.length).toBeGreaterThan(0);
    expect(reading.status).toBe('no_graph');
    expect(critical.status).toBe('no_graph');

    // Still a readable page, not an error (AC-63).
    expect(tour.sections).toHaveLength(5);

    await app.close();
  });

  it('states each degraded reason exactly once (AC-59)', async () => {
    githubState.fail = true;
    intel.graph = false;
    intel.filesIndexed = 0;
    intel.status = 'failed';

    const app = await makeApp();
    const tour = tourOf(await generate(app));

    expect(new Set(tour.degraded_reasons).size).toBe(tour.degraded_reasons.length);

    await app.close();
  });

  it('uses no file excerpts above the 50,000-file cutoff (AC-10)', async () => {
    intel.filesIndexed = 60_000;
    const app = await makeApp();
    const tour = tourOf(await generate(app));

    expect(tour.excerpts_used).toBe(0);
    expect(tour.degraded_reasons).toContain('repo_too_large');

    await app.close();
  });

  it('persists a readable degraded tour when the model call fails, and a retry replaces it (AC-15, AC-60, AC-61, AC-62, AC-63)', async () => {
    const app = await makeApp();

    llm.mode = 'reject';
    const failed = tourOf(await generate(app));

    expect(failed.status).toBe('degraded');
    expect(failed.degraded_reasons).toContain('model_failed');
    expect(failed.sections).toHaveLength(5);
    // Deterministic content survives the failure: the run steps came from the
    // manifest, not from the model.
    const run = failed.sections.find((s) => s.kind === 'run_locally')!;
    if (run.kind !== 'run_locally') throw new Error('kind');
    expect(run.items.map((i) => i.source)).toContain('package.json');
    // AC-54: no cost is stated as no cost, never as zero.
    expect(failed.usage).toMatchObject({ calls: 1, tokens_in: null, tokens_out: null, cost_usd: null });

    // AC-61: a reload renders the same content, from storage.
    const reloaded = await makeApp();
    expect(tourOf(await read(reloaded)).status).toBe('degraded');
    await reloaded.close();

    // AC-62: the retry that succeeds replaces the degraded tour.
    llm.mode = 'ok';
    const retried = tourOf(await generate(app));
    expect(retried.status).toBe('ready');
    expect(retried.degraded_reasons).toEqual([]);

    await app.close();
  });

  it('shows token counts and no cost when the provider prices nothing (AC-54)', async () => {
    const app = await makeApp();
    llm.costUsd = null;
    const tour = tourOf(await generate(app));

    expect(tour.usage).toMatchObject({ tokens_in: 24_110, tokens_out: 1_830, cost_usd: null });

    await app.close();
  });

  it('refuses a second generation while one is in flight, and makes no second call (AC-16)', async () => {
    const app = await makeApp();
    llm.mode = 'gated';

    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(first.statusCode).toBe(200);
    expect(first.json<OnboardingPage>().generation.status).toBe('running');

    // The first generation is genuinely mid-flight — parked inside the model
    // call — when the second request arrives.
    await llm.whenGated();
    const second = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(second.statusCode).toBe(409);
    expect(JSON.stringify(second.json())).toMatch(/already running/i);

    llm.release();
    await app.container.jobs.onIdle();

    // One call for the two requests, and the surviving generation is the FIRST
    // one, which completed normally rather than being abandoned.
    expect(llm.onboardingCalls).toBe(1);
    expect(tourOf(await read(app)).status).toBe('ready');

    await app.close();
  });

  it('keeps ONE model call when the handler throws AFTER the call succeeded (AC-12)', async () => {
    // The regression the job runner makes possible: `enqueue` wraps every
    // handler in `withRetry`, whose default re-runs the WHOLE handler — and
    // therefore re-issues a model call that already succeeded and already cost
    // money. The throw below is retryable-shaped (status 503) precisely so the
    // ambient retry would fire if the kind had not registered at `retries: 0`.
    let failWrite = true;
    const flaky = new Proxy(pg.handle.db, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          return (table: unknown) => {
            if (table === t.onboarding && failWrite) {
              throw Object.assign(new Error('write failed'), { status: 503 });
            }
            return target.insert(table as never);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as typeof pg.handle.db;

    const app = await makeApp({ db: flaky });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    await app.container.jobs.onIdle();

    expect(llm.onboardingCalls).toBe(1);

    // …and the guard is load-bearing rather than decorative: the SAME error
    // shape, thrown from a kind that did not opt out, IS retried by the runner.
    let ambientRuns = 0;
    app.container.jobs.register('onboarding-ambient-retry-probe', async () => {
      ambientRuns += 1;
      throw Object.assign(new Error('boom'), { status: 503 });
    });
    const probe = await app.container.jobs.enqueue(
      workspaceId,
      'onboarding-ambient-retry-probe',
      {},
    );
    await probe.done.catch(() => undefined);
    expect(ambientRuns).toBeGreaterThan(1);

    failWrite = false;
    await app.close();
  });

  it('replaces the stored tour rather than accumulating one per generation (AC-1, AC-49)', async () => {
    const app = await makeApp();
    await generate(app);
    const second = tourOf(await generate(app));

    const rows = await pg.handle.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.json as Onboarding).generated_at).toBe(second.generated_at);

    await app.close();
  });

  it('never regenerates on its own, and reports staleness by commit once the head moves (AC-47, AC-48)', async () => {
    const app = await makeApp();
    const before = tourOf(await generate(app));

    // The head moves the way a resync moves it; nothing else happens.
    git.head = 'head-sha-0000003';
    git.commits = [
      { sha: 'head-sha-0000003', message: 'c3', author: 'a', date: '2026-06-05' },
      { sha: 'head-sha-0000002', message: 'c2', author: 'a', date: '2026-06-04' },
      { sha: 'head-sha-0000001', message: 'c1', author: 'a', date: '2026-06-03' },
    ];

    const page = await read(app);
    await read(app);

    expect(page.stale).toBe(true);
    expect(page.commits_behind).toBe(2);
    expect(page.current_head_sha).toBe('head-sha-0000003');
    // Reading does not regenerate: same tour, same commit, same timestamp.
    expect(tourOf(page).generated_at).toBe(before.generated_at);
    expect(tourOf(page).head_sha).toBe('head-sha-0000001');
    expect(llm.onboardingCalls).toBe(1);

    git.commits = [{ sha: 'head-sha-0000001', message: 'latest', author: 'a', date: '2026-06-03' }];
    await app.close();
  });

  it('writes nothing into the clone while generating, regenerating and reading (AC-68)', async () => {
    const app = await makeApp();
    const before = await snapshot(root);

    await generate(app);
    await generate(app);
    await read(app);

    expect(await snapshot(root)).toEqual(before);

    await app.close();
  });

  it('renders the prerequisite state and refuses generation without a clone (AC-37)', async () => {
    const app = await makeApp();
    const [bare] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `uncloned-${Date.now()}`,
        fullName: `acme/uncloned-${Date.now()}`,
      })
      .returning();

    const page = await read(app, bare!.id);
    expect(page.clone).toBe('absent');
    expect(page.tour).toBeNull();

    const generateRes = await app.inject({
      method: 'POST',
      url: `/repos/${bare!.id}/onboarding/generate`,
    });
    expect(generateRes.statusCode).toBe(409);
    expect(llm.onboardingCalls).toBe(0);

    await app.close();
  });

  it('removes the tour when the repository is removed from the workspace (AC-51)', async () => {
    const app = await makeApp();
    const [throwaway] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `doomed-${Date.now()}`,
        fullName: `acme/doomed-${Date.now()}`,
        clonePath: root,
      })
      .returning();

    await generate(app, throwaway!.id);
    expect(
      await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, throwaway!.id)),
    ).toHaveLength(1);

    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, throwaway!.id));
    expect(
      await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, throwaway!.id)),
    ).toEqual([]);

    await app.close();
  });

  it('neither reads nor generates a tour for a repository outside the workspace (AC-69)', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'private',
        fullName: `other/private-${Date.now()}`,
        clonePath: root,
      })
      .returning();

    expect(
      (await app.inject({ method: 'GET', url: `/repos/${foreign!.id}/onboarding` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/repos/${foreign!.id}/onboarding/generate` }))
        .statusCode,
    ).toBe(404);
    expect(llm.onboardingCalls).toBe(0);

    await app.close();
  });

  it('accepts no client-supplied path on either route (AC-67)', async () => {
    const app = await makeApp();

    // A path-shaped query parameter changes nothing and reads nothing: the
    // read list is a module constant.
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/onboarding?path=${encodeURIComponent('../../../etc/passwd')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('root:');

    await app.close();
  });

  it('puts no onboarding text into a review prompt on a repository that HAS a tour (AC-4)', async () => {
    const app = await makeApp();
    const tour = tourOf(await generate(app));
    expect(JSON.stringify(tour)).toContain('ONBOARDING-TOUR-MARKER');

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 900 + Math.floor(Math.random() * 90),
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
    await pg.handle.db.insert(t.prFiles).values({
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
        payload: { name: `Sec-${Date.now()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const started = await app.inject({
      method: 'POST',
      url: `/pulls/${pr!.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(started.statusCode).toBe(200);
    const runId = started.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    // Poll for the TRACE, not for the run status: the status flips inside the
    // persistence transaction while `saveRunTrace` runs just after it, so a
    // read taken on the status alone races (server/INSIGHTS.md).
    let trace: { prompt_assembly?: Record<string, unknown> } = {};
    for (let i = 0; i < 100; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (res.statusCode === 200 && res.json()?.prompt_assembly) {
        trace = res.json();
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(trace.prompt_assembly, 'no run trace was written').toBeDefined();
    const assembly = JSON.stringify(trace.prompt_assembly);

    // Not one character of the tour reaches the review prompt, and the
    // assembly gained no onboarding slot.
    expect(assembly).not.toContain('ONBOARDING-TOUR-MARKER');
    expect(assembly).not.toContain('Guided reading path');
    expect(Object.keys(trace.prompt_assembly)).not.toContain('onboarding');
    expect(Object.keys(trace.prompt_assembly).join(',')).not.toMatch(/onboarding|tour/i);

    await app.close();
  });
});
