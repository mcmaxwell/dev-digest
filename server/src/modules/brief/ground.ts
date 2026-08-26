import type { BriefDropped, GroundedRisk, ReviewFocusEntry, RiskSeverity } from '@devdigest/shared';
import { MAX_REVIEW_FOCUS, MAX_RISKS } from './constants.js';
import type { BriefDraft } from './schemas.js';
import type { CandidateSets } from './types.js';

/**
 * L07 — the rejection gate. PURE: a function of the draft and the candidate set.
 *
 * The model is an UNTRUSTED source here, because it was fed untrusted text. That
 * is why this is a gate and not a warning: a hallucinated path rendered as a
 * working-looking link is indistinguishable from a fact, and the reviewer has no
 * way to tell. Everything the model named that the PR's own facts do not contain
 * is removed, and the removal is COUNTED — a brief that dropped nine of ten
 * statements must not look like one that dropped none.
 *
 * Like `candidates.ts`, this file never receives a `BlastCaller`, so there is no
 * value in scope that could put a default-branch line number into a review-focus
 * entry (AC-16). A line survives only by falling inside a `@@` range of the file
 * it was cited for.
 *
 * ENDPOINTS AND JOBS ARE GROUNDED BUT NOT SERVED. The draft carries them per
 * risk so the model can cite the reach it was shown; the wire contract carries
 * none, because `GET /pulls/:id/blast` already serves those lists authoritatively
 * and a second copy would be the extra blast shape the spec's non-goals refuse.
 * Grounding them is still worth the code: `dropped.endpoints` / `dropped.crons`
 * are how a reader learns the model invented reach, and AC-14 then holds by
 * construction — no endpoint or job string reaches the response at all.
 */

export interface GroundedBrief {
  prose: { what: string; why: string };
  risk_level: RiskSeverity;
  risks: GroundedRisk[];
  review_focus: ReviewFocusEntry[];
  dropped: BriefDropped;
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = { low: 0, medium: 1, high: 2 };

export function groundBrief(draft: BriefDraft, candidates: CandidateSets): GroundedBrief {
  const dropped: BriefDropped = {
    risks: 0,
    focus: 0,
    file_refs: 0,
    lines: 0,
    endpoints: 0,
    crons: 0,
  };

  const risks: GroundedRisk[] = [];
  for (const risk of draft.risks) {
    const refs = risk.file_refs.filter((path) => candidates.files.has(path));

    // Endpoint and job names are graded whether or not the risk survives: the
    // reader is being told how much the model invented, and a risk that also
    // named a bad path does not make its bad endpoint less invented.
    dropped.endpoints += countAbsent(risk.endpoints, candidates.endpoints);
    dropped.crons += countAbsent(risk.crons, candidates.crons);

    if (refs.length === 0) {
      // A risk with no real file is exactly the flat, unclickable chip this
      // feature replaces. It counts ONCE, as a dropped risk — its individual
      // bad refs are not also counted, or one hallucination would read as five.
      dropped.risks += 1;
      continue;
    }
    dropped.file_refs += risk.file_refs.length - refs.length;
    risks.push({
      kind: risk.kind,
      title: risk.title,
      explanation: risk.explanation,
      severity: risk.severity,
      file_refs: refs,
    });
  }

  const reviewFocus: ReviewFocusEntry[] = [];
  for (const entry of draft.review_focus) {
    if (!candidates.files.has(entry.file)) {
      dropped.focus += 1;
      continue;
    }
    const line = groundLine(entry.file, entry.line, candidates);
    // AC-15: the LINE is dropped, the ENTRY survives at file level. "Read this
    // file" is still useful; "read line 4000 of a 40-line file" is not.
    if (entry.line !== null && line === null) dropped.lines += 1;
    reviewFocus.push({ file: entry.file, line, reason: entry.reason });
  }

  // The caps are applied AFTER grounding and preserve the model's order, which
  // is the ranking the card renders (AC-39). Anything beyond the cap is not
  // counted as dropped: it was real, it just did not fit.
  return {
    prose: { what: draft.what, why: draft.why },
    risk_level: capRiskLevel(draft.risk_level, risks.slice(0, MAX_RISKS)),
    risks: risks.slice(0, MAX_RISKS),
    review_focus: reviewFocus.slice(0, MAX_REVIEW_FOCUS),
    dropped,
  };
}

/**
 * A line survives only inside one of its own file's reconstructed `@@` ranges.
 *
 * A caller file has no ranges at all, so a line cited for one can never survive
 * — which is the correct answer, not an edge case: the blast lists describe the
 * default branch, and this brief describes a pull request.
 */
function groundLine(file: string, line: number | null, candidates: CandidateSets): number | null {
  if (line === null || !Number.isInteger(line) || line <= 0) return null;
  const ranges = candidates.lineRanges.get(file);
  if (!ranges || ranges.length === 0) return null;
  return ranges.some((r) => line >= r.start && line <= r.end) ? line : null;
}

/**
 * The model's self-assessed level is an UPPER BOUND, capped by the evidence that
 * survived — the same rule `capConfidence` applies to the intent classifier, for
 * the same reason: a verbalized self-assessment is systematically overconfident,
 * and here it was assessed over claims that no longer exist.
 *
 * No surviving risk means `low`, not absent: "we found nothing to flag" is an
 * answer, and a PR page needs a level to scan.
 */
function capRiskLevel(claimed: RiskSeverity, risks: GroundedRisk[]): RiskSeverity {
  if (risks.length === 0) return 'low';
  let highest: RiskSeverity = 'low';
  for (const risk of risks) {
    if (SEVERITY_ORDER[risk.severity] > SEVERITY_ORDER[highest]) highest = risk.severity;
  }
  return SEVERITY_ORDER[claimed] <= SEVERITY_ORDER[highest] ? claimed : highest;
}

function countAbsent(values: readonly string[], allowed: ReadonlySet<string>): number {
  return values.filter((v) => !allowed.has(v)).length;
}

/** The all-zero counter, for every path that never called a model. */
export function noneDropped(): BriefDropped {
  return { risks: 0, focus: 0, file_refs: 0, lines: 0, endpoints: 0, crons: 0 };
}
