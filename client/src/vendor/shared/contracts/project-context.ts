import { z } from 'zod';

/**
 * L05 — Project Context.
 *
 * A repository's clone carries the project's written truth (PRDs, specs,
 * architecture notes). This contract describes what the product can BROWSE
 * (document descriptors, never bodies-in-a-list), what a user can ATTACH to an
 * agent or a skill, and what that attachment costs in tokens.
 *
 * A document is identified by its repo-relative path on EVERY surface — the
 * tree, both Context tabs and the trace's specs-read list all read
 * `specs/public-api.md`. Bodies are never persisted by DevDigest; they are read
 * from the clone on demand and only the assembled prompt survives, inside the
 * run trace.
 *
 * This is a NEW file rather than an edit to `platform.ts` (whose `SpecFile` /
 * `IndexStatus` are unused starter scaffolding), per the barrel rule in
 * `index.ts` — feature agents EXTEND with new files.
 */

/** First segment of a document's repo-relative path — the discovery roots. */
export const ProjectDocCategory = z.enum(['.devdigest', 'docs', 'specs', 'insights']);
export type ProjectDocCategory = z.infer<typeof ProjectDocCategory>;

/** One document as the list endpoint returns it — metadata only, never a body. */
export const ProjectDoc = z.object({
  /** Repo-relative path, e.g. `specs/public-api.md`; the document's identity. */
  path: z.string(),
  category: ProjectDocCategory,
  /** Size on disk at the last scan. */
  size_bytes: z.number().int().min(0),
  /** Token estimate of the body at the last scan (`ceil(chars / 4)`). */
  tokens: z.number().int().min(0),
  /** Distinct ENABLED agents that would inject this document on a run. */
  used_by_agents: z.number().int().min(0),
});
export type ProjectDoc = z.infer<typeof ProjectDoc>;

/**
 * The last discovery scan of one repository.
 *
 * `never` has no persisted row behind it — the absence of a scan row is what
 * the service renders as `never`. `not_cloned` is the repository whose clone
 * job has not finished; the page names the clone as the missing prerequisite.
 */
export const ProjectDocScan = z.object({
  status: z.enum(['ok', 'not_cloned', 'error', 'never']),
  scanned_at: z.string().nullable(),
  doc_count: z.number().int().min(0),
  tokens_total: z.number().int().min(0),
  /** Matched documents dropped for exceeding the per-document size cap. */
  skipped_too_large: z.number().int().min(0),
  /** Matched documents dropped for exceeding the per-repository count cap. */
  bounded: z.number().int().min(0),
  error: z.string().nullable(),
});
export type ProjectDocScan = z.infer<typeof ProjectDocScan>;

/** `GET /repos/:id/context` and `POST /repos/:id/context/refresh`. */
export const ProjectDocList = z.object({
  docs: z.array(ProjectDoc),
  scan: ProjectDocScan,
});
export type ProjectDocList = z.infer<typeof ProjectDocList>;

/** `GET /repos/:id/context/doc?path=` — one document with its body. */
export const ProjectDocBody = ProjectDoc.extend({
  content: z.string(),
});
export type ProjectDocBody = z.infer<typeof ProjectDocBody>;

/**
 * One row of an owner's (agent or skill) attachment set, resolved for display.
 *
 * `origin` distinguishes what the owner attached itself (`direct`) from what an
 * agent inherits through an enabled linked skill (`skill`), which offers
 * neither reorder nor detach. `status` is `missing` when the path is absent
 * from its repository's latest scan — the row stays, and stays detachable.
 */
export const ContextAttachment = z.object({
  repo_id: z.string(),
  /** `owner/name` of the attachment's repository, for cross-repo grouping. */
  repo_full_name: z.string(),
  path: z.string(),
  tokens: z.number().int().min(0),
  status: z.enum(['ok', 'missing']),
  origin: z.enum(['direct', 'skill']),
  /** Name of the skill an inherited row came from; null when `direct`. */
  skill_name: z.string().nullable(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/** `GET`/`PUT /agents/:id/context`. */
export const AgentContext = z.object({
  /** The repository the tab is scoped to; null when the workspace has none. */
  active_repo_id: z.string().nullable(),
  /** The agent's own attachments, in their stored order. */
  direct: z.array(ContextAttachment),
  /** Documents inherited from enabled linked skills, in skill-link order. */
  inherited: z.array(ContextAttachment),
  /** Documents available for the active repository — the M in "N of M". */
  available_count: z.number().int().min(0),
  /** Token estimate of everything this agent would inject, direct + inherited. */
  tokens_total: z.number().int().min(0),
});
export type AgentContext = z.infer<typeof AgentContext>;

/** `GET`/`PUT /skills/:id/context`. A skill inherits nothing. */
export const SkillContext = z.object({
  docs: z.array(ContextAttachment),
  tokens_total: z.number().int().min(0),
});
export type SkillContext = z.infer<typeof SkillContext>;

/**
 * `PUT /agents/:id/context` and `PUT /skills/:id/context` — a FULL replace.
 *
 * Array position is the stored order. Every `repo_id` is re-resolved
 * workspace-scoped and every `path` re-validated server-side before a row is
 * written: an attachment written today is read by the run executor months
 * later, so a stored path must never be able to be a traversal.
 */
export const SetContextDocsBody = z.object({
  docs: z.array(
    z.object({
      repo_id: z.string().uuid(),
      path: z.string().min(1),
    }),
  ),
});
export type SetContextDocsBody = z.infer<typeof SetContextDocsBody>;
