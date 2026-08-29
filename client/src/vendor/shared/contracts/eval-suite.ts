import { z } from 'zod';
import { FindingCategory, Severity } from './findings.js';
import { EvalCase, EvalOwnerKind } from './knowledge.js';
import { EvalCaseInput, EvalRunRecord } from './eval-ci.js';

/**
 * L06 - the eval SUITE: a whole case set run at once, scored in pure code, and
 * compared against an earlier run of the same set.
 *
 * A NEW file, not an edit to `eval-ci.ts`, for the barrel rule in `index.ts` -
 * and because `eval-ci.ts` is one of the three contract files whose two vendor
 * copies have already drifted (see `.claude/repo-facts.md`). Touching it would
 * mix this feature's diff with a pre-existing drift nobody asked us to resolve.
 * The barrel `export *`s both files, so callers see one namespace.
 *
 * `eval-ci.ts` already owns the SINGLE-case shapes (`EvalCaseInput`,
 * `EvalRunRecord`, `EvalRunResult`) and the read-model for a dashboard
 * (`EvalDashboard`, `EvalTrendPoint`). What it has no shape for is the thing
 * this lesson is actually about: one execution of the WHOLE set, identified,
 * stamped with the agent config version that produced it, and comparable to
 * another one.
 */

// ===========================================================================
// Expectations - what a case asserts
// ===========================================================================

/**
 * The two kinds of assertion a case can make, and the reason the harness needs
 * no judge.
 *
 * `must_find` is minted from a finding the reviewer ACCEPTED: the agent said
 * something true, and it must keep saying it. `must_not_flag` is minted from a
 * DISMISSED finding: the agent said something the reviewer rejected, and it
 * must stop. Both reduce to a file and a line range, which a comparison
 * settles - so scoring never calls a model.
 */
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/**
 * One assertion about one location.
 *
 * Only `kind`, `file` and the line range are read by the matcher. Everything
 * below them is provenance carried for the UI and for the human who later asks
 * "where did this case come from" - never an input to a score, so a case stays
 * meaningful after the review it was minted from has been deleted.
 */
export const EvalExpectation = z.object({
  kind: EvalExpectationKind,
  file: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  /** Display and provenance only - the matcher never reads past `end_line`. */
  title: z.string().nullish(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  source_finding_id: z.string().nullish(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * The parsed shape of `eval_cases.expected_output`, which the column itself
 * stores as untyped jsonb. A case with an empty array is not malformed - it is
 * the clean-diff case, where ANY finding is a false positive.
 */
export const EvalExpectedOutput = z.object({
  expectations: z.array(EvalExpectation).default([]),
});
export type EvalExpectedOutput = z.infer<typeof EvalExpectedOutput>;
/** Caller-facing input type - `.default()` fields stay optional. */
export type EvalExpectedOutputInput = z.input<typeof EvalExpectedOutput>;

// ===========================================================================
// Cases - the API's read model
// ===========================================================================

/**
 * A case as the case list renders it: the stored row, its expectations already
 * parsed out of the jsonb, and the most recent run of it (null when the case
 * has never run - which the UI shows as "never run", not as a failure).
 */
export const EvalCaseRecord = EvalCase.extend({
  expectations: z.array(EvalExpectation),
  last_run: EvalRunRecord.nullable(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/**
 * Body for `POST /agents/:id/eval-cases` and `PUT /eval-cases/:id`. The owner
 * is resolved from the path, so it is not on the wire - sending it would let a
 * caller file a case against an agent other than the one in the URL.
 */
export const EvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });
export type EvalCaseBody = z.infer<typeof EvalCaseBody>;
export type EvalCaseBodyInput = z.input<typeof EvalCaseBody>;

// ===========================================================================
// Suite runs - one execution of the whole set
// ===========================================================================

/**
 * How many times each case is executed within one suite run.
 *
 * Default 1. Above that, per-case metrics are averaged and the case's verdict
 * is the majority - which buys resolution against a model's own sampling noise
 * at a directly proportional cost, so it is opt-in per run and capped.
 */
export const EVAL_MIN_REPEATS = 1;
export const EVAL_MAX_REPEATS = 3;

/** Body for `POST /agents/:id/eval-runs`. */
export const EvalSuiteRunInput = z.object({
  repeats: z
    .number()
    .int()
    .min(EVAL_MIN_REPEATS)
    .max(EVAL_MAX_REPEATS)
    .default(EVAL_MIN_REPEATS),
});
export type EvalSuiteRunInput = z.infer<typeof EvalSuiteRunInput>;
export type EvalSuiteRunInputBody = z.input<typeof EvalSuiteRunInput>;

/**
 * One execution of a whole case set.
 *
 * `agent_version` is the load-bearing field: it is what makes two runs
 * comparable as "old prompt vs new prompt" rather than as two undated numbers.
 * It points at an `agent_versions` snapshot, which already pins the system
 * prompt, the model, the strategy and the ordered skill set that produced this
 * run.
 *
 * `f1` and the Wilson interval on the pass rate are DERIVED from the fields
 * here and are not stored - one source of truth per number, and a formula that
 * can be corrected without a migration.
 */
export const EvalSuiteRunRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  /** The agent config version this run executed. Null for a pre-versioned row. */
  agent_version: z.number().int().nullable(),
  model: z.string().nullable(),
  ran_at: z.string(),
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  repeats: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalSuiteRunRecord = z.infer<typeof EvalSuiteRunRecord>;

/** A suite run with the per-case rows it produced. */
export const EvalSuiteRunDetail = z.object({
  run: EvalSuiteRunRecord,
  cases: z.array(EvalRunRecord),
});
export type EvalSuiteRunDetail = z.infer<typeof EvalSuiteRunDetail>;

// ===========================================================================
// Comparison - paired, per case
// ===========================================================================

/**
 * What happened to ONE case between two runs.
 *
 * This is the point of the compare view. On a set of a dozen cases a single
 * flipped case moves an aggregate ratio by ten points or more, so a pair of
 * summary numbers cannot separate a real improvement from sampling noise -
 * "these two cases were lost and this one was gained" can.
 *
 * `missing_left` / `missing_right` cover a case that exists in only one of the
 * two runs, because the set grew between them. Such a case is reported rather
 * than dropped: silently comparing different sets is how a harness starts
 * lying.
 */
export const EvalCaseChange = z.enum([
  'gained',
  'lost',
  'unchanged',
  'missing_left',
  'missing_right',
]);
export type EvalCaseChange = z.infer<typeof EvalCaseChange>;

export const EvalCaseDelta = z.object({
  case_id: z.string(),
  case_name: z.string().nullable(),
  left_pass: z.boolean().nullable(),
  right_pass: z.boolean().nullable(),
  change: EvalCaseChange,
});
export type EvalCaseDelta = z.infer<typeof EvalCaseDelta>;

/** Signed movement of each ratio, right minus left. */
export const EvalMetricDeltas = z.object({
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  f1: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalMetricDeltas = z.infer<typeof EvalMetricDeltas>;

/**
 * Two runs of one agent, side by side. `left_prompt` / `right_prompt` come from
 * the `agent_versions` snapshots the two runs recorded, so the diff shown is
 * the prompt as it WAS, not the agent's current prompt.
 */
export const EvalSuiteCompare = z.object({
  left: EvalSuiteRunRecord,
  right: EvalSuiteRunRecord,
  delta: EvalMetricDeltas,
  case_deltas: z.array(EvalCaseDelta),
  left_prompt: z.string().nullable(),
  right_prompt: z.string().nullable(),
});
export type EvalSuiteCompare = z.infer<typeof EvalSuiteCompare>;

// ===========================================================================
// Dashboard index - every agent at a glance
// ===========================================================================

/**
 * One agent's row on the Eval Dashboard. `trend` is the pass rate of each run
 * oldest-first, so a sparkline can be drawn without a second request.
 */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  last_run: EvalSuiteRunRecord.nullable(),
  trend: z.array(z.number()),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** `GET /eval/dashboard` - the workspace-wide index. */
export const EvalDashboardIndex = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalSuiteRunRecord.extend({ agent_name: z.string().nullable() })),
});
export type EvalDashboardIndex = z.infer<typeof EvalDashboardIndex>;

// ===========================================================================
// Derived metrics
// ===========================================================================

// `evalF1` and `evalWilson` live in their own import-free file so the client can
// deep import them without webpack following this file's `.js` specifiers; see
// the header of `eval-math.ts`. Re-exported here so the server keeps reaching
// every eval shape through the barrel.
export { evalF1, evalWilson } from './eval-math.js';
