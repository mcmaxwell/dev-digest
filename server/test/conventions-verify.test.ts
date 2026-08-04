import { describe, it, expect } from 'vitest';
import { verifyCandidates, verifyEvidence } from '../src/modules/conventions/verify.js';
import type { DraftCandidate } from '../src/modules/conventions/types.js';

const FILE_A = ['import { z } from "zod";', '', 'export const Body = z.object({', '  id: z.string(),', '});'].join('\n');
const FILE_B = ['export const Params = z.object({', '  id: z.string().uuid(),', '});'].join('\n');

const contents = new Map([
  ['src/a.ts', FILE_A],
  ['src/b.ts', FILE_B],
]);

const draft = (over: Partial<DraftCandidate> = {}): DraftCandidate => ({
  category: 'types',
  rule: 'Route bodies are declared with a `z.object` schema.',
  evidence: [],
  confidence: 0.9,
  origin: 'llm',
  ruleKey: 'route-bodies-zobject',
  ...over,
});

describe('conventions evidence verification', () => {
  it('marks a snippet sitting at the cited line as exact', () => {
    const hit = verifyEvidence(
      { path: 'src/a.ts', line: 3, snippet: 'export const Body = z.object({' },
      contents,
    );
    expect(hit).toEqual({
      path: 'src/a.ts',
      line: 3,
      snippet: 'export const Body = z.object({',
      verified: 'exact',
    });
  });

  it('RELOCATES a real snippet cited at the wrong line instead of rejecting it', () => {
    // An off-by-N line number still describes something true about the repo;
    // dropping it would cost recall for no precision gain.
    const hit = verifyEvidence(
      { path: 'src/a.ts', line: 1, snippet: 'export const Body = z.object({' },
      contents,
    );
    expect(hit).toMatchObject({ line: 3, verified: 'relocated' });
  });

  it('ignores indentation drift when matching', () => {
    const hit = verifyEvidence(
      { path: 'src/a.ts', line: 4, snippet: 'id:   z.string(),' },
      contents,
    );
    expect(hit).toMatchObject({ line: 4, verified: 'exact' });
  });

  it('rejects a snippet that is nowhere in the file', () => {
    expect(
      verifyEvidence({ path: 'src/a.ts', line: 2, snippet: 'const invented = true;' }, contents),
    ).toBeNull();
  });

  it('rejects evidence pointing at a file outside the sample', () => {
    expect(
      verifyEvidence({ path: 'src/ghost.ts', line: 1, snippet: 'anything' }, contents),
    ).toBeNull();
  });

  it('rejects a snippet too trivial for a match to mean anything', () => {
    expect(verifyEvidence({ path: 'src/a.ts', line: 5, snippet: '})' }, contents)).toBeNull();
  });

  describe('candidate survival', () => {
    it('keeps an LLM candidate with two verified sites in DIFFERENT files', () => {
      const kept = verifyCandidates(
        [
          draft({
            evidence: [
              { path: 'src/a.ts', line: 3, snippet: 'export const Body = z.object({', verified: 'exact' },
              { path: 'src/b.ts', line: 1, snippet: 'export const Params = z.object({', verified: 'exact' },
            ],
          }),
        ],
        contents,
      );
      expect(kept).toHaveLength(1);
      expect(kept[0]!.evidence).toHaveLength(2);
    });

    it('drops an LLM candidate with only one verified site — one occurrence is a coincidence', () => {
      const kept = verifyCandidates(
        [
          draft({
            evidence: [
              { path: 'src/a.ts', line: 3, snippet: 'export const Body = z.object({', verified: 'exact' },
              { path: 'src/a.ts', line: 9, snippet: 'const hallucinated = 1;', verified: 'exact' },
            ],
          }),
        ],
        contents,
      );
      expect(kept).toEqual([]);
    });

    it('drops an LLM candidate whose two sites live in the SAME file', () => {
      // Two hits in one file is one observation seen twice — exactly the shape a
      // hallucinated "pattern" takes.
      const kept = verifyCandidates(
        [
          draft({
            evidence: [
              { path: 'src/a.ts', line: 3, snippet: 'export const Body = z.object({', verified: 'exact' },
              { path: 'src/a.ts', line: 4, snippet: 'id: z.string(),', verified: 'exact' },
            ],
          }),
        ],
        contents,
      );
      expect(kept).toEqual([]);
    });

    it('accepts a config candidate on a single site — the config IS the declaration', () => {
      const kept = verifyCandidates(
        [
          draft({
            origin: 'config',
            evidence: [
              { path: 'src/a.ts', line: 1, snippet: 'import { z } from "zod";', verified: 'exact' },
            ],
          }),
        ],
        contents,
      );
      expect(kept).toHaveLength(1);
    });

    it('deduplicates evidence that lands on the same line twice', () => {
      const kept = verifyCandidates(
        [
          draft({
            origin: 'config',
            evidence: [
              { path: 'src/a.ts', line: 3, snippet: 'export const Body = z.object({', verified: 'exact' },
              { path: 'src/a.ts', line: 1, snippet: 'export const Body = z.object({', verified: 'exact' },
            ],
          }),
        ],
        contents,
      );
      expect(kept[0]!.evidence).toHaveLength(1);
    });
  });
});
