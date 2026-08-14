import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { agentRuns } from './runs';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    prIdx: index('reviews_pr_idx').on(t.prId, t.createdAt), // PR list + detail
    runIdx: index('reviews_run_idx').on(t.runId), // run ↔ review join
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    reviewIdx: index('findings_review_idx').on(t.reviewId), // hottest read + cascade
  }),
);

/**
 * L03 — the derived intent of one PR (owned by `modules/intent`).
 *
 * The drizzle property is `summary` while the SQL column stays `intent`: this
 * migration must be purely ADDITIVE, because `drizzle-kit generate` turns
 * interactive (and hangs on piped stdin) as soon as one table both gains and
 * drops columns in the same diff. Renaming the property is free; renaming the
 * column is not.
 *
 * No index: `pr_id` is the primary key and the only access path.
 * `confidence` uses drizzle's TS-only enum — no DB CHECK, repo-wide precedent.
 */
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  summary: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  riskAreas: jsonb('risk_areas')
    .$type<{ label: string; kind: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Per-source resolution outcome — ids and statuses only, never source text. */
  sources: jsonb('sources')
    .$type<{ kind: string; ref: string; status: string; chars: number }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] })
    .notNull()
    .default('low'),
  provider: text('provider'),
  model: text('model'),
  /** The commit this intent was derived from; `stale` is derived from it on read. */
  headSha: text('head_sha'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  /**
   * The classifier's full prompt + call stats. DB-only, never logged: it is a
   * deliberate, bounded exception to "no source text leaves the process", and
   * contains nothing that is not already in `pull_requests.body`.
   */
  trace: jsonb('trace'),
});

/**
 * L04 — the optional one-paragraph impact summary of a PR's blast radius
 * (owned by `modules/blast`).
 *
 * Written ONLY by `POST /pulls/:id/blast/summary`; the GET never spends a
 * token. Like `pr_intent` it carries no `workspace_id` — tenancy comes from
 * `BlastService` resolving the PR through `reviewRepo.getPull(workspaceId, …)`
 * before this table is touched.
 *
 * `stale` is NOT a column. It is derived on read against BOTH shas: a summary
 * rots when the PR moves (`head_sha`) and equally when the repo is re-indexed
 * underneath it (`indexed_sha`), and a single stored flag could not catch the
 * second. No index: `pr_id` is the primary key and the only access path.
 */
export const prBlastSummary = pgTable('pr_blast_summary', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  /** The PR head the summary described. */
  headSha: text('head_sha'),
  /** The `repo_index_state.last_indexed_sha` the underlying facts came from. */
  indexedSha: text('indexed_sha'),
  provider: text('provider'),
  model: text('model'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * L07 — the PR Brief of one PR (owned by `modules/brief`).
 *
 * `json` is the payload column and stays exactly as it was: the whole
 * `BriefView` envelope, replaced wholesale on every generation. The columns
 * beside it are the ones a READ has to answer without deserialising the payload
 * (provenance, staleness inputs, the degraded verdict).
 *
 * Like `pr_intent` and `pr_blast_summary` this table carries no `workspace_id`
 * — tenancy comes from the layer above, `BriefService` resolving the PR through
 * `reviewRepo.getPull(workspaceId, …)` and 404ing BEFORE this table is touched.
 *
 * `stale` is NOT a column. It is derived on read against BOTH shas: a brief rots
 * when the PR moves (`head_sha`) and equally when the repo is re-indexed
 * underneath it (`indexed_sha`), and a single stored flag could not catch the
 * second. No index: `pr_id` is the primary key and the only access path.
 */
export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  /** The PR head the brief was generated at. */
  headSha: text('head_sha'),
  /** The `repo_index_state.last_indexed_sha` the reach facts came from. */
  indexedSha: text('indexed_sha'),
  provider: text('provider'),
  model: text('model'),
  status: text('status', { enum: ['ok', 'degraded'] })
    .notNull()
    .default('ok'),
  degradedReason: text('degraded_reason'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  /**
   * The brief's full assembled prompt + call stats. DB-only, never logged — the
   * same deliberate, bounded exception `pr_intent.trace` already is, and the
   * observation point every prompt-shape criterion is checked against.
   */
  trace: jsonb('trace'),
});

/**
 * L07 — this PR's own per-generation timeline (owned by `modules/brief`).
 *
 * APPEND-ONLY. `BriefRepository` exposes no update and no delete for this
 * table: the guarantee is the absence of the code path, not discipline. One row
 * per generation, carrying the head SHA that generation ran at, so a PR whose
 * purpose drifted mid-flight reads as a sequence rather than as one overwritten
 * row. A projection of the brief, not the brief — storing the whole envelope per
 * commit makes the table grow without bound on a long-lived PR.
 *
 * Not to be confused with `BriefView.history`, which is prior overlapping PRs.
 *
 * Tenancy, as above, is `BriefService`'s job; the table carries no
 * `workspace_id`.
 *
 * ONE index on `(pr_id, generated_at)`: it is both the FK index Postgres does
 * not create automatically and the read path's ordering index.
 */
export const prBriefHistory = pgTable(
  'pr_brief_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    headSha: text('head_sha').notNull(),
    riskLevel: text('risk_level').notNull(),
    what: text('what').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    prIdx: index('pr_brief_history_pr_idx').on(t.prId, t.generatedAt),
  }),
);
