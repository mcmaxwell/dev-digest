/**
 * Pure mappers for the eval module (side-effect free; operate purely on their
 * arguments - no DB, no network, no `this`).
 */
import {
  EvalExpectedOutput,
  type EvalCaseRecord,
  type EvalExpectation,
  type EvalMetricDeltas,
  type EvalRunRecord,
  type EvalSuiteRunRecord,
} from '@devdigest/shared';
import type { EvalCaseRow, EvalRunRow, EvalSuiteRunRow } from '../../db/rows.js';
import { f1 } from './scoring.js';

/**
 * Read the expectations out of a case's untyped `expected_output` jsonb.
 *
 * Tolerant on purpose: the column predates this feature and is `jsonb` with no
 * `$type`, so a row written by an earlier lesson, a hand-edited row, or a
 * half-migrated one must not blow up a whole run. A case whose expectations do
 * not parse becomes a case that asserts NOTHING - which scores as a clean diff
 * where any finding is a false positive, and is visible in the UI as an empty
 * expectation list rather than as a crash.
 */
export function parseExpectations(expectedOutput: unknown): EvalExpectation[] {
  const parsed = EvalExpectedOutput.safeParse(expectedOutput);
  return parsed.success ? parsed.data.expectations : [];
}

export function toRunDto(row: EvalRunRow, caseName: string | null = null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

export function toCaseDto(row: EvalCaseRow, lastRun: EvalRunRow | undefined): EvalCaseRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
    expectations: parseExpectations(row.expectedOutput),
    last_run: lastRun ? toRunDto(lastRun, row.name) : null,
  };
}

/**
 * The metric columns are nullable in the table but the service is their only
 * writer and always supplies them, so `?? 0` here is unreachable in practice
 * rather than a silent substitution for a real measurement.
 */
export function toSuiteRunDto(row: EvalSuiteRunRow): EvalSuiteRunRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    agent_version: row.agentVersion,
    model: row.model,
    ran_at: row.ranAt.toISOString(),
    recall: row.recall ?? 0,
    precision: row.precision ?? 0,
    citation_accuracy: row.citationAccuracy ?? 0,
    traces_passed: row.tracesPassed ?? 0,
    traces_total: row.tracesTotal ?? 0,
    repeats: row.repeats,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/** Signed movement of each metric, right minus left. */
export function metricDeltas(
  left: EvalSuiteRunRecord,
  right: EvalSuiteRunRecord,
): EvalMetricDeltas {
  return {
    recall: right.recall - left.recall,
    precision: right.precision - left.precision,
    citation_accuracy: right.citation_accuracy - left.citation_accuracy,
    f1: f1(right.precision, right.recall) - f1(left.precision, left.recall),
    cost_usd:
      right.cost_usd == null || left.cost_usd == null ? null : right.cost_usd - left.cost_usd,
  };
}
