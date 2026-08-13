/**
 * L05 project context — discovered repository documents and the attachments
 * that point at them.
 *
 * Two shapes live here:
 *   - `projectDocs` / `projectDocScans` — the RESULT of the discovery scan.
 *     Metadata only: no document body is ever stored by DevDigest (the body is
 *     read from the clone on demand, and the only persisted text is the
 *     assembled prompt inside the run trace).
 *   - `agentContextDocs` / `skillContextDocs` — one link table per relation.
 *     An attachment points at a PATH, not at a `project_docs` row: a document
 *     may vanish from a scan and reappear, and the attachment must survive that
 *     (it renders as `missing` in between). Hence no FK to `project_docs`.
 *
 * Neither link table carries `workspace_id`; tenancy comes from the layer
 * above — `ProjectContextService` resolves every incoming `repo_id` through
 * `container.reposRepo.getById(workspaceId, id)` before a row is written or
 * read. See the doc comment on `modules/project-context/repository.ts`.
 */
import { pgTable, uuid, text, integer, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

/**
 * One discovered document. PK = (repoId, path) — the repo-relative path IS the
 * document's identity on every surface, so a scan is an idempotent replace.
 */
export const projectDocs = pgTable(
  'project_docs',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    /** First segment of `path`: `.devdigest` | `docs` | `specs` | `insights`. */
    category: text('category').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** `approxTokens(body)` at scan time — the same estimate the budget enforces. */
    tokens: integer('tokens').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.repoId, t.path] }),
  }),
);

/**
 * The last discovery scan of one repository, 1:1 with repos.
 *
 * There is deliberately NO `running` status: a table with one needs a boot
 * reaper, and the scan's concurrency guard is an in-memory single-flight map in
 * the service instead. The ABSENCE of a row is what the contract renders as
 * status `never`.
 */
export const projectDocScans = pgTable('project_doc_scans', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['ok', 'not_cloned', 'error'] }).notNull(),
  scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
  docCount: integer('doc_count').notNull().default(0),
  tokensTotal: integer('tokens_total').notNull().default(0),
  skippedTooLarge: integer('skipped_too_large').notNull().default(0),
  bounded: integer('bounded').notNull().default(0),
  error: text('error'),
});

/**
 * An agent's own attached documents. `order` is the position in the assembled
 * prompt, reindexed 0..n-1 on every replace.
 */
export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    agentIdx: index('agent_context_docs_agent_idx').on(t.agentId, t.order),
    repoIdx: index('agent_context_docs_repo_idx').on(t.repoId),
  }),
);

/** A skill's attached documents, inherited by every agent that links it. */
export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    skillIdx: index('skill_context_docs_skill_idx').on(t.skillId, t.order),
    repoIdx: index('skill_context_docs_repo_idx').on(t.repoId),
  }),
);
