import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, or } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_SKILLS, SEED_AGENT_SKILLS } from './seed-skills.js';
import { SEED_CONVENTIONS, SEED_SCAN_SHA } from './seed-conventions.js';
import { SEED_EVAL_CASES } from './seed-eval-cases.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the five built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model, and the built-in skills
 * (seed-skills.ts) linked to their agents (L02).
 *
 * Course lessons populate the remaining tables (conventions, memory, eval, …)
 * once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset). Each carries the FIRST hunk of its patch — real
    // GitHub patches are truncated too, which is why `additions`/`deletions`
    // describe the whole file while the patch text shows only part of it.
    // The hunks are line-accurate where it matters: the seeded findings below
    // point at src/config.ts:12 and src/api/users.ts:45, and those are exactly
    // the lines these patches add, so the diff viewer can anchor them.
    await db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: 'src/middleware/ratelimit.ts',
        additions: 84,
        deletions: 0,
        patch: [
          '@@ -22,4 +22,13 @@',
          " import { redis } from '../lib/redis';",
          ' ',
          ' export async function rateLimit(req: Req, res: Res, next: Next) {',
          '+  const key = bucketKey(req);',
          '+  const count = await redis.incr(key);',
          '+  if (count === 1) await redis.expire(key, 3600);',
          '+',
          '+  if (count > limitFor(req)) {',
          '+    return res.status(429).end();',
          '+  }',
          '+',
          '+  return next();',
          ' }',
        ].join('\n'),
      },
      {
        prId: pr!.id,
        path: 'src/api/public/webhooks.ts',
        additions: 31,
        deletions: 6,
        patch: [
          '@@ -58,4 +58,9 @@',
          ' export async function webhookHandler(req: Req, res: Res) {',
          '-  const account = await db.accounts.find(req.accountId);',
          '-  return res.status(202).end();',
          '+  const target = req.body.callback_url;',
          '+  const account = await db.accounts.find(req.accountId);',
          '+  const token = account.apiToken;',
          '+',
          '+  await fetch(target, { headers: { Authorization: token } });',
          '+  return res.status(202).end();',
          ' }',
        ].join('\n'),
      },
      {
        prId: pr!.id,
        path: 'src/config.ts',
        additions: 4,
        deletions: 0,
        // The `sk_live_` literal lands on line 12 — the CRITICAL finding below.
        patch: [
          '@@ -8,5 +8,9 @@',
          " import { env } from './env';",
          ' ',
          ' export const config = {',
          '   port: Number(process.env.PORT ?? 3000),',
          '+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
          '+  rateLimitWindowMs: 60_000,',
          '+  rateLimitMax: 120,',
          '+  redisUrl: process.env.REDIS_URL,',
          ' };',
        ].join('\n'),
      },
      {
        prId: pr!.id,
        path: 'src/api/users.ts',
        additions: 7,
        deletions: 2,
        // The per-user query lands on line 45 — the WARNING finding below.
        patch: [
          '@@ -42,6 +42,11 @@',
          ' export async function listUsers(req: Req, res: Res) {',
          ' ',
          '   const users = await db.users.findMany();',
          '-  const result = users.map(toDto);',
          '-  return res.json(result);',
          '+  const result = [];',
          '+  for (const u of users) {',
          '+    const orders = await db.orders.findByUser(u.id);',
          '+    result.push({ ...toDto(u), orderCount: orders.length });',
          '+  }',
          '+',
          '+  return res.json(result);',
          ' }',
        ].join('\n'),
      },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Checks test quality: uncovered branches, missing corner cases, over-mocking, flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Flags breaking changes to routes, schemas, and caller-visible payloads.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- eval gold set for the Security Reviewer (L06) ----
  // Seeded so the harness has something to measure on a fresh machine, and so
  // `pnpm verify:l06` is deterministic. Idempotent by (owner, name): a re-seed
  // never stomps a case the user has since edited.
  const [securityAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (securityAgent) {
    for (const c of SEED_EVAL_CASES) {
      // Matched on the name OR the diff: keying on the name alone meant that
      // renaming a seeded case made the next re-seed insert a second copy under
      // the old name, next to the user's renamed one. The diff is what actually
      // identifies a case, and it survives a rename.
      const [existing] = await db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(
          and(
            eq(t.evalCases.ownerId, securityAgent.id),
            or(eq(t.evalCases.name, c.name), eq(t.evalCases.inputDiff, c.inputDiff)),
          ),
        );
      if (existing) continue;
      await db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: securityAgent.id,
        name: c.name,
        inputDiff: c.inputDiff,
        expectedOutput: { expectations: c.expectations },
        notes: c.notes,
      });
    }
  }

  // ---- built-in skills + agent links (L02) ----
  // Skill bodies live in ./seed-skills.ts. Links use onConflictDoNothing so a
  // re-seed never stomps a user's reordering of an existing link.
  const skillIdByName = new Map<string, string>();
  for (const s of SEED_SKILLS) {
    let [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!existing) {
      [existing] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: s.name,
          description: s.description,
          type: s.type,
          source: 'manual',
          body: s.body,
          enabled: true,
          version: 1,
        })
        .returning();
      await db
        .insert(t.skillVersions)
        .values({ skillId: existing!.id, version: 1, body: s.body })
        .onConflictDoNothing();
    }
    skillIdByName.set(s.name, existing!.id);
  }

  for (const [agentName, skillNames] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;
    for (const [i, skillName] of skillNames.entries()) {
      const skillId = skillIdByName.get(skillName);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- v1 config snapshots for the seeded agents ----
  // `AgentsRepository.insert` records an `agent_versions` row for every agent
  // it creates, but the seed inserts agent rows directly, so a seeded agent
  // used to claim `version: 1` with no snapshot behind it. Anything that reads
  // an agent's config AS IT WAS - the eval compare view (L06) reads the system
  // prompt of the version a run executed - then found nothing and had to
  // degrade. Written after the skill links so the snapshot pins the skills the
  // agent actually has.
  for (const a of seedAgents) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name!)));
    if (!agent) continue;
    const linked = await db
      .select({ skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id))
      .orderBy(t.agentSkills.order);
    await db
      .insert(t.agentVersions)
      .values({
        agentId: agent.id,
        version: agent.version,
        configJson: {
          provider: agent.provider,
          model: agent.model,
          system_prompt: agent.systemPrompt,
          output_schema: agent.outputSchema,
          strategy: agent.strategy,
          ci_fail_on: agent.ciFailOn,
          repo_intel: agent.repoIntel,
          skills: linked.map((l) => l.skillId),
        },
      })
      .onConflictDoNothing();
  }

  // ---- demo multi-agent run on its OWN pull request, #483 (L07) ----
  // Gives /repos/:id/multi-agent something to show before the first real run,
  // which needs a provider key and bills four model calls. Same reasoning as
  // the seeded review above: the screen is demoable and the browser flow is
  // deterministic without an LLM.
  //
  // It gets its own pull request rather than sharing #482 ON PURPOSE. The PR
  // timeline is newest-first and its accordion opens the newest run, so four
  // agent runs on #482 pushed the single seeded review out of the open slot
  // and flow 04 stopped finding the finding it asserts on. #482 is fixed
  // fixture data for flows 02/04/05/10; anything that adds runs to it changes
  // what those flows see. A second pull request is free and touches nothing.
  //
  // Its title must not CONTAIN #482's, because flows 02 and 04 select that row
  // with `find text`, which takes the first match.
  //
  // The four runs are chosen so the screen shows every state it can:
  //   config.ts:12       only Security flags it  -> a divergence, but NOT a
  //                      severity conflict, so the "show only conflicts"
  //                      filter correctly hides it
  //   webhooks.ts:62     CRITICAL vs WARNING     -> a real severity conflict
  //   users.ts:45-52     CRITICAL vs WARNING     -> a second one
  //   Test Quality       failed                  -> a failed column beside
  //                      succeeded ones, contributing `no_opinion`
  // The line numbers match this PR's patches below, so every finding anchors
  // in the diff viewer.
  let [maPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 483)));
  if (!maPr) {
    [maPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 483,
        title: 'Harden the public webhook callback path',
        author: 'dan.okonkwo',
        branch: 'fix/webhook-callback-allowlist',
        base: 'main',
        headSha: 'b7c8d9e0f1a2',
        additions: 42,
        deletions: 8,
        filesCount: 3,
        status: 'needs_review',
        body: 'Validate the webhook callback target and stop forwarding the account token to it.',
      })
      .returning();

    await db.insert(t.prFiles).values([
      {
        prId: maPr!.id,
        path: 'src/api/public/webhooks.ts',
        additions: 24,
        deletions: 6,
        // The token-forwarding fetch lands on line 62 - the conflict below.
        patch: [
          '@@ -58,4 +58,9 @@',
          ' export async function webhookHandler(req: Req, res: Res) {',
          '-  const account = await db.accounts.find(req.accountId);',
          '-  return res.status(202).end();',
          '+  const target = req.body.callback_url;',
          '+  const account = await db.accounts.find(req.accountId);',
          '+  const token = account.apiToken;',
          '+',
          '+  await fetch(target, { headers: { Authorization: token } });',
          '+  return res.status(202).end();',
          ' }',
        ].join('\n'),
      },
      {
        prId: maPr!.id,
        path: 'src/config.ts',
        additions: 4,
        deletions: 0,
        // The `sk_live_` literal lands on line 12 - the divergence below.
        patch: [
          '@@ -8,5 +8,9 @@',
          " import { env } from './env';",
          ' ',
          ' export const config = {',
          '   port: Number(process.env.PORT ?? 3000),',
          '+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
          '+  webhookAllowlist: process.env.WEBHOOK_ALLOWLIST,',
          '+  webhookTimeoutMs: 5_000,',
          '+  redisUrl: process.env.REDIS_URL,',
          ' };',
        ].join('\n'),
      },
      {
        prId: maPr!.id,
        path: 'src/api/users.ts',
        additions: 7,
        deletions: 2,
        // The per-user query lands on line 45 - the second conflict below.
        patch: [
          '@@ -42,6 +42,11 @@',
          ' export async function listUsers(req: Req, res: Res) {',
          ' ',
          '   const users = await db.users.findMany();',
          '-  const result = users.map(toDto);',
          '-  return res.json(result);',
          '+  const result = [];',
          '+  for (const u of users) {',
          '+    const orders = await db.orders.findByUser(u.id);',
          '+    result.push({ ...toDto(u), orderCount: orders.length });',
          '+  }',
          '+',
          '+  return res.json(result);',
          ' }',
        ].join('\n'),
      },
    ]);

    await db.insert(t.prCommits).values({
      prId: maPr!.id,
      sha: 'b7c8d9e0f1a2',
      message: 'Allowlist webhook callback hosts',
      author: 'dan.okonkwo',
    });
  }

  const [existingMultiRun] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, maPr!.id)));
  if (!existingMultiRun) {
    const agentRows = await db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    const byName = new Map(agentRows.map((a) => [a.name, a]));

    /** One seeded column: the run, its review, and the findings under it. */
    interface SeedColumn {
      agentName: string;
      status: 'done' | 'failed';
      error?: string;
      score?: number;
      durationMs?: number;
      costUsd?: number;
      verdict?: string;
      summary?: string;
      findings?: Array<Omit<typeof t.findings.$inferInsert, 'reviewId'>>;
    }

    const columns: SeedColumn[] = [
      {
        agentName: 'Security Reviewer',
        status: 'done',
        score: 54,
        durationMs: 41_200,
        costUsd: 0.0212,
        verdict: 'request_changes',
        summary:
          'The callback is still not allowlisted, and the account API token is handed to whatever host the caller names. A live Stripe key also sits in config.',
        findings: [
          {
            file: 'src/api/public/webhooks.ts',
            startLine: 62,
            endLine: 62,
            severity: 'CRITICAL',
            category: 'security',
            title: 'Account API token sent to a caller-controlled URL',
            rationale:
              'callback_url comes from the request body and is fetched with the account token in the Authorization header, so a caller can name any host and receive the credential.',
            suggestion: 'Allowlist the callback host and never forward the account token to it.',
            confidence: 0.94,
          },
          {
            file: 'src/config.ts',
            startLine: 12,
            endLine: 12,
            severity: 'CRITICAL',
            category: 'security',
            title: 'Hardcoded Stripe secret key in config',
            rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
            suggestion: 'Move to env var and rotate the key immediately.',
            confidence: 0.98,
          },
        ],
      },
      {
        agentName: 'General Reviewer',
        status: 'done',
        score: 71,
        durationMs: 28_400,
        costUsd: 0.0148,
        verdict: 'comment',
        summary:
          'The allowlist config is in place but nothing reads it yet, and the user list still does per-row queries.',
        findings: [
          {
            file: 'src/api/public/webhooks.ts',
            startLine: 62,
            endLine: 62,
            severity: 'WARNING',
            category: 'correctness',
            title: 'Callback URL is still unvalidated',
            rationale: 'webhookAllowlist is added to config but never consulted before the fetch.',
            suggestion: 'Check the target host against the allowlist before calling it.',
            confidence: 0.72,
          },
          {
            file: 'src/api/users.ts',
            startLine: 45,
            endLine: 52,
            severity: 'WARNING',
            category: 'perf',
            title: 'Per-user query inside the list loop',
            rationale: 'The loop issues one orders query per user.',
            suggestion: 'Batch the orders lookup.',
            confidence: 0.81,
          },
        ],
      },
      {
        agentName: 'Performance Reviewer',
        status: 'done',
        score: 63,
        durationMs: 33_100,
        costUsd: 0.0163,
        verdict: 'request_changes',
        summary:
          'The N+1 in the user list is the blocker: this endpoint is on the hot path and the per-row query multiplies with every user.',
        findings: [
          {
            file: 'src/api/users.ts',
            startLine: 45,
            endLine: 52,
            severity: 'CRITICAL',
            category: 'perf',
            title: 'N+1 query in user list endpoint',
            rationale:
              'One orders query per user on a hot endpoint. At a few hundred users this is already thousands of queries per minute.',
            suggestion: 'Use a single IN query and group in memory.',
            confidence: 0.91,
          },
        ],
      },
      {
        agentName: 'Test Quality Reviewer',
        status: 'failed',
        error: 'provider returned 429 (rate limited) after 3 retries',
      },
    ];

    const [multiRun] = await db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: maPr!.id })
      .returning();

    for (const col of columns) {
      const agent = byName.get(col.agentName);
      if (!agent) continue;

      const [run] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: agent.id,
          prId: maPr!.id,
          multiAgentRunId: multiRun!.id,
          provider: agent.provider,
          model: agent.model,
          status: col.status,
          error: col.error ?? null,
          score: col.score ?? null,
          durationMs: col.durationMs ?? null,
          costUsd: col.costUsd ?? null,
          findingsCount: col.findings?.length ?? null,
          source: 'local',
        })
        .returning();

      // A failed run has no review and no findings - that is what makes its
      // column read `no_opinion` rather than `did_not_flag`.
      if (col.status !== 'done') continue;

      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: maPr!.id,
          agentId: agent.id,
          runId: run!.id,
          kind: 'review',
          verdict: col.verdict ?? null,
          summary: col.summary ?? null,
          score: col.score ?? null,
          model: agent.model,
        })
        .returning();

      if (col.findings?.length) {
        await db
          .insert(t.findings)
          .values(col.findings.map((f) => ({ ...f, reviewId: review!.id })));
      }
    }
  }

  // ---- demo conventions + their scan (L02 conventions extractor) ----
  // Gives /conventions something to show before the first real scan (which
  // needs a cloned repo and a model key), and keeps the browser e2e flow
  // deterministic — no LLM call, same as the seeded review above.
  const [existingScan] = await db
    .select()
    .from(t.conventionScans)
    .where(eq(t.conventionScans.repoId, repoId));
  if (!existingScan) {
    const [scan] = await db
      .insert(t.conventionScans)
      .values({
        workspaceId,
        repoId,
        status: 'done',
        sha: SEED_SCAN_SHA,
        provider: 'openrouter',
        model: 'seed',
        sampleCount: 18,
        candidateCount: SEED_CONVENTIONS.length,
        finishedAt: new Date(),
      })
      .returning();

    await db
      .insert(t.conventions)
      .values(
        SEED_CONVENTIONS.map((c) => ({
          workspaceId,
          repoId,
          scanId: scan!.id,
          category: c.category,
          rule: c.rule,
          rationale: c.rationale,
          ruleKey: c.ruleKey,
          evidence: c.evidence,
          confidence: c.confidence,
          adherence: c.adherence,
          support: c.support,
          violations: c.violations,
          origin: c.origin,
          status: 'pending' as const,
        })),
      )
      .onConflictDoNothing();
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
