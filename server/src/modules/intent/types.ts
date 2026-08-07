import type {
  IntentConfidence,
  IntentSource,
  IntentSourceKind,
  IntentSourceStatus,
  RiskArea,
} from '@devdigest/shared';

/**
 * Module-internal shapes for the intent layer. Anything that crosses the wire
 * lives in `@devdigest/shared` `contracts/intent.ts`; this file holds only what
 * stays inside the server.
 */

/**
 * One resolved context source: the wire-visible descriptor plus the CONTENT it
 * contributed. The content never leaves this module except into the prompt and
 * `pr_intent.trace` — the descriptor alone is what gets logged.
 */
export interface ResolvedSource extends IntentSource {
  content: string;
}

/** Build one resolved source; `chars` is always derived, never passed in. */
export function makeSource(
  kind: IntentSourceKind,
  ref: string,
  status: IntentSourceStatus,
  content = '',
): ResolvedSource {
  return { kind, ref, status, chars: content.length, content };
}

/**
 * The classifier's own record, persisted to `pr_intent.trace`. DB-only: it holds
 * the full prompt, so it is never written to a log.
 */
export interface IntentTrace {
  system: string;
  user: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
  /** The model's own confidence, before the server-side cap. */
  raw_confidence: IntentConfidence;
  duration_ms: number;
}

/** The full write payload for `IntentRepository.upsert`. */
export interface IntentUpsert {
  prId: string;
  summary: string;
  inScope: string[];
  outOfScope: string[];
  riskAreas: RiskArea[];
  sources: IntentSource[];
  confidence: IntentConfidence;
  provider: string;
  model: string;
  headSha: string;
  trace: IntentTrace;
}
