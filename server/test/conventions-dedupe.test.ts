import { describe, it, expect } from 'vitest';
import {
  dedupeCandidates,
  dropGeneric,
  isGenericRule,
  ruleKeyFor,
  similarity,
} from '../src/modules/conventions/dedupe.js';
import type { DraftCandidate } from '../src/modules/conventions/types.js';

const draft = (rule: string, over: Partial<DraftCandidate> = {}): DraftCandidate => ({
  category: 'structure',
  rule,
  evidence: [{ path: 'src/a.ts', line: 1, snippet: 'x', verified: 'exact' }],
  confidence: 0.8,
  origin: 'llm',
  ruleKey: ruleKeyFor(rule),
  ...over,
});

describe('conventions dedupe', () => {
  it('builds an order-independent rule key so reordered wording collides', () => {
    expect(ruleKeyFor('Only a `repository.ts` builds queries.')).toBe(
      ruleKeyFor('Queries are built only in a `repository.ts`.'.replace('built', 'building')),
    );
  });

  it('ignores sentence punctuation and inflection when keying', () => {
    expect(ruleKeyFor('Route handlers declare a `zod` schema.')).toBe(
      ruleKeyFor('A `zod` schema is declared by route handlers'),
    );
  });

  it('scores overlap between rule texts', () => {
    expect(similarity('Routes declare `zod` schemas', 'Routes declare zod schemas')).toBe(1);
    expect(similarity('Routes declare zod schemas', 'Tests use vitest fake timers')).toBe(0);
  });

  it('merges the same rule found by two different category passes', () => {
    // The `structure` and `types` passes both notice the repository boundary —
    // without this merge the user sees the same card twice and reads the whole
    // feature as broken.
    const merged = dedupeCandidates([
      draft('Only a `repository.ts` builds queries with the drizzle query builder.', {
        category: 'structure',
        evidence: [{ path: 'src/a.ts', line: 3, snippet: 'db.select()', verified: 'exact' }],
        confidence: 0.6,
      }),
      draft('Only a `repository.ts` builds queries using the drizzle query builder', {
        category: 'types',
        evidence: [{ path: 'src/b.ts', line: 9, snippet: 'db.insert()', verified: 'exact' }],
        confidence: 0.9,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.evidence.map((e) => e.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(merged[0]!.confidence).toBe(0.9);
  });

  it('collapses near-duplicates the exact key missed', () => {
    const merged = dedupeCandidates([
      draft('Every route file declares a `zod` body schema before the handler runs.'),
      draft('Every route file declares a `zod` body schema before its handler runs.'),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('does NOT collapse two genuinely different rules', () => {
    const merged = dedupeCandidates([
      draft('Only `repository.ts` builds queries.'),
      draft('Tests hitting Postgres are named `*.it.test.ts`.'),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps the config wording when an LLM restates a config-derived rule', () => {
    const merged = dedupeCandidates([
      draft('TypeScript runs in `strict` mode.', { origin: 'config', confidence: 1 }),
      draft('`strict` mode TypeScript runs.', { origin: 'llm', confidence: 0.5 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.origin).toBe('config');
  });

  it('does not carry evidence across a merge twice', () => {
    const same = { path: 'src/a.ts', line: 1, snippet: 'x', verified: 'exact' as const };
    const merged = dedupeCandidates([
      draft('Only `repository.ts` builds queries.', { evidence: [same] }),
      draft('Queries are built only in `repository.ts`.', { evidence: [same] }),
    ]);
    expect(merged[0]!.evidence).toHaveLength(1);
  });
});

describe('generic-rule filter', () => {
  it.each([
    'Use meaningful names for variables.',
    'Always handle errors properly.',
    'Write tests for new code.',
    'Follow best practices throughout the codebase.',
  ])('rejects universal advice: %s', (rule) => {
    expect(isGenericRule(rule)).toBe(true);
  });

  it.each([
    'DB-backed tests are named `*.it.test.ts`.',
    'Route validation goes through fastify-type-provider-zod, never `req.body` parsing.',
    'Cross-module reads use a Container getter such as reposRepo.',
    'Migrations live under src/db/migrations and are generated, never hand-edited.',
  ])('keeps a rule naming something specific: %s', (rule) => {
    expect(isGenericRule(rule)).toBe(false);
  });

  it('never drops a config-derived rule, even if its wording reads generic', () => {
    const kept = dropGeneric([
      draft('Use TypeScript strictly.', { origin: 'config' }),
      draft('Use TypeScript strictly.', { origin: 'llm' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.origin).toBe('config');
  });
});
