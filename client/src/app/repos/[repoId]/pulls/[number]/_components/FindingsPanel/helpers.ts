import type { EvalExpectation, FindingRecord } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence findings and sort by severity. */
export function visibleFindings(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/**
 * Build the eval-case prefill for a finding (L06).
 *
 * The diff is the finding's WHOLE file patch, wrapped in the `diff --git` and
 * `+++ b/<path>` headers GitHub's per-file patch omits. Whole file, not a slice
 * around the cited lines: the citation-grounding gate reads hunk headers to
 * decide which new-side lines exist, so a hand-cut hunk would shift every line
 * number and the case would fail for a reason that has nothing to do with the
 * agent.
 *
 * The expectation kind comes from the decision the reviewer already made -
 * accepted means "keep finding this", dismissed means "stop flagging this". An
 * undecided finding defaults to `must_find` and stays editable in the modal, so
 * the button is never a dead control.
 */
export function evalCaseFromFinding(
  f: FindingRecord,
  patch: string | null | undefined,
): {
  name: string;
  input_diff: string;
  expectations: EvalExpectation[];
  notes: string;
} | null {
  if (!patch) return null;
  const kind: EvalExpectation["kind"] = f.dismissed_at ? "must_not_flag" : "must_find";
  const slug =
    f.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "eval-case";
  return {
    name: slug,
    input_diff: `diff --git a/${f.file} b/${f.file}\n--- a/${f.file}\n+++ b/${f.file}\n${patch}\n`,
    expectations: [
      {
        kind,
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        title: f.title,
        severity: f.severity as EvalExpectation["severity"],
        category: f.category as EvalExpectation["category"],
        source_finding_id: f.id,
      },
    ],
    notes: f.dismissed_at
      ? "noise · dismissed by a reviewer"
      : f.accepted_at
        ? "floor · accepted by a reviewer"
        : "undecided · minted before a decision",
  };
}
