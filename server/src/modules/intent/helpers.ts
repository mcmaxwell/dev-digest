import type {
  Intent,
  IntentClassification,
  IntentConfidence,
  IntentSource,
  PrIntent,
  RiskArea,
} from '@devdigest/shared';
import type { PrIntentRow } from '../../db/rows.js';

/**
 * Pure helpers for the intent layer (side-effect free; operate purely on their
 * arguments — no DB / network / `this`).
 */

/**
 * Cap the model's self-reported confidence against what we could actually read.
 *
 * Verbalized LLM confidence is systematically overconfident, so it is treated as
 * an upper bound to be lowered, never as a measurement. Two deterministic rules:
 *
 *  - no PR body at all → `low`. Title and file list alone cannot establish
 *    intent; anything above `low` there is the model filling in a story.
 *  - any source `unreachable` → at most `medium`. Something exists that we know
 *    we did not read, so the statement is provably incomplete.
 *
 * Same shape as the conventions extractor's rule for an unmeasured probe: cap
 * the confidence, never drop the item.
 */
export function capConfidence(
  reported: IntentConfidence,
  sources: IntentSource[],
): IntentConfidence {
  const body = sources.find((s) => s.kind === 'pr_body');
  if (!body || body.status !== 'ok') return 'low';
  if (sources.some((s) => s.status === 'unreachable')) {
    return reported === 'high' ? 'medium' : reported;
  }
  return reported;
}

/**
 * Row → DTO. `stale` is DERIVED here by comparing the SHA the intent was built
 * from against the PR's current head, so it can never rot in the database.
 * A row with no recorded head predates the head tracking and counts as stale.
 */
export function rowToDto(row: PrIntentRow, currentHeadSha: string | null): PrIntent {
  return {
    pr_id: row.prId,
    summary: row.summary,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    risk_areas: row.riskAreas as RiskArea[],
    confidence: row.confidence,
    sources: row.sources as IntentSource[],
    provider: row.provider ?? '',
    model: row.model ?? '',
    head_sha: row.headSha ?? '',
    generated_at: row.generatedAt.toISOString(),
    stale: !row.headSha || !currentHeadSha || row.headSha !== currentHeadSha,
  };
}

/**
 * The single conversion point to `brief.ts`'s narrower `Intent`, which the PR
 * Brief lesson composes. It lives here so that lesson never has to reach into
 * `pr_intent` itself — and so `brief.ts` stays untouched by L03.
 */
export function toBriefIntent(intent: IntentClassification): Intent {
  return {
    intent: intent.summary,
    in_scope: intent.in_scope,
    out_of_scope: intent.out_of_scope,
  };
}

/**
 * Render the reviewer prompt's `## Derived intent` body.
 *
 * The SERVER renders it, not reviewer-core: the engine takes a pre-rendered
 * string so it never learns the `PrIntent` shape and stays free of this module's
 * contract. reviewer-core wraps what it gets in `wrapUntrusted` — this is
 * derived from author-controlled text and is treated as such.
 */
export function renderIntentBlock(intent: PrIntent): string {
  const lines = [`Stated purpose: ${intent.summary}`, `Detection confidence: ${intent.confidence}`];
  if (intent.in_scope.length > 0) {
    lines.push('In scope:', ...intent.in_scope.map((s) => `- ${s}`));
  }
  if (intent.out_of_scope.length > 0) {
    lines.push('Explicitly out of scope:', ...intent.out_of_scope.map((s) => `- ${s}`));
  }
  if (intent.risk_areas.length > 0) {
    lines.push(
      'Risk areas flagged during intent detection:',
      ...intent.risk_areas.map((r) => `- ${r.label} (${r.kind})`),
    );
  }
  const missing = intent.sources.filter((s) => s.status !== 'ok');
  if (missing.length > 0) {
    lines.push(
      'Context the intent detector could not read (treat the statement above as incomplete):',
      ...missing.map((s) => `- ${s.kind} ${s.ref}: ${s.status}`),
    );
  }
  return lines.join('\n');
}

/**
 * The log-safe projection of a source list: kinds, refs and statuses, never a
 * character of source text. This is the ONLY shape of a source that is allowed
 * into a pino line (the full prompt lives in `pr_intent.trace`, which is
 * DB-only).
 */
export function loggableSources(sources: IntentSource[]): {
  kind: string;
  ref: string;
  status: string;
}[] {
  return sources.map((s) => ({ kind: s.kind, ref: s.ref, status: s.status }));
}
