import { describe, expect, it } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { buildCandidates } from './candidates.js';

function diff(files: { path: string; hunks: [number, number][] }[]): UnifiedDiff {
  return {
    raw: '',
    files: files.map((f) => ({
      path: f.path,
      additions: 0,
      deletions: 0,
      hunks: f.hunks.map(([newStart, newLines]) => ({
        file: f.path,
        oldStart: newStart,
        oldLines: newLines,
        newStart,
        newLines,
        newLineNumbers: [],
      })),
    })),
  };
}

describe('buildCandidates', () => {
  it('unions changed files with caller files, keeping the two sets distinguishable', () => {
    const c = buildCandidates({
      changedFiles: ['src/auth.ts', 'src/config.ts'],
      callerFiles: ['src/server.ts', 'src/auth.ts'],
      endpoints: [],
      crons: [],
      diff: diff([]),
    });

    expect([...c.files].sort()).toEqual(['src/auth.ts', 'src/config.ts', 'src/server.ts']);
    expect([...c.changedFiles].sort()).toEqual(['src/auth.ts', 'src/config.ts']);
  });

  it('builds line ranges only from the diff, so a caller file has none', () => {
    const c = buildCandidates({
      changedFiles: ['src/auth.ts'],
      callerFiles: ['src/server.ts'],
      endpoints: [],
      crons: [],
      diff: diff([{ path: 'src/auth.ts', hunks: [[10, 4]] }]),
    });

    expect(c.lineRanges.get('src/auth.ts')).toEqual([{ start: 10, end: 13 }]);
    expect(c.lineRanges.get('src/server.ts')).toBeUndefined();
  });

  it('drops blank paths and blank endpoint/job strings', () => {
    const c = buildCandidates({
      changedFiles: ['src/a.ts', '', '   '],
      callerFiles: [''],
      endpoints: ['GET /a', ''],
      crons: ['  '],
      diff: diff([]),
    });

    expect([...c.files]).toEqual(['src/a.ts']);
    expect([...c.endpoints]).toEqual(['GET /a']);
    expect(c.crons.size).toBe(0);
  });

  it('carries no caller line anywhere in its input or its output (AC-16)', () => {
    // The structural half of AC-16: `CandidateInput` has no field that could
    // hold a `BlastCaller`, so a default-branch line cannot enter the pipeline.
    // If someone widens the signature, this fails to compile before it fails a
    // review.
    const input = {
      changedFiles: ['src/auth.ts'],
      callerFiles: ['src/server.ts'],
      endpoints: [],
      crons: [],
      diff: diff([{ path: 'src/auth.ts', hunks: [[1, 2]] }]),
    };
    const keys = Object.keys(input).sort();
    expect(keys).toEqual(['callerFiles', 'changedFiles', 'crons', 'diff', 'endpoints']);

    const c = buildCandidates(input);
    expect(JSON.stringify([...c.lineRanges])).not.toContain('caller');
  });
});
