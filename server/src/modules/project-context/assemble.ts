/**
 * project-context — run-assembly rules. Pure: no Container, no I/O, no clock.
 *
 * These four functions are the whole of what "which documents, in what order,
 * at what size" means, so they are testable as a table without Postgres and
 * without a clone.
 */
import { approxTokens } from '../../adapters/tokenizer/index.js';
import { MAX_DOC_TOKENS, MAX_RUN_TOKENS } from './constants.js';

/**
 * The agent's own attachments in their stored order, then the documents it
 * inherits from enabled linked skills in the agent's skill-link order.
 */
export function orderAttachments<T>(direct: readonly T[], inherited: readonly T[]): T[] {
  return [...direct, ...inherited];
}

/**
 * A document reachable both directly and through a skill is included exactly
 * once, at its EARLIEST position — so the direct attachment's order wins and
 * its origin is the one recorded.
 */
export function dedupeByPath<T extends { path: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
  }
  return out;
}

export interface Truncation {
  text: string;
  truncated: boolean;
  /** Tokens the kept text contributes (excluding the marker line). */
  tokens: number;
}

/**
 * Cut `body` at the last Markdown heading that fits `maxTokens` and append
 * `[truncated: N of M tokens]` inside the block, so the model is told the
 * document is partial rather than silently reading half a rule.
 *
 * A document with no heading before the cap degrades to a hard cut at the cap.
 */
export function truncateAtHeading(body: string, maxTokens: number = MAX_DOC_TOKENS): Truncation {
  const total = approxTokens(body);
  if (total <= maxTokens) return { text: body, truncated: false, tokens: total };

  // `approxTokens` is `ceil(chars / 4)`, so the budget inverts exactly.
  const charBudget = maxTokens * 4;
  let cut = charBudget;

  const headings = [...body.matchAll(/^#{1,6} /gm)];
  let lastFitting = -1;
  for (const match of headings) {
    if (match.index === undefined) continue;
    if (match.index === 0) continue; // the document's own title is not a cut point
    if (match.index > charBudget) break;
    lastFitting = match.index;
  }
  if (lastFitting > 0) cut = lastFitting;

  const text = body.slice(0, cut).trimEnd();
  const kept = approxTokens(text);
  return {
    text: `${text}\n\n[truncated: ${kept} of ${total} tokens]`,
    truncated: true,
    tokens: kept,
  };
}

export interface BudgetSplit<T> {
  included: T[];
  /** The tail the budget could not fit; one Live Log line is emitted per entry. */
  dropped: T[];
}

/**
 * Include documents in order until the run budget is exhausted, then drop the
 * remainder. A tail drop, not a best-fit pack: order is the user's explicit
 * choice, so the set the user put first is the set that survives.
 */
export function applyRunBudget<T extends { tokens: number }>(
  items: readonly T[],
  budget: number = MAX_RUN_TOKENS,
): BudgetSplit<T> {
  const included: T[] = [];
  let used = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    if (used + item.tokens > budget) {
      return { included, dropped: items.slice(i) as T[] };
    }
    used += item.tokens;
    included.push(item);
  }
  return { included, dropped: [] };
}
