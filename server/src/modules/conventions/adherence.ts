import type { CodeIndex, RepoRef } from '@devdigest/shared';
import { withTimeout } from '../../platform/resilience.js';
import {
  MIN_ADHERENCE,
  MIN_PROBE_SUPPORT,
  PROBE_MAX_MATCHES,
  PROBE_MAX_PATTERN_LENGTH,
  PROBE_TIMEOUT_MS,
  UNPROBED_CONFIDENCE_CAP,
} from './constants.js';
import type { ConventionProbe, DraftCandidate } from './types.js';

/**
 * Counter-example scoring: run the candidate's probe over the WHOLE repo and
 * measure how often the codebase actually follows the rule.
 *
 * This is the difference between "the model believes this is a convention" and
 * "the repo does this 94% of the time". Verified evidence proves the pattern
 * exists; only counting the violations proves it is the RULE. A rule the repo
 * follows 55% of the time is a preference, and shipping it into a reviewer's
 * skill produces a finding on every second PR.
 *
 * Probe patterns are model-authored, i.e. untrusted input reaching a regex
 * engine — hence the length cap, the compile check, the catastrophic-backtracking
 * screen and the wall-clock timeout below.
 */

/**
 * Nested quantifiers over a group — `(a+)+`, `(a*)*`, `(a|b)+*` — are the classic
 * catastrophic-backtracking shape. Cheap structural screen; the timeout is the
 * real backstop.
 */
const CATASTROPHIC_RE = /\([^)]*[+*]\s*\)\s*[+*]|\(\?:[^)]*[+*]\s*\)\s*[+*]/;

/** Whether a model-authored pattern is safe enough to run. */
export function isSafeProbePattern(pattern: string): boolean {
  if (!pattern || pattern.length > PROBE_MAX_PATTERN_LENGTH) return false;
  if (CATASTROPHIC_RE.test(pattern)) return false;
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function isSafeProbe(probe: ConventionProbe | undefined): probe is ConventionProbe {
  return !!probe && isSafeProbePattern(probe.positive) && isSafeProbePattern(probe.negative);
}

/** Count matches for one pattern, bounded in both time and result size. */
async function countMatches(
  codeIndex: CodeIndex,
  ref: RepoRef,
  pattern: string,
): Promise<number | null> {
  try {
    const matches = await withTimeout(codeIndex.grep(ref, pattern), PROBE_TIMEOUT_MS);
    return Math.min(matches.length, PROBE_MAX_MATCHES);
  } catch {
    // A timed-out or failed probe is "unmeasured", not "violated" — the caller
    // keeps the candidate at capped confidence rather than deleting it.
    return null;
  }
}

/**
 * Score every candidate that shipped a usable probe, and drop the ones the repo
 * demonstrably does not follow. Candidates without a probe survive with
 * `adherence: null` and a capped confidence, so an unmeasurable-but-real rule is
 * not silently lost.
 */
export async function scoreAdherence(
  candidates: DraftCandidate[],
  codeIndex: CodeIndex,
  ref: RepoRef,
): Promise<DraftCandidate[]> {
  const out: DraftCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.origin === 'config' || !isSafeProbe(candidate.probe)) {
      out.push({
        ...candidate,
        probe: isSafeProbe(candidate.probe) ? candidate.probe : undefined,
        confidence:
          candidate.origin === 'config'
            ? candidate.confidence
            : Math.min(candidate.confidence, UNPROBED_CONFIDENCE_CAP),
      });
      continue;
    }

    const [support, violations] = await Promise.all([
      countMatches(codeIndex, ref, candidate.probe.positive),
      countMatches(codeIndex, ref, candidate.probe.negative),
    ]);

    if (support === null || violations === null) {
      out.push({
        ...candidate,
        confidence: Math.min(candidate.confidence, UNPROBED_CONFIDENCE_CAP),
      });
      continue;
    }

    const total = support + violations;
    // A probe that finds almost nothing measured nothing — it says more about
    // the regex than about the repo, so fall back to the unmeasured path.
    if (support < MIN_PROBE_SUPPORT || total === 0) {
      out.push({
        ...candidate,
        confidence: Math.min(candidate.confidence, UNPROBED_CONFIDENCE_CAP),
      });
      continue;
    }

    const adherence = support / total;
    if (adherence < MIN_ADHERENCE) continue; // followed too rarely to be a rule

    out.push({
      ...candidate,
      adherence,
      support,
      violations,
      // A measured rule earns confidence; an unmeasured one cannot exceed the cap.
      confidence: Math.max(candidate.confidence, adherence),
    });
  }

  return out;
}
