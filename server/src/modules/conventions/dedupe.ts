import { DEDUPE_SIMILARITY, GENERIC_RULE_PATTERNS } from './constants.js';
import type { DraftCandidate } from './types.js';

/**
 * PURE merge + noise filtering across the category fan-out.
 *
 * The fan-out is what produces the volume, and it is also what produces the
 * duplication: the `naming` pass and the `structure` pass looking at the same
 * files will both notice that repositories are the only place queries live.
 * Without this stage the user sees the same rule eight times and reads the whole
 * feature as broken.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'be', 'to', 'of', 'in', 'on', 'for', 'and',
  'or', 'not', 'never', 'always', 'must', 'should', 'use', 'uses', 'using',
  'this', 'that', 'it', 'its', 'with', 'via', 'all', 'any', 'every', 'each',
  'project', 'codebase', 'repo', 'repository', 'code',
]);

/**
 * Light suffix stemming so `declares`/`declare`/`declared` collapse.
 *
 * Deliberately crude — the goal is only to stop trivial inflection from
 * splitting one rule into two cards; a real stemmer would be a dependency for
 * no additional benefit here.
 */
function stem(token: string): string {
  if (token.includes('.') || token.includes('/')) return token; // paths & filenames stay literal
  let out = token;
  for (const suffix of ['ing', 'ies', 'ed', 'es', 's']) {
    if (out.length > suffix.length + 2 && out.endsWith(suffix)) {
      out = suffix === 'ies' ? `${out.slice(0, -3)}y` : out.slice(0, -suffix.length);
      break;
    }
  }
  // Drop a trailing `e` unconditionally so `declare` and `declared` (which the
  // suffix pass reduces to `declar`) land on the same stem.
  if (out.length > 4 && out.endsWith('e')) out = out.slice(0, -1);
  return out;
}

/**
 * Content tokens of a rule: lowercased, stopwords removed, lightly stemmed.
 *
 * Internal dots and slashes survive (`repository.ts`, `src/db`) because those
 * ARE the specific tokens that make a rule a house rule — but a token's leading
 * and trailing punctuation is stripped, so a sentence-final `mode.` matches a
 * mid-sentence `mode`.
 */
export function ruleTokens(rule: string): string[] {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^[._/-]+|[._/-]+$/g, ''))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Stable identity for a rule: sorted content tokens joined by `-`.
 *
 * Doubles as the DB's per-repo unique key, which is what makes a re-scan an
 * upsert — the user's accept/reject verdict survives a rescan instead of being
 * wiped and re-asked every time.
 */
export function ruleKeyFor(rule: string): string {
  const tokens = [...new Set(ruleTokens(rule))].sort();
  return tokens.join('-').slice(0, 200) || rule.toLowerCase().slice(0, 200);
}

/** Jaccard overlap of two rules' content tokens. */
export function similarity(a: string, b: string): number {
  const ta = new Set(ruleTokens(a));
  const tb = new Set(ruleTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Merge `b` into `a`: union the evidence, keep the stronger metadata. */
function mergeInto(a: DraftCandidate, b: DraftCandidate): DraftCandidate {
  const seen = new Set(a.evidence.map((e) => `${e.path}:${e.line}`));
  const evidence = [...a.evidence];
  for (const e of b.evidence) {
    const key = `${e.path}:${e.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push(e);
  }
  // A config-derived rule outranks an LLM restatement of it: its evidence is
  // the declaration itself, so keep that wording and origin.
  const primary = a.origin === 'config' ? a : b.origin === 'config' ? b : a;
  return {
    ...primary,
    evidence,
    confidence: Math.max(a.confidence, b.confidence),
    probe: a.probe ?? b.probe,
    rationale: primary.rationale ?? a.rationale ?? b.rationale,
  };
}

/**
 * Collapse duplicate rules. Exact `ruleKey` matches merge first (cheap), then a
 * token-overlap pass catches paraphrases the key missed.
 */
export function dedupeCandidates(candidates: DraftCandidate[]): DraftCandidate[] {
  const byKey = new Map<string, DraftCandidate>();
  for (const c of candidates) {
    const existing = byKey.get(c.ruleKey);
    byKey.set(c.ruleKey, existing ? mergeInto(existing, c) : c);
  }

  const out: DraftCandidate[] = [];
  for (const c of byKey.values()) {
    const near = out.findIndex((o) => similarity(o.rule, c.rule) >= DEDUPE_SIMILARITY);
    if (near === -1) out.push(c);
    else out[near] = mergeInto(out[near]!, c);
  }
  return out;
}

/**
 * Drop rules that are true of every TypeScript repo.
 *
 * Two filters: an explicit denylist of universal advice, and a structural check
 * — a HOUSE rule names something specific to this house (a path, a symbol, an
 * extension, a config key). "Use meaningful variable names" names nothing, and
 * turning it into a skill only teaches the reviewer to write filler comments.
 */
export function isGenericRule(rule: string): boolean {
  const lower = rule.toLowerCase();
  if (GENERIC_RULE_PATTERNS.some((p) => lower.includes(p))) return true;

  const hasSpecificToken =
    /`[^`]+`/.test(rule) || // a quoted identifier / path / config key
    /\b[\w.-]+\/[\w./-]+/.test(rule) || // a path segment
    /\b\w+\.(ts|tsx|js|jsx|json|md|sql|yml|yaml)\b/.test(rule) || // a filename
    /\b[a-z][a-zA-Z0-9]*[A-Z]\w*\b/.test(rule); // a camelCase identifier
  return !hasSpecificToken;
}

export function dropGeneric(candidates: DraftCandidate[]): DraftCandidate[] {
  return candidates.filter((c) => c.origin === 'config' || !isGenericRule(c.rule));
}
