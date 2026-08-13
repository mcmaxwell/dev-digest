/**
 * project-context — run-assembly rule tests. Pure, no DB, no clone.
 *
 * Ordering (AC-31), dedup (AC-32), heading-boundary truncation and its marker
 * (AC-35), and the 20k run budget dropping the tail (AC-36).
 */
import { describe, it, expect } from 'vitest';
import {
  orderAttachments,
  dedupeByPath,
  truncateAtHeading,
  applyRunBudget,
} from './assemble.js';
import { MAX_DOC_TOKENS, MAX_RUN_TOKENS } from './constants.js';

const ref = (path: string, origin: string) => ({ path, origin });

describe('orderAttachments', () => {
  it('puts the agent’s own attachments before skill-inherited ones', () => {
    const direct = [ref('specs/a.md', 'agent'), ref('docs/b.md', 'agent')];
    const inherited = [ref('specs/c.md', 'skill:Security'), ref('docs/d.md', 'skill:API')];

    expect(orderAttachments(direct, inherited)).toEqual([
      ref('specs/a.md', 'agent'),
      ref('docs/b.md', 'agent'),
      ref('specs/c.md', 'skill:Security'),
      ref('docs/d.md', 'skill:API'),
    ]);
  });

  it('contributes nothing when a skill supplied nothing (disabled upstream)', () => {
    const direct = [ref('specs/a.md', 'agent')];
    expect(orderAttachments(direct, [])).toEqual(direct);
    expect(orderAttachments([], [])).toEqual([]);
  });
});

describe('dedupeByPath', () => {
  it('keeps the earliest position when a document is reachable twice', () => {
    const ordered = orderAttachments(
      [ref('specs/a.md', 'agent')],
      [ref('specs/a.md', 'skill:Security'), ref('docs/b.md', 'skill:Security')],
    );

    expect(dedupeByPath(ordered)).toEqual([
      ref('specs/a.md', 'agent'),
      ref('docs/b.md', 'skill:Security'),
    ]);
  });

  it('keeps the first of two skills contributing the same document', () => {
    const items = [ref('specs/a.md', 'skill:First'), ref('specs/a.md', 'skill:Second')];
    expect(dedupeByPath(items)).toEqual([ref('specs/a.md', 'skill:First')]);
  });
});

describe('truncateAtHeading', () => {
  it('leaves a document at or under the ceiling byte-identical', () => {
    const body = '# Title\n\nshort body';
    expect(truncateAtHeading(body)).toEqual({
      text: body,
      truncated: false,
      tokens: Math.ceil(body.length / 4),
    });
  });

  it('cuts at the last heading that fits and appends the marker', () => {
    const filler = 'x'.repeat(200);
    const body =
      `# Title\n\n${filler}\n\n` +
      `## Kept\n\n${'y'.repeat(400)}\n\n` +
      `## Dropped\n\n${'z'.repeat(4000)}\n`;
    // A ceiling that lands between the two `##` headings.
    const maxTokens = Math.ceil((body.indexOf('## Dropped') + 50) / 4);

    const result = truncateAtHeading(body, maxTokens);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('## Kept');
    expect(result.text).not.toContain('## Dropped');
    expect(result.text).toMatch(/\n\n\[truncated: \d+ of \d+ tokens\]$/);
    // The marker reports the kept tokens against the document's real size.
    const [, kept, total] = result.text.match(/\[truncated: (\d+) of (\d+) tokens\]/)!;
    expect(Number(kept)).toBe(result.tokens);
    expect(Number(total)).toBe(Math.ceil(body.length / 4));
    expect(Number(kept)).toBeLessThan(Number(total));
  });

  it('hard-cuts a document with no heading, with the same marker', () => {
    const body = 'plain prose with no headings at all. '.repeat(2000);
    const result = truncateAtHeading(body, 100);

    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('plain prose')).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(100);
    expect(result.text).toMatch(/\[truncated: \d+ of \d+ tokens\]$/);
  });

  it('never treats the document’s own title as the cut point', () => {
    const body = `# Only heading\n\n${'x'.repeat(80_000)}`;
    const result = truncateAtHeading(body, 100);

    expect(result.text.startsWith('# Only heading')).toBe(true);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('defaults to the 8,000-token per-document ceiling', () => {
    const body = 'x'.repeat(MAX_DOC_TOKENS * 4 + 4000);
    const result = truncateAtHeading(body);

    expect(result.truncated).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(MAX_DOC_TOKENS);
  });
});

describe('applyRunBudget', () => {
  const doc = (path: string, tokens: number) => ({ path, tokens });

  it('includes everything that fits', () => {
    const items = [doc('a', 10), doc('b', 20)];
    expect(applyRunBudget(items, 100)).toEqual({ included: items, dropped: [] });
  });

  it('drops the tail once the budget is exhausted', () => {
    const items = [doc('a', 60), doc('b', 30), doc('c', 30), doc('d', 5)];
    const result = applyRunBudget(items, 100);

    expect(result.included).toEqual([doc('a', 60), doc('b', 30)]);
    // A tail drop, not a best-fit pack: `d` would have fitted, and is still
    // dropped, because order is the user's explicit choice.
    expect(result.dropped).toEqual([doc('c', 30), doc('d', 5)]);
  });

  it('drops everything when the first document alone exceeds the budget', () => {
    const items = [doc('a', 500), doc('b', 1)];
    expect(applyRunBudget(items, 100)).toEqual({ included: [], dropped: items });
  });

  it('defaults to the 20,000-token run budget', () => {
    const items = [doc('a', MAX_RUN_TOKENS), doc('b', 1)];
    const result = applyRunBudget(items);

    expect(result.included).toEqual([doc('a', MAX_RUN_TOKENS)]);
    expect(result.dropped).toEqual([doc('b', 1)]);
  });
});
