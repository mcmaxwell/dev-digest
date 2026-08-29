import { describe, it, expect } from 'vitest';
import { SEED_EVAL_CASES } from '../src/db/seed-eval-cases.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { groundFindings } from '@devdigest/reviewer-core';
import type { Finding } from '@devdigest/shared';

/**
 * The seeded gold set has to be CORRECT, not merely present. An expectation
 * whose line sits outside its own diff can never be matched: the grounding gate
 * drops any finding citing it, so the case scores zero forever and looks like
 * an agent failure rather than the authoring mistake it is. These assertions
 * are cheap and they fail loudly the moment a fixture is edited carelessly.
 */
describe('seeded eval gold set', () => {
  it('meets the minimum set size', () => {
    expect(SEED_EVAL_CASES.length).toBeGreaterThanOrEqual(8);
  });

  it('spans all four composition kinds', () => {
    // A set of only `floor` cases ceilings at 100% and measures nothing.
    const kinds = new Set(SEED_EVAL_CASES.map((c) => c.notes.split('·')[0]!.trim()));
    expect([...kinds].sort()).toEqual(['clean', 'floor', 'headroom', 'noise']);
  });

  it('has a case of each expectation kind', () => {
    const all = SEED_EVAL_CASES.flatMap((c) => c.expectations);
    expect(all.some((e) => e.kind === 'must_find')).toBe(true);
    expect(all.some((e) => e.kind === 'must_not_flag')).toBe(true);
    expect(SEED_EVAL_CASES.some((c) => c.expectations.length === 0)).toBe(true);
  });

  it('has unique case names', () => {
    const names = SEED_EVAL_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(SEED_EVAL_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const diff = parseUnifiedDiff(c.inputDiff);

    it('parses to exactly one file', () => {
      // Single-file cases keep one case to one engine call, which is what makes
      // the per-case model-call assertion in the integration test exact.
      expect(diff.files).toHaveLength(1);
    });

    it('places every expectation where a finding citing it would survive grounding', () => {
      // Asserted through the real gate rather than against a line index: what
      // matters is not that the number looks plausible, but that a correct
      // finding at that location is actually KEPT. An expectation the gate
      // would drop can never be matched, so the case would score zero forever
      // and read as an agent failure instead of an authoring mistake.
      for (const e of c.expectations) {
        const probe = {
          id: 'probe',
          severity: 'CRITICAL',
          category: 'security',
          title: e.title ?? 'probe',
          file: e.file,
          start_line: e.start_line,
          end_line: e.end_line,
          rationale: 'probe',
          suggestion: null,
          confidence: 1,
        } as Finding;
        const { kept, dropped } = groundFindings([probe], diff);
        expect(
          kept,
          `${e.file}:${e.start_line}-${e.end_line} would be dropped: ${dropped[0]?.reason}`,
        ).toHaveLength(1);
      }
    });
  });
});
