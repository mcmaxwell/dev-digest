import { evalF1, evalWilson } from '@devdigest/shared';
import type { EvalCaseDelta, EvalExpectation, Finding } from '@devdigest/shared';
import { overlaps } from '../_shared/overlap.js';
import type { Located } from '../_shared/overlap.js';

// The matching rule now has ONE implementation, in `modules/_shared/overlap.ts`,
// because the L07 multi-agent clustering asks the same question of two findings
// that this scorer asks of a finding and an expectation. Re-exported here so
// every existing call site (and `test/eval-scoring.test.ts`) is unchanged.
export { overlaps };
export type { Located };

/**
 * L06 - the eval scorer. PURE: no Container, no I/O, no model call.
 *
 * This file is the claim the whole feature rests on. On the lab a judge was
 * needed because "explained the reason" is not a substring match; here an
 * expectation is a file and a line range, and a comparison settles it. So the
 * scorer takes plain data, returns plain data, and has no way to reach a
 * provider even by accident - which is what makes the per-case model-call count
 * in the integration test a real assertion rather than a hopeful one.
 *
 * Every ratio is MICRO-averaged: counts are summed across the set and divided
 * once. Averaging per-case ratios instead would let a case with one expectation
 * outvote a case with nine.
 */

/** Counts for one case. Ratios are derived; the counts are what aggregates. */
export interface CaseScore {
  pass: boolean;
  matched_must_find: number;
  total_must_find: number;
  /** Findings that overlap some `must_find` - the true positives. */
  matched_findings: number;
  /** Every finding that survived grounding, matched or not. */
  total_findings: number;
  /** `must_not_flag` expectations the agent flagged anyway. */
  violated_must_not_flag: number;
  grounded_kept: number;
  grounded_dropped: number;
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/** The set-level result. */
export interface SuiteScore {
  recall: number;
  precision: number;
  citation_accuracy: number;
  f1: number;
  traces_passed: number;
  traces_total: number;
}

/**
 * Score ONE case.
 *
 * `findings` are the ones that SURVIVED the citation gate; `droppedCount` is
 * how many the gate rejected. Scoring the survivors is deliberate - a finding
 * whose location the diff does not contain is not a false positive about the
 * code, it is a citation failure, and `citation_accuracy` is where it is
 * counted.
 *
 * Precision is STRICT: a finding is a true positive only if it overlaps a
 * `must_find`. Overlapping a `must_not_flag` is a false positive, and so is
 * overlapping nothing at all. Relaxing this is what would make a deliberately
 * broadened prompt score unchanged.
 */
export function scoreCase(
  expectations: readonly EvalExpectation[],
  findings: readonly Finding[],
  droppedCount: number,
): CaseScore {
  const mustFind = expectations.filter((e) => e.kind === 'must_find');
  const mustNotFlag = expectations.filter((e) => e.kind === 'must_not_flag');

  const matchedMustFind = mustFind.filter((e) => findings.some((f) => overlaps(f, e))).length;
  const matchedFindings = findings.filter((f) => mustFind.some((e) => overlaps(f, e))).length;
  const violated = mustNotFlag.filter((e) => findings.some((f) => overlaps(f, e))).length;

  const kept = findings.length;
  const dropped = Math.max(0, droppedCount);
  const cited = kept + dropped;

  return {
    // A case passes when it found everything it had to and flagged nothing it
    // was told not to. Extra noise lowers precision WITHOUT failing the case,
    // so the binary verdict and the ratio stay independent signals.
    pass: matchedMustFind === mustFind.length && violated === 0,
    matched_must_find: matchedMustFind,
    total_must_find: mustFind.length,
    matched_findings: matchedFindings,
    total_findings: kept,
    violated_must_not_flag: violated,
    grounded_kept: kept,
    grounded_dropped: dropped,
    // Empty denominators, each with a stated value rather than a null: nothing
    // was required and nothing was missed; nothing was claimed so nothing was
    // wrong; nothing was cited so no citation failed.
    recall: mustFind.length === 0 ? 1 : matchedMustFind / mustFind.length,
    precision: kept === 0 ? 1 : matchedFindings / kept,
    citation_accuracy: cited === 0 ? 1 : kept / cited,
  };
}

/**
 * Re-exported under the names this module has always used. The implementations
 * live in `@devdigest/shared` because the client displays the same two numbers
 * the server computes, and one formula in two places is two formulas.
 */
export const f1 = evalF1;
export const wilson = evalWilson;

/**
 * Roll a set of per-case counts up into the run's metrics.
 *
 * `f1` is carried here rather than stored on the row because precision and
 * recall are each gameable alone: an agent that emits nothing scores precision
 * 1.0, and one that flags every line scores recall 1.0. Only their harmonic
 * mean punishes both degenerate prompts, so it is the number the UI leads with.
 */
export function aggregate(scores: readonly CaseScore[]): SuiteScore {
  const sum = (pick: (s: CaseScore) => number) => scores.reduce((n, s) => n + pick(s), 0);

  const matchedMustFind = sum((s) => s.matched_must_find);
  const totalMustFind = sum((s) => s.total_must_find);
  const matchedFindings = sum((s) => s.matched_findings);
  const totalFindings = sum((s) => s.total_findings);
  const kept = sum((s) => s.grounded_kept);
  const dropped = sum((s) => s.grounded_dropped);

  const recall = totalMustFind === 0 ? 1 : matchedMustFind / totalMustFind;
  const precision = totalFindings === 0 ? 1 : matchedFindings / totalFindings;
  const citation = kept + dropped === 0 ? 1 : kept / (kept + dropped);

  return {
    recall,
    precision,
    citation_accuracy: citation,
    f1: f1(precision, recall),
    traces_passed: scores.filter((s) => s.pass).length,
    traces_total: scores.length,
  };
}

/**
 * Collapse K repeats of ONE case into a single score.
 *
 * Counts are averaged and the verdict is the majority, so a case that passes
 * two runs out of three counts as passing while its ratios still carry the
 * failure. With `repeats: 1` this is the identity.
 */
export function averageRepeats(runs: readonly CaseScore[]): CaseScore {
  if (runs.length === 0) throw new Error('averageRepeats: no runs');
  if (runs.length === 1) return runs[0]!;
  const mean = (pick: (s: CaseScore) => number) =>
    runs.reduce((n, s) => n + pick(s), 0) / runs.length;
  const passed = runs.filter((s) => s.pass).length;
  return {
    pass: passed * 2 > runs.length,
    matched_must_find: mean((s) => s.matched_must_find),
    total_must_find: mean((s) => s.total_must_find),
    matched_findings: mean((s) => s.matched_findings),
    total_findings: mean((s) => s.total_findings),
    violated_must_not_flag: mean((s) => s.violated_must_not_flag),
    grounded_kept: mean((s) => s.grounded_kept),
    grounded_dropped: mean((s) => s.grounded_dropped),
    recall: mean((s) => s.recall),
    precision: mean((s) => s.precision),
    citation_accuracy: mean((s) => s.citation_accuracy),
  };
}

/** One case's verdict inside a run, as the pairing reads it. */
export interface PairedCase {
  case_id: string;
  case_name: string | null;
  pass: boolean | null;
}

/**
 * Join two runs case by case.
 *
 * This is the comparison that can actually be read. Two aggregate ratios over a
 * dozen cases move by more than ten points when a single case flips, so a pair
 * of summary numbers cannot separate a real improvement from the model's own
 * sampling; "these two were lost and this one was gained" can.
 *
 * A case present in only one run is reported as such rather than skipped. The
 * set grows over time, and silently comparing two different sets is how a
 * harness starts lying about its own history.
 */
export function pairCases(
  left: readonly PairedCase[],
  right: readonly PairedCase[],
): EvalCaseDelta[] {
  const byId = new Map<string, { l?: PairedCase; r?: PairedCase }>();
  for (const c of left) byId.set(c.case_id, { ...byId.get(c.case_id), l: c });
  for (const c of right) byId.set(c.case_id, { ...byId.get(c.case_id), r: c });

  const out: EvalCaseDelta[] = [];
  for (const [caseId, { l, r }] of byId) {
    const name = l?.case_name ?? r?.case_name ?? null;
    const leftPass = l?.pass ?? null;
    const rightPass = r?.pass ?? null;
    const change: EvalCaseDelta['change'] = !l
      ? 'missing_left'
      : !r
        ? 'missing_right'
        : leftPass === rightPass
          ? 'unchanged'
          : rightPass
            ? 'gained'
            : 'lost';
    out.push({ case_id: caseId, case_name: name, left_pass: leftPass, right_pass: rightPass, change });
  }
  // What moved goes first: an unchanged case is the part nobody needs to read.
  const rank: Record<EvalCaseDelta['change'], number> = {
    lost: 0,
    gained: 1,
    missing_right: 2,
    missing_left: 3,
    unchanged: 4,
  };
  return out.sort(
    (a, b) => rank[a.change] - rank[b.change] || (a.case_name ?? '').localeCompare(b.case_name ?? ''),
  );
}
