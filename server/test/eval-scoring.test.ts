import { describe, it, expect } from 'vitest';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import {
  aggregate,
  averageRepeats,
  f1,
  overlaps,
  pairCases,
  scoreCase,
  wilson,
  type CaseScore,
} from '../src/modules/eval/scoring.js';

/** A finding with only the fields the scorer reads set meaningfully. */
function finding(file: string, start: number, end = start): Finding {
  return {
    id: `f-${file}-${start}`,
    severity: 'CRITICAL',
    category: 'security',
    title: 'x',
    file,
    start_line: start,
    end_line: end,
    rationale: 'x',
    suggestion: null,
    confidence: 0.9,
  } as Finding;
}

function expect_(
  kind: EvalExpectation['kind'],
  file: string,
  start: number,
  end = start,
): EvalExpectation {
  return { kind, file, start_line: start, end_line: end };
}

describe('overlaps', () => {
  it('needs the same file', () => {
    expect(overlaps(finding('a.ts', 10), expect_('must_find', 'b.ts', 10))).toBe(false);
  });

  it.each([
    ['identical', 10, 10, 10, 10, true],
    ['finding contained in expectation', 12, 12, 10, 14, true],
    ['expectation contained in finding', 10, 20, 12, 14, true],
    ['touching at the low edge', 8, 10, 10, 12, true],
    ['touching at the high edge', 10, 12, 8, 10, true],
    ['adjacent but disjoint', 8, 9, 10, 12, false],
    ['far apart', 1, 2, 90, 99, false],
  ])('%s', (_name, fs, fe, es, ee, want) => {
    expect(overlaps(finding('a.ts', fs, fe), expect_('must_find', 'a.ts', es, ee))).toBe(want);
  });

  it('normalises a reversed range rather than missing the match', () => {
    // Nothing stops a model emitting end_line < start_line.
    expect(overlaps(finding('a.ts', 14, 10), expect_('must_find', 'a.ts', 12))).toBe(true);
  });
});

describe('scoreCase', () => {
  it('scores a must_find the agent hit', () => {
    const s = scoreCase([expect_('must_find', 'src/config.ts', 12)], [finding('src/config.ts', 12)], 0);
    expect(s.pass).toBe(true);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.citation_accuracy).toBe(1);
  });

  it('scores a must_find the agent missed', () => {
    const s = scoreCase([expect_('must_find', 'src/config.ts', 12)], [], 0);
    expect(s.pass).toBe(false);
    expect(s.recall).toBe(0);
    // Nothing was claimed, so nothing claimed was wrong.
    expect(s.precision).toBe(1);
  });

  it('fails a must_not_flag the agent flagged anyway', () => {
    const s = scoreCase(
      [expect_('must_not_flag', 'src/util.ts', 5, 7)],
      [finding('src/util.ts', 6)],
      0,
    );
    expect(s.pass).toBe(false);
    expect(s.violated_must_not_flag).toBe(1);
    // The flagged line matches no must_find, so it is a false positive.
    expect(s.precision).toBe(0);
  });

  it('passes a must_not_flag the agent stayed quiet about', () => {
    const s = scoreCase([expect_('must_not_flag', 'src/util.ts', 5)], [], 0);
    expect(s.pass).toBe(true);
    expect(s.recall).toBe(1);
  });

  it('counts an unexpected finding as a false positive without failing the case', () => {
    // This is the strict-precision rule the prompt-corruption experiment rests on.
    const s = scoreCase(
      [expect_('must_find', 'src/config.ts', 12)],
      [finding('src/config.ts', 12), finding('src/unrelated.ts', 3)],
      0,
    );
    expect(s.pass).toBe(true);
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(1);
  });

  it('treats any finding on a clean case as a false positive', () => {
    const s = scoreCase([], [finding('src/a.ts', 1)], 0);
    expect(s.precision).toBe(0);
    expect(s.recall).toBe(1); // nothing was required
    expect(s.pass).toBe(true); // and nothing was forbidden
  });

  it('reads citation accuracy from the grounding gate, not from the expectations', () => {
    const s = scoreCase([expect_('must_find', 'a.ts', 1)], [finding('a.ts', 1)], 3);
    expect(s.citation_accuracy).toBe(0.25);
  });

  it('gives every empty denominator a stated value', () => {
    const s = scoreCase([], [], 0);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.citation_accuracy).toBe(1);
  });

  it('counts one finding covering two expectations as hitting both', () => {
    const s = scoreCase(
      [expect_('must_find', 'a.ts', 10), expect_('must_find', 'a.ts', 14)],
      [finding('a.ts', 8, 20)],
      0,
    );
    expect(s.recall).toBe(1);
    expect(s.matched_must_find).toBe(2);
  });
});

describe('f1', () => {
  it('is 0 when both inputs are 0', () => expect(f1(0, 0)).toBe(0));
  it('is the harmonic mean', () => expect(f1(1, 0.5)).toBeCloseTo(2 / 3, 10));
  it('punishes the emit-nothing prompt that scores precision 1', () =>
    expect(f1(1, 0)).toBe(0));
  it('punishes the flag-everything prompt that scores recall 1', () =>
    expect(f1(0, 1)).toBe(0));
});

describe('aggregate', () => {
  it('micro-averages over summed counts, not over per-case ratios', () => {
    // Case A: 1 of 1 expectations. Case B: 0 of 9. A macro average would call
    // this 50% recall; the honest number is 1 of 10.
    const a = scoreCase([expect_('must_find', 'a.ts', 1)], [finding('a.ts', 1)], 0);
    const b = scoreCase(
      Array.from({ length: 9 }, (_, i) => expect_('must_find', 'b.ts', i + 1)),
      [],
      0,
    );
    expect(aggregate([a, b]).recall).toBeCloseTo(0.1, 10);
  });

  it('counts passing traces', () => {
    const pass = scoreCase([], [], 0);
    const fail = scoreCase([expect_('must_find', 'a.ts', 1)], [], 0);
    const agg = aggregate([pass, fail, pass]);
    expect(agg.traces_passed).toBe(2);
    expect(agg.traces_total).toBe(3);
  });

  it('returns the stated values for an empty set', () => {
    const agg = aggregate([]);
    expect(agg).toMatchObject({ recall: 1, precision: 1, citation_accuracy: 1, traces_total: 0 });
  });
});

describe('averageRepeats', () => {
  const pass = scoreCase([expect_('must_find', 'a.ts', 1)], [finding('a.ts', 1)], 0);
  const fail = scoreCase([expect_('must_find', 'a.ts', 1)], [], 0);

  it('is the identity for a single run', () => {
    expect(averageRepeats([pass])).toBe(pass);
  });

  it('takes the majority verdict', () => {
    expect(averageRepeats([pass, pass, fail]).pass).toBe(true);
    expect(averageRepeats([pass, fail, fail]).pass).toBe(false);
  });

  it('does not call a 50/50 split a pass', () => {
    expect(averageRepeats([pass, fail]).pass).toBe(false);
  });

  it('averages the ratios while the verdict stays binary', () => {
    expect(averageRepeats([pass, pass, fail]).recall).toBeCloseTo(2 / 3, 10);
  });
});

describe('wilson', () => {
  it('spans everything when nothing has run', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  it('stays inside [0,1] at the boundary, where the normal approximation does not', () => {
    const [lo, hi] = wilson(8, 8);
    expect(lo).toBeGreaterThan(0.6);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('matches the known interval for 17/20', () => {
    const [lo, hi] = wilson(17, 20);
    expect(lo).toBeCloseTo(0.6396, 4);
    expect(hi).toBeCloseTo(0.9476, 4);
  });

  it('is wide enough on an 8-case set that one flipped case is not progress', () => {
    const [lo, hi] = wilson(6, 8);
    expect(hi - lo).toBeGreaterThan(0.4);
  });
});

describe('pairCases', () => {
  const c = (id: string, name: string, pass: boolean | null) => ({
    case_id: id,
    case_name: name,
    pass,
  });

  it('marks gained, lost and unchanged', () => {
    const deltas = pairCases(
      [c('1', 'kept', true), c('2', 'regressed', true), c('3', 'fixed', false)],
      [c('1', 'kept', true), c('2', 'regressed', false), c('3', 'fixed', true)],
    );
    const by = Object.fromEntries(deltas.map((d) => [d.case_id, d.change]));
    expect(by).toEqual({ '1': 'unchanged', '2': 'lost', '3': 'gained' });
  });

  it('reports a case that exists in only one run instead of dropping it', () => {
    const deltas = pairCases([c('1', 'old', true)], [c('1', 'old', true), c('2', 'new', false)]);
    expect(deltas.find((d) => d.case_id === '2')?.change).toBe('missing_left');
    expect(deltas.find((d) => d.case_id === '2')?.left_pass).toBeNull();
  });

  it('sorts what moved to the top', () => {
    const deltas = pairCases(
      [c('1', 'a', true), c('2', 'b', true)],
      [c('1', 'a', true), c('2', 'b', false)],
    );
    expect(deltas[0]?.change).toBe('lost');
  });
});
