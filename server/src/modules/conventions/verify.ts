import type { ConventionEvidence } from '@devdigest/shared';
import { MIN_EVIDENCE_CONFIG, MIN_EVIDENCE_LLM } from './constants.js';
import type { DraftCandidate } from './types.js';

/**
 * PURE evidence grounding: the candidate says "this line, in this file" — we
 * check the clone and keep only what is actually there.
 *
 * The important detail is that verification RELOCATES rather than only
 * rejecting. A model that copies the right line but is one off on the number is
 * telling the truth about the repo; dropping that finding costs recall for no
 * precision gain. So: found at the cited line → `exact`; found elsewhere in the
 * same file → `relocated` (we correct the number); not in the file at all →
 * dropped, because that claim is unsupported.
 */

/** Collapse whitespace so indentation drift never fails a match. */
function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** A snippet must carry some substance before a match means anything. */
function isMeaningful(snippet: string): boolean {
  const n = normalize(snippet);
  return n.length >= 4 && /[A-Za-z0-9_$]/.test(n);
}

export interface VerifyInput {
  /** Repo-relative path → full file text, as read from the clone. */
  fileContents: Map<string, string>;
}

/**
 * Ground one evidence item. Returns null when the file is missing from the clone
 * or the snippet appears nowhere in it.
 */
export function verifyEvidence(
  claim: { path: string; line: number; snippet: string },
  fileContents: Map<string, string>,
): ConventionEvidence | null {
  const content = fileContents.get(claim.path);
  if (content === undefined) return null;
  if (!isMeaningful(claim.snippet)) return null;

  const lines = content.split('\n');
  const target = normalize(claim.snippet);

  const at = lines[claim.line - 1];
  if (at !== undefined && normalize(at).includes(target)) {
    return { path: claim.path, line: claim.line, snippet: at.trim(), verified: 'exact' };
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (normalize(lines[i]!).includes(target)) {
      return { path: claim.path, line: i + 1, snippet: lines[i]!.trim(), verified: 'relocated' };
    }
  }
  return null;
}

/**
 * Verify every candidate's evidence and drop the ones left without enough of it.
 *
 * The distinct-file requirement is deliberate: two hits in the same file are one
 * observation seen twice, which is exactly the shape a hallucinated "pattern"
 * takes.
 */
export function verifyCandidates(
  candidates: DraftCandidate[],
  fileContents: Map<string, string>,
): DraftCandidate[] {
  const out: DraftCandidate[] = [];

  for (const candidate of candidates) {
    const verified: ConventionEvidence[] = [];
    const seen = new Set<string>();
    for (const claim of candidate.evidence) {
      const hit = verifyEvidence(claim, fileContents);
      if (!hit) continue;
      const key = `${hit.path}:${hit.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verified.push(hit);
    }

    const distinctFiles = new Set(verified.map((e) => e.path)).size;
    const required = candidate.origin === 'config' ? MIN_EVIDENCE_CONFIG : MIN_EVIDENCE_LLM;
    if (verified.length < required || distinctFiles < required) continue;

    out.push({ ...candidate, evidence: verified });
  }
  return out;
}
