import type { Finding, Severity } from '@devdigest/shared';

/**
 * The scope filter — PURE, deterministic, server-side.
 *
 * The Intent Layer's whole risk is a reviewer that goes quiet because the PR
 * *said* it was only a refactor. Conditioning an LLM reviewer on a stated
 * requirement measurably distorts its judgement, and PR titles and bodies are a
 * documented, exploited prompt-injection vector against review agents. So
 * "ignore out-of-scope noise" is NOT a prompt instruction that an attacker can
 * push on: it is this function, and it obeys two rules the model cannot bend.
 *
 *  1. **Severity wins over scope.** A finding at or above `keepAtOrAbove` is
 *     kept whatever its scope says. At the default threshold that means a
 *     CRITICAL is never dropped — its survival as an ordinary grounded finding
 *     IS the "serious out-of-scope problem" signal. Nothing is synthesized.
 *  2. **Silence is never inferred.** Only an explicit `out_of_scope` drops a
 *     finding. A null/absent scope — a model that ignored the field, an older
 *     review re-read from the DB, a run with no intent at all — is always kept,
 *     so a PR without intent behaves exactly as it did before L03.
 *
 * It runs AFTER `groundFindings` and BEFORE the score is recomputed, so it can
 * never bypass the grounding gate and the score always describes the survivors.
 */

/** Highest first — a bigger number is a more severe finding. */
const SEVERITY_RANK: Record<Severity, number> = {
  SUGGESTION: 0,
  WARNING: 1,
  CRITICAL: 2,
};

/**
 * Findings at or above this severity are immune to the filter. CRITICAL by
 * default: a critical defect is a critical defect regardless of what the PR set
 * out to do.
 */
export const DEFAULT_SCOPE_KEEP_AT_OR_ABOVE: Severity = 'CRITICAL';

export interface ScopeFilterOptions {
  keepAtOrAbove: Severity;
}

export interface ScopeFilterResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

export function applyScopeFilter(
  findings: Finding[],
  opts: ScopeFilterOptions = { keepAtOrAbove: DEFAULT_SCOPE_KEEP_AT_OR_ABOVE },
): ScopeFilterResult {
  const floor = SEVERITY_RANK[opts.keepAtOrAbove];
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const outOfScope = finding.scope === 'out_of_scope';
    const immune = SEVERITY_RANK[finding.severity] >= floor;
    if (outOfScope && !immune) {
      dropped.push({
        finding,
        reason: `out of the PR's stated scope (${finding.severity} is below ${opts.keepAtOrAbove})`,
      });
    } else {
      kept.push(finding);
    }
  }

  return { kept, dropped };
}

/**
 * The one sentence appended to a review's summary when anything was suppressed.
 * Nothing the filter does is allowed to be invisible: the drop also emits a Live
 * Log line and lands in the run trace.
 */
export function scopeSuppressionNote(count: number): string {
  return `${count} out-of-scope suggestion(s) suppressed (see the run trace).`;
}
