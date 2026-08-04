import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  integer,
  vector,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One extraction run over a repo (L02 Conventions Extractor). Separate from the
 * candidates so the page can render "Detected from N sample files · last scan …"
 * and a running/idle state without inferring it from the rows.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'done', 'error'] })
      .notNull()
      .default('running'),
    /** Commit the samples were read at — candidates from an older sha are stale. */
    sha: text('sha'),
    provider: text('provider'),
    model: text('model'),
    sampleCount: integer('sample_count').notNull().default(0),
    candidateCount: integer('candidate_count').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.repoId) }),
);

export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    /** The scan that last PROPOSED this rule (re-scan re-points it). */
    scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'set null' }),
    category: text('category').notNull().default('structure'),
    rule: text('rule').notNull(),
    rationale: text('rationale'),
    /**
     * Normalized form of `rule`, unique per repo. This is what makes a re-scan an
     * UPSERT rather than a wipe: the user's accept/reject verdict survives, and
     * rejected keys feed back into the next scan's prompt.
     */
    ruleKey: text('rule_key').notNull(),
    /** ConventionEvidence[] — only occurrences verified against the clone. */
    evidence: jsonb('evidence').notNull().default([]),
    /** The probe regexes used for adherence scoring; kept for transparency. */
    probe: jsonb('probe'),
    confidence: doublePrecision('confidence'),
    /** support / (support + violations), measured with the probe. */
    adherence: doublePrecision('adherence'),
    support: integer('support'),
    violations: integer('violations'),
    origin: text('origin', { enum: ['llm', 'config'] })
      .notNull()
      .default('llm'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    edited: boolean('edited').notNull().default(false),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoIdx: index('conventions_repo_idx').on(t.repoId),
    repoRuleUq: uniqueIndex('conventions_repo_rule_key_uq').on(t.repoId, t.ruleKey),
  }),
);
