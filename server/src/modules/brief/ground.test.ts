import { describe, expect, it } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { buildCandidates } from './candidates.js';
import { groundBrief } from './ground.js';
import type { BriefDraft } from './schemas.js';
import { MAX_REVIEW_FOCUS, MAX_RISKS } from './constants.js';

/**
 * The whole AC-13 … AC-19 derivation table, as a table.
 *
 * Every case builds its candidate set through `buildCandidates`, never by hand,
 * so a change to how the union or the `@@` ranges are derived shows up here
 * rather than only in an integration run.
 */

const DIFF: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/auth.ts',
      additions: 4,
      deletions: 0,
      hunks: [
        { file: 'src/auth.ts', oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, newLineNumbers: [] },
        { file: 'src/auth.ts', oldStart: 40, oldLines: 0, newStart: 42, newLines: 2, newLineNumbers: [] },
      ],
    },
    { path: 'src/config.ts', additions: 1, deletions: 0, hunks: [] },
  ],
};

const CANDIDATES = buildCandidates({
  changedFiles: ['src/auth.ts', 'src/config.ts'],
  // `src/server.ts` is a CALLER file: in the union, but with no `@@` ranges.
  callerFiles: ['src/server.ts'],
  endpoints: ['GET /login'],
  crons: ['nightly-rotate'],
  diff: DIFF,
});

function draft(over: Partial<BriefDraft> = {}): BriefDraft {
  return {
    what: 'It touches the auth surface.',
    why: 'To rotate tokens.',
    risk_level: 'low',
    risks: [],
    review_focus: [],
    ...over,
  };
}

function risk(over: Partial<BriefDraft['risks'][number]> = {}): BriefDraft['risks'][number] {
  return {
    kind: 'auth surface',
    title: 'Token rotation touches login',
    explanation: 'The login path reads the rotated token.',
    severity: 'low',
    file_refs: ['src/auth.ts'],
    endpoints: [],
    crons: [],
    ...over,
  };
}

describe('groundBrief — files (AC-13)', () => {
  it('drops a risk whose every file is outside the union, and counts it once', () => {
    const out = groundBrief(
      draft({ risks: [risk({ file_refs: ['src/invented.ts', 'src/also-fake.ts'] })] }),
      CANDIDATES,
    );
    expect(out.risks).toEqual([]);
    expect(out.dropped.risks).toBe(1);
    // Counted ONCE as a risk, not twice more as two bad refs.
    expect(out.dropped.file_refs).toBe(0);
  });

  it('keeps a risk that names one real path and strikes the invented ones', () => {
    const out = groundBrief(
      draft({ risks: [risk({ file_refs: ['src/auth.ts', 'src/invented.ts'] })] }),
      CANDIDATES,
    );
    expect(out.risks).toHaveLength(1);
    expect(out.risks[0]!.file_refs).toEqual(['src/auth.ts']);
    expect(out.dropped.file_refs).toBe(1);
    expect(out.dropped.risks).toBe(0);
  });

  it('accepts a CALLER file as a risk reference', () => {
    const out = groundBrief(draft({ risks: [risk({ file_refs: ['src/server.ts'] })] }), CANDIDATES);
    expect(out.risks[0]!.file_refs).toEqual(['src/server.ts']);
  });

  it('drops a review-focus entry naming a file outside the union', () => {
    const out = groundBrief(
      draft({ review_focus: [{ file: 'src/nope.ts', line: null, reason: 'r' }] }),
      CANDIDATES,
    );
    expect(out.review_focus).toEqual([]);
    expect(out.dropped.focus).toBe(1);
  });
});

describe('groundBrief — endpoints and jobs (AC-14)', () => {
  it('counts an invented endpoint and an invented job, and serves neither list', () => {
    const out = groundBrief(
      draft({
        risks: [
          risk({ endpoints: ['GET /login', 'POST /invented'], crons: ['made-up-job'] }),
        ],
      }),
      CANDIDATES,
    );
    expect(out.dropped.endpoints).toBe(1);
    expect(out.dropped.crons).toBe(1);
    // AC-14 by construction: no endpoint or job string reaches the wire at all.
    expect(JSON.stringify(out.risks)).not.toContain('/login');
    expect(JSON.stringify(out.risks)).not.toContain('made-up-job');
  });

  it('grades endpoints of a risk that is itself dropped', () => {
    const out = groundBrief(
      draft({ risks: [risk({ file_refs: ['src/fake.ts'], endpoints: ['POST /invented'] })] }),
      CANDIDATES,
    );
    expect(out.dropped.risks).toBe(1);
    expect(out.dropped.endpoints).toBe(1);
  });
});

describe('groundBrief — lines (AC-15, AC-16)', () => {
  it.each([
    ['inside the first hunk', 10, 10],
    ['at the end of the first hunk', 13, 13],
    ['inside the second hunk', 43, 43],
    ['one past the first hunk', 14, null],
    ['before every hunk', 1, null],
    ['far outside the file', 4000, null],
  ])('a line %s grounds to %s', (_name, line, expected) => {
    const out = groundBrief(
      draft({ review_focus: [{ file: 'src/auth.ts', line, reason: 'r' }] }),
      CANDIDATES,
    );
    expect(out.review_focus).toHaveLength(1);
    expect(out.review_focus[0]!.line).toBe(expected);
  });

  it('keeps the entry at file level when the line is dropped, and counts the line', () => {
    const out = groundBrief(
      draft({ review_focus: [{ file: 'src/auth.ts', line: 4000, reason: 'read this' }] }),
      CANDIDATES,
    );
    expect(out.review_focus).toEqual([{ file: 'src/auth.ts', line: null, reason: 'read this' }]);
    expect(out.dropped.lines).toBe(1);
    expect(out.dropped.focus).toBe(0);
  });

  it('never lets a caller line become a location in the PR (AC-16)', () => {
    // The blast result carried a caller at src/server.ts:512 — a position in the
    // DEFAULT BRANCH. The model repeated it. The entry must survive at file
    // level with no line, because a caller file has no `@@` ranges at all.
    const out = groundBrief(
      draft({ review_focus: [{ file: 'src/server.ts', line: 512, reason: 'it calls the change' }] }),
      CANDIDATES,
    );
    expect(out.review_focus).toEqual([
      { file: 'src/server.ts', line: null, reason: 'it calls the change' },
    ]);
    expect(out.dropped.lines).toBe(1);
  });

  it('drops a line for a changed file the diff carried with no hunks', () => {
    const out = groundBrief(
      draft({ review_focus: [{ file: 'src/config.ts', line: 12, reason: 'r' }] }),
      CANDIDATES,
    );
    expect(out.review_focus[0]!.line).toBeNull();
  });

  it.each([0, -3, 1.5])('rejects the nonsensical line %s without dropping the entry', (line) => {
    const out = groundBrief(
      draft({ review_focus: [{ file: 'src/auth.ts', line, reason: 'r' }] }),
      CANDIDATES,
    );
    expect(out.review_focus[0]!.line).toBeNull();
  });
});

describe('groundBrief — counts, emptiness and the risk level (AC-17 … AC-19)', () => {
  it('reports non-zero counts for a draft naming two invented paths (AC-17)', () => {
    const out = groundBrief(
      draft({
        risks: [risk({ file_refs: ['src/ghost-a.ts'] })],
        review_focus: [{ file: 'src/ghost-b.ts', line: 3, reason: 'r' }],
      }),
      CANDIDATES,
    );
    expect(out.dropped.risks).toBe(1);
    expect(out.dropped.focus).toBe(1);
  });

  it('returns an empty but valid brief when everything is dropped (AC-18)', () => {
    const out = groundBrief(
      draft({
        risk_level: 'high',
        risks: [risk({ file_refs: ['nope.ts'] })],
        review_focus: [{ file: 'nope.ts', line: 1, reason: 'r' }],
      }),
      CANDIDATES,
    );
    expect(out.risks).toEqual([]);
    expect(out.review_focus).toEqual([]);
    expect(out.prose.what).toBe('It touches the auth surface.');
    expect(out.risk_level).toBe('low');
  });

  it('caps a claimed high at the highest surviving severity (AC-19)', () => {
    const out = groundBrief(
      draft({
        risk_level: 'high',
        risks: [
          risk({ severity: 'high', file_refs: ['src/ghost.ts'] }),
          risk({ severity: 'low', file_refs: ['src/auth.ts'] }),
        ],
      }),
      CANDIDATES,
    );
    expect(out.risks).toHaveLength(1);
    expect(out.risk_level).toBe('low');
  });

  it('does not RAISE a level the model understated', () => {
    const out = groundBrief(
      draft({ risk_level: 'low', risks: [risk({ severity: 'high' })] }),
      CANDIDATES,
    );
    expect(out.risk_level).toBe('low');
  });

  it('is low when no risk survives at all', () => {
    expect(groundBrief(draft({ risk_level: 'high' }), CANDIDATES).risk_level).toBe('low');
  });
});

describe('groundBrief — caps preserve the model order (AC-39)', () => {
  it('keeps the first MAX_RISKS in order and does not count the rest as dropped', () => {
    const many = Array.from({ length: MAX_RISKS + 3 }, (_v, i) =>
      risk({ title: `risk-${i}`, file_refs: ['src/auth.ts'] }),
    );
    const out = groundBrief(draft({ risks: many }), CANDIDATES);
    expect(out.risks).toHaveLength(MAX_RISKS);
    expect(out.risks.map((r) => r.title)).toEqual(
      many.slice(0, MAX_RISKS).map((r) => r.title),
    );
    expect(out.dropped.risks).toBe(0);
  });

  it('keeps the first MAX_REVIEW_FOCUS entries in order', () => {
    const many = Array.from({ length: MAX_REVIEW_FOCUS + 4 }, (_v, i) => ({
      file: 'src/auth.ts',
      line: null,
      reason: `reason-${i}`,
    }));
    const out = groundBrief(draft({ review_focus: many }), CANDIDATES);
    expect(out.review_focus).toHaveLength(MAX_REVIEW_FOCUS);
    expect(out.review_focus.map((e) => e.reason)).toEqual(
      many.slice(0, MAX_REVIEW_FOCUS).map((e) => e.reason),
    );
    expect(out.dropped.focus).toBe(0);
  });
});
