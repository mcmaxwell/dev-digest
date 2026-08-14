import { z } from 'zod';
import { PrHistoryItem, Risk, RiskSeverity } from './brief.js';
import { BlastIndexState } from './blast.js';

/**
 * L07 - the PR Brief: grounded risks, a ranked review focus, and an append-only
 * brief history.
 *
 * A NEW file rather than an edit to `brief.ts`, per the barrel rule in
 * `index.ts` ("feature agents EXTEND with new files"). `PrBrief` in `brief.ts`
 * belongs to a different composition and is deliberately left untouched and
 * unused; this file borrows only its vocabulary (`Risk`, `RiskSeverity`,
 * `PrHistoryItem`) and the blast contract's `BlastIndexState`.
 *
 * Because the barrel `export *`s all three files, nothing imported above may be
 * re-exported here - a duplicate export is a build error in every consumer.
 *
 * TWO THINGS THAT TRAVEL WITH THIS CONTRACT and are easy to get wrong:
 *
 *  1. `history` and `brief_history` are DIFFERENT data and must never be
 *     conflated. `history` is prior overlapping PRs of the same repository,
 *     computed deterministically from stored file lists. `brief_history` is this
 *     PR's own per-generation timeline, one entry per generation, append-only.
 *  2. Every path, endpoint, cron and line in here has passed a rejection gate
 *     against a candidate set built from the PR's own facts. A field being
 *     present means the model named something that actually exists; `dropped`
 *     counts what it named that did not.
 */

// ---- The grounded pieces ---------------------------------------------------

/**
 * A risk that survived grounding.
 *
 * The only difference from `Risk` is that `file_refs` is non-empty: a risk with
 * no file reference is exactly the flat chip L03 shipped and this feature
 * replaces, so an entry that cannot name a file is dropped rather than rendered.
 */
export const GroundedRisk = Risk.extend({
  file_refs: z.array(z.string()).min(1),
});
export type GroundedRisk = z.infer<typeof GroundedRisk>;

/**
 * One "read this first" entry, in the order the model ranked them.
 *
 * `line` is nullable and frequently null on purpose: a line survives only when
 * it falls inside a reconstructed `@@` range for that same file. A caller file
 * has no `@@` ranges at all, so an entry citing one can never carry a line.
 */
export const ReviewFocusEntry = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  reason: z.string(),
});
export type ReviewFocusEntry = z.infer<typeof ReviewFocusEntry>;

/**
 * The single model-written paragraph, in two named parts.
 *
 * Two fields rather than one blob because they are graded by different rules:
 * `what` states reach and is checkable against the blast lists, `why` states
 * purpose and is checkable against the intent quote. One field would make
 * "never claim a defect" untestable - a grader could not say which half broke.
 */
export const BriefProse = z.object({
  what: z.string(),
  why: z.string(),
});
export type BriefProse = z.infer<typeof BriefProse>;

/**
 * What grounding removed, by category. Shown to the reader: without it, a brief
 * that dropped nine of ten statements looks the same as one that dropped none,
 * and there is no way to calibrate how much of the rest to trust.
 */
export const BriefDropped = z.object({
  /** Whole risks dropped for naming no file inside the candidate set. */
  risks: z.number().int().min(0),
  /** Whole review-focus entries dropped for the same reason. */
  focus: z.number().int().min(0),
  /** Individual file references struck from surviving risks. */
  file_refs: z.number().int().min(0),
  /** Line numbers struck while the entry itself survived at file level. */
  lines: z.number().int().min(0),
  /** Endpoint strings absent from the blast result. */
  endpoints: z.number().int().min(0),
  /** Scheduled-job strings absent from the blast result. */
  crons: z.number().int().min(0),
});
export type BriefDropped = z.infer<typeof BriefDropped>;

// ---- Provenance ------------------------------------------------------------

/**
 * Who wrote the brief, at what commit, over which index.
 *
 * `stale` is DERIVED on read against BOTH shas - the brief can rot because the
 * PR moved (`head_sha`) or because the repository was re-indexed under an
 * unchanged head (`indexed_sha`). One column could not catch the second.
 */
export const BriefMeta = z.object({
  provider: z.string(),
  model: z.string(),
  head_sha: z.string(),
  indexed_sha: z.string(),
  generated_at: z.string(),
  stale: z.boolean(),
});
export type BriefMeta = z.infer<typeof BriefMeta>;

/** `degraded` still carries a readable brief - it is never an error page. */
export const BriefStatus = z.enum(['ok', 'degraded']);
export type BriefStatus = z.infer<typeof BriefStatus>;

/**
 * WHY a brief is degraded - an enum, never an English sentence, so the client
 * can translate it through next-intl the way `blast.index.reason` already is.
 */
export const BriefDegradedReason = z.enum([
  /** The repository index is `degraded`: no reach facts, so nothing to ground against. */
  'index_degraded',
  /** The clone was gone at generation time. */
  'clone_unavailable',
  /** The one model call failed, timed out, or could not be repaired into schema. */
  'model_failed',
  /** The PR has no changed files - there is nothing to brief. */
  'no_files',
]);
export type BriefDegradedReason = z.infer<typeof BriefDegradedReason>;

/**
 * One entry of THIS PR's own generation timeline. Append-only: written once at
 * generation and never updated or deleted, so a PR whose purpose drifted
 * mid-flight is visible as a sequence rather than as one overwritten row.
 *
 * A projection, not the whole brief: storing every brief per commit makes the
 * table grow without bound on a long-lived PR, and a timeline entry only needs
 * enough to show how the reading changed.
 */
export const BriefHistoryEntry = z.object({
  head_sha: z.string(),
  generated_at: z.string(),
  risk_level: RiskSeverity,
  what: z.string(),
});
export type BriefHistoryEntry = z.infer<typeof BriefHistoryEntry>;

// ---- The brief -------------------------------------------------------------

/**
 * The whole brief as it is served and rendered.
 *
 * `index` is carried through from `BlastService.get()` unchanged so the card can
 * state its own trustworthiness without a second fetch. It is the ONLY blast
 * field here - the blast radius itself is served by `GET /pulls/:id/blast` and a
 * second copy on the wire would be a fourth blast shape.
 */
export const BriefView = z.object({
  prose: BriefProse,
  /** Capped at the highest severity among the SURVIVING risks, never the model's claim. */
  risk_level: RiskSeverity,
  risks: z.array(GroundedRisk),
  /** Ordered: the array order is the reading order the card renders. */
  review_focus: z.array(ReviewFocusEntry),
  /** Prior overlapping PRs of the same repository - NOT this PR's timeline. */
  history: z.array(PrHistoryItem),
  /** This PR's own per-generation timeline, newest first. */
  brief_history: z.array(BriefHistoryEntry),
  dropped: BriefDropped,
  meta: BriefMeta,
  index: BlastIndexState,
  status: BriefStatus,
  degraded_reason: BriefDegradedReason.nullable(),
});
export type BriefView = z.infer<typeof BriefView>;

/**
 * `GET`/`POST /pulls/:id/brief`.
 *
 * Nullable rather than a 404 on the read, for the same reason `PrIntentResponse`
 * is: the client's `apiFetch` turns ANY non-2xx into a thrown `ApiError`, which
 * would leave the card permanently in an error state on a PR that simply has no
 * brief yet. Both verbs return the whole envelope so the client can seed one
 * cache entry with `setQueryData`.
 */
export const PrBriefResponse = z.object({
  brief: BriefView.nullable(),
});
export type PrBriefResponse = z.infer<typeof PrBriefResponse>;
