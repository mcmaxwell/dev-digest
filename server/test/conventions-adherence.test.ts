import { describe, it, expect } from 'vitest';
import type { CodeIndex, CodeMatch, RepoRef } from '@devdigest/shared';
import { isSafeProbePattern, scoreAdherence } from '../src/modules/conventions/adherence.js';
import {
  MIN_ADHERENCE,
  PROBE_MAX_PATTERN_LENGTH,
  UNPROBED_CONFIDENCE_CAP,
} from '../src/modules/conventions/constants.js';
import type { DraftCandidate } from '../src/modules/conventions/types.js';

const REF: RepoRef = { owner: 'acme', name: 'payments-api' };

/** CodeIndex stub whose grep result is driven per pattern. */
function stubIndex(counts: Record<string, number>, opts: { hang?: boolean } = {}): CodeIndex {
  return {
    async grep(_repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
      if (opts.hang) await new Promise((r) => setTimeout(r, 30_000));
      const n = counts[pattern] ?? 0;
      return Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, line: i + 1, text: pattern }));
    },
    async symbols() {
      return [];
    },
    async references() {
      return [];
    },
  };
}

const draft = (over: Partial<DraftCandidate> = {}): DraftCandidate => ({
  category: 'async',
  rule: 'Use `await` instead of `.then()` chains.',
  evidence: [{ path: 'src/a.ts', line: 1, snippet: 'await db.find()', verified: 'exact' }],
  confidence: 0.6,
  origin: 'llm',
  ruleKey: 'await-then-chains',
  probe: { positive: 'await ', negative: '\\.then\\(' },
  ...over,
});

describe('probe safety (model-authored regexes are untrusted input)', () => {
  it('accepts an ordinary pattern', () => {
    expect(isSafeProbePattern('\\.then\\(')).toBe(true);
  });

  it('rejects a pattern that does not compile', () => {
    expect(isSafeProbePattern('([a-z')).toBe(false);
  });

  it('rejects an over-long pattern', () => {
    expect(isSafeProbePattern('a'.repeat(PROBE_MAX_PATTERN_LENGTH + 1))).toBe(false);
  });

  it('rejects nested quantifiers (catastrophic backtracking)', () => {
    expect(isSafeProbePattern('(a+)+$')).toBe(false);
    expect(isSafeProbePattern('(?:ab*)*c')).toBe(false);
  });

  it('rejects an empty pattern', () => {
    expect(isSafeProbePattern('')).toBe(false);
  });
});

describe('adherence scoring', () => {
  it('keeps a rule the repo overwhelmingly follows and records the measurement', async () => {
    const scored = await scoreAdherence(
      [draft()],
      stubIndex({ 'await ': 47, '\\.then\\(': 3 }),
      REF,
    );

    expect(scored).toHaveLength(1);
    expect(scored[0]!.support).toBe(47);
    expect(scored[0]!.violations).toBe(3);
    expect(scored[0]!.adherence).toBeCloseTo(0.94, 2);
    // A measured rule earns confidence beyond what the model claimed.
    expect(scored[0]!.confidence).toBeCloseTo(0.94, 2);
  });

  it('DROPS a rule the repo follows only half the time — that is a preference, not a rule', async () => {
    const scored = await scoreAdherence(
      [draft()],
      stubIndex({ 'await ': 10, '\\.then\\(': 10 }),
      REF,
    );
    expect(scored).toEqual([]);
  });

  it('keeps a candidate whose probe measured too little, at capped confidence', async () => {
    const scored = await scoreAdherence(
      [draft({ confidence: 0.95 })],
      stubIndex({ 'await ': 1, '\\.then\\(': 0 }),
      REF,
    );
    expect(scored).toHaveLength(1);
    expect(scored[0]!.adherence).toBeUndefined();
    expect(scored[0]!.confidence).toBe(UNPROBED_CONFIDENCE_CAP);
  });

  it('caps confidence for a candidate that shipped no probe at all', async () => {
    const scored = await scoreAdherence([draft({ probe: undefined, confidence: 0.99 })], stubIndex({}), REF);
    expect(scored[0]!.confidence).toBe(UNPROBED_CONFIDENCE_CAP);
  });

  it('discards an unsafe probe but keeps the candidate', async () => {
    const scored = await scoreAdherence(
      [draft({ probe: { positive: '(a+)+', negative: '\\.then\\(' } })],
      stubIndex({ 'await ': 99 }),
      REF,
    );
    expect(scored).toHaveLength(1);
    expect(scored[0]!.probe).toBeUndefined();
    expect(scored[0]!.adherence).toBeUndefined();
  });

  it('treats a hanging grep as unmeasured rather than as a violation', async () => {
    // A probe that times out says nothing about the repo — deleting the
    // candidate would turn an infrastructure hiccup into a lost finding.
    const scored = await scoreAdherence(
      [draft({ confidence: 0.95 })],
      stubIndex({}, { hang: true }),
      REF,
    );
    expect(scored).toHaveLength(1);
    expect(scored[0]!.adherence).toBeUndefined();
    expect(scored[0]!.confidence).toBe(UNPROBED_CONFIDENCE_CAP);
  }, 15_000);

  it('the unprobed cap is a ceiling, not a floor — a low-confidence rule stays low', async () => {
    const scored = await scoreAdherence([draft({ probe: undefined, confidence: 0.3 })], stubIndex({}), REF);
    expect(scored[0]!.confidence).toBe(0.3);
  });

  it('never re-scores or downgrades a config-derived candidate', async () => {
    const scored = await scoreAdherence(
      [draft({ origin: 'config', confidence: 1, probe: undefined })],
      stubIndex({}),
      REF,
    );
    expect(scored[0]!.confidence).toBe(1);
  });

  it('uses MIN_ADHERENCE as the boundary', async () => {
    const justUnder = await scoreAdherence(
      [draft()],
      stubIndex({ 'await ': 79, '\\.then\\(': 21 }),
      REF,
    );
    const justOver = await scoreAdherence(
      [draft()],
      stubIndex({ 'await ': 81, '\\.then\\(': 19 }),
      REF,
    );
    expect(0.79).toBeLessThan(MIN_ADHERENCE);
    expect(justUnder).toEqual([]);
    expect(justOver).toHaveLength(1);
  });
});
