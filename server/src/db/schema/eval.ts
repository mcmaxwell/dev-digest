import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable('eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
});

/**
 * L06 - ONE execution of a whole eval case set.
 *
 * `eval_runs` alone cannot answer "old prompt vs new prompt": it is keyed per
 * case, carries no grouping, and records nothing about the agent config that
 * produced it. This row is that grouping, and `agent_version` is what makes two
 * of them comparable - it points at the `agent_versions` snapshot that pins the
 * system prompt, model, strategy and ordered skills the run actually used.
 *
 * The aggregate metrics are STORED rather than recomputed on read, so a run
 * stays readable after its cases have been edited or deleted. A run is a
 * historical fact; the case set it ran over is not.
 */
export const evalSuiteRuns = pgTable(
  'eval_suite_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** Agent config version at run time. Null only for a hand-written row. */
    agentVersion: integer('agent_version'),
    model: text('model'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    tracesPassed: integer('traces_passed'),
    tracesTotal: integer('traces_total'),
    /** Executions per case: 1 by default, >1 averages and takes a majority verdict. */
    repeats: integer('repeats').notNull().default(1),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    ownerIdx: index('eval_suite_runs_owner_idx').on(t.ownerId, t.ranAt),
    workspaceIdx: index('eval_suite_runs_workspace_idx').on(t.workspaceId, t.ranAt),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    /**
     * The suite run this row belongs to. Nullable: a single case can be run on
     * its own from the case list, and that row belongs to no suite.
     */
    suiteRunId: uuid('suite_run_id').references(() => evalSuiteRuns.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => ({
    caseIdx: index('eval_runs_case_idx').on(t.caseId, t.ranAt),
    suiteIdx: index('eval_runs_suite_idx').on(t.suiteRunId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
