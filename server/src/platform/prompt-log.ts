import { createHash } from 'node:crypto';

/**
 * Structured, content-free logging of how a prompt was assembled.
 *
 * The problem it solves: when a review comes back wrong, the first question is
 * "what actually went into the prompt" - which sections were present, where
 * each came from, how big it was, and which model saw it. Answering that by
 * logging the prompt is how a diff, a private spec, or an API key ends up in a
 * log aggregator forever.
 *
 * So the split is:
 *
 *   - **Logs carry metadata.** Section name, provenance, size, a fingerprint,
 *     the model, and a correlation id. Never a character of content.
 *   - **Content lives in the trace.** `run_traces.trace.prompt_assembly` and
 *     `pr_intent.trace` already hold the full text, in the database, scoped to
 *     one run and reachable only through an authenticated route.
 *
 * This mirrors the OpenTelemetry GenAI semantic conventions, where capturing
 * message content is opt-in and off by default because it "is likely to contain
 * sensitive information".
 *
 * The fingerprint is what makes the metadata actionable without the content:
 * two runs whose `sha8` matches per section had byte-identical prompts, so a
 * behaviour change came from the model, not from assembly.
 */

export type PromptLogMode = 'off' | 'summary' | 'verbose';

/** Longest outline line kept in verbose mode. */
const MAX_OUTLINE_LINE = 120;
/** Most outline lines kept per section in verbose mode. */
const MAX_OUTLINE_LINES = 12;

/**
 * Patterns for things that must never survive into a log line even by accident.
 * Nothing here should ever fire: outline lines are block headings, not content.
 * It exists because "should never" and "cannot" are different guarantees, and
 * this file is the last point where the difference is still cheap to enforce.
 */
const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, label: '[redacted:openai-key]' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, label: '[redacted:anthropic-key]' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, label: '[redacted:github-token]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, label: '[redacted:github-pat]' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, label: '[redacted:bearer]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: '[redacted:aws-key]' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: '[redacted:private-key]' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: '[redacted:jwt]' },
];

/** Replace anything secret-shaped. Applied to every string that reaches a log. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const { re, label } of SECRET_PATTERNS) out = out.replace(re, label);
  return out;
}

/**
 * One slot of an assembled prompt, as the caller knows it.
 *
 * `source` is provenance, and it is the field a reader actually reasons about:
 * `agent.system_prompt` and `github:pr.body` failing in the same way mean very
 * different things.
 */
export interface PromptSectionInput {
  section: string;
  source: string;
  text: string | null | undefined;
}

export interface PromptLogMeta {
  /** Ties every model call of one user action together, including across agents. */
  correlationId: string;
  /**
   * Which call this is. Two per review: the cheap classifier, then the
   * reviewer. `onboarding` is the one structured call of a tour generation.
   */
  call: 'intent' | 'review' | 'onboarding';
  provider: string;
  model: string;
  prId?: string;
  runId?: string;
  agent?: string;
}

export interface PromptSectionLog {
  section: string;
  source: string;
  chars: number;
  tokens: number;
  /** First 8 hex of sha256(content). Identical prompts fingerprint identically. */
  sha8: string;
  /** verbose only: block headings and untrusted wrappers, never body lines. */
  outline?: string[];
}

export interface PromptLogRecord {
  event: 'prompt.assembled';
  correlation_id: string;
  call: 'intent' | 'review' | 'onboarding';
  provider: string;
  model: string;
  pr_id?: string;
  run_id?: string;
  agent?: string;
  sections: PromptSectionLog[];
  totals: { sections: number; chars: number; tokens: number };
}

/**
 * A section's shape, not its content.
 *
 * Kept lines are structural only: markdown headings, and the opening tag of an
 * `<untrusted source="...">` wrapper (the tag itself, never what it wraps).
 * Everything else in a section is prose, code, or diff, and is dropped.
 */
function outlineOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const structural =
      /^#{1,6}\s/.test(line) || /^<untrusted\s+source="[^"]*">$/.test(line) || line === '</untrusted>';
    if (!structural) continue;
    const capped = line.length > MAX_OUTLINE_LINE ? `${line.slice(0, MAX_OUTLINE_LINE)}…` : line;
    out.push(scrubSecrets(capped));
    if (out.length >= MAX_OUTLINE_LINES) {
      out.push('… outline truncated');
      break;
    }
  }
  return out;
}

/**
 * Turn assembled sections into a log record. Text goes in; only metadata comes
 * out. That is the whole contract of this function, and it is what the test
 * asserts: no input substring longer than a heading can appear in the result.
 */
export function buildPromptLogRecord(
  meta: PromptLogMeta,
  sections: PromptSectionInput[],
  countTokens: (text: string) => number,
  mode: PromptLogMode,
): PromptLogRecord {
  const rows: PromptSectionLog[] = [];
  for (const { section, source, text } of sections) {
    if (text == null || text.length === 0) continue;
    const row: PromptSectionLog = {
      section,
      source,
      chars: text.length,
      tokens: countTokens(text),
      sha8: createHash('sha256').update(text).digest('hex').slice(0, 8),
    };
    if (mode === 'verbose') row.outline = outlineOf(text);
    rows.push(row);
  }

  return {
    event: 'prompt.assembled',
    correlation_id: meta.correlationId,
    call: meta.call,
    provider: meta.provider,
    model: meta.model,
    ...(meta.prId ? { pr_id: meta.prId } : {}),
    ...(meta.runId ? { run_id: meta.runId } : {}),
    ...(meta.agent ? { agent: meta.agent } : {}),
    sections: rows,
    totals: {
      sections: rows.length,
      chars: rows.reduce((n, r) => n + r.chars, 0),
      tokens: rows.reduce((n, r) => n + r.tokens, 0),
    },
  };
}

/** Minimal structured logger, pino-compatible. */
export type StructuredLogger = { info: (obj: unknown, msg?: string) => void };

/** Build and emit, unless the mode is `off`. */
export function logPromptAssembly(
  logger: StructuredLogger | undefined,
  mode: PromptLogMode,
  meta: PromptLogMeta,
  sections: PromptSectionInput[],
  countTokens: (text: string) => number,
): PromptLogRecord | undefined {
  if (mode === 'off' || !logger) return undefined;
  const record = buildPromptLogRecord(meta, sections, countTokens, mode);
  logger.info(record, `prompt assembled (${meta.call})`);
  return record;
}

/**
 * Provenance labels for the reviewer's prompt slots. Kept here rather than at
 * the call site so both the label and its meaning live with the contract that
 * defines the slot.
 */
export const REVIEW_SECTION_SOURCES: Record<string, string> = {
  system: 'agents.system_prompt + INJECTION_GUARD',
  intent: 'pr_intent (derived, cheap model)',
  skills: 'skills table (imports untrusted-wrapped)',
  memory: 'memory retrieval',
  specs: 'repo files (untrusted-wrapped)',
  repo_map: 'repo-intel skeleton',
  callers: 'repo-intel callers digest',
  pr_description: 'github:pr.body (untrusted-wrapped)',
  user: 'composed user message (includes the diff)',
};
