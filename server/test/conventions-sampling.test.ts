import { describe, it, expect } from 'vitest';
import {
  fitBudget,
  numberLines,
  renderSamples,
  toSampleFile,
  truncateFile,
} from '../src/modules/conventions/sampling.js';
import {
  MAX_CHARS_PER_FILE,
  MAX_LINES_PER_FILE,
} from '../src/modules/conventions/constants.js';
import type { SampleFile } from '../src/modules/conventions/types.js';

describe('conventions sampling', () => {
  it('truncates by line count and reports the original size', () => {
    const raw = Array.from({ length: MAX_LINES_PER_FILE + 40 }, (_, i) => `line ${i}`).join('\n');
    const cut = truncateFile(raw);

    expect(cut.truncated).toBe(true);
    expect(cut.totalLines).toBe(MAX_LINES_PER_FILE + 40);
    expect(cut.content.split('\n')).toHaveLength(MAX_LINES_PER_FILE);
  });

  it('truncates by char budget on whole lines only — never mid-line', () => {
    const long = 'x'.repeat(500);
    const raw = Array.from({ length: 100 }, () => long).join('\n');
    const cut = truncateFile(raw);

    expect(cut.content.length).toBeLessThanOrEqual(MAX_CHARS_PER_FILE);
    for (const line of cut.content.split('\n')) {
      expect(line).toBe(long); // every kept line survived intact
    }
  });

  it('leaves a short file alone', () => {
    const cut = truncateFile('a\nb\nc');
    expect(cut).toEqual({ content: 'a\nb\nc', totalLines: 3, truncated: false });
  });

  it('numbers lines 1-based so the model copies a line number instead of guessing one', () => {
    expect(numberLines('const a = 1;\nconst b = 2;')).toBe(
      '    1 | const a = 1;\n    2 | const b = 2;',
    );
  });

  describe('fitBudget', () => {
    const file = (path: string, kind: SampleFile['kind'], size: number): SampleFile =>
      toSampleFile(path, kind, 'y'.repeat(size));

    it('keeps every stratum represented rather than truncating the tail', () => {
      // Source files come first and are individually large; a naive
      // "take until full" pass would consume the whole budget before reaching
      // the tests/docs strata and silently delete a whole class of conventions.
      const files = [
        file('src/a.ts', 'source', 400),
        file('src/b.ts', 'source', 400),
        file('src/c.ts', 'source', 400),
        file('test/a.test.ts', 'test', 400),
        file('README.md', 'doc', 400),
      ];

      const kept = fitBudget(files, 1_600);
      const kinds = new Set(kept.map((f) => f.kind));

      expect(kinds).toEqual(new Set(['source', 'test', 'doc']));
    });

    it('preserves the caller ordering after the round-robin budget pass', () => {
      const files = [
        file('package.json', 'config', 50),
        file('README.md', 'doc', 50),
        file('src/a.ts', 'source', 50),
        file('test/a.test.ts', 'test', 50),
      ];
      const kept = fitBudget(files, 100_000);
      expect(kept.map((f) => f.path)).toEqual([
        'package.json',
        'README.md',
        'src/a.ts',
        'test/a.test.ts',
      ]);
    });

    it('drops files that do not fit instead of overflowing the budget', () => {
      const kept = fitBudget([file('src/huge.ts', 'source', 5_000)], 100);
      expect(kept).toEqual([]);
    });
  });

  it('renders each sample with its path, kind and truncation note', () => {
    const raw = Array.from({ length: MAX_LINES_PER_FILE + 5 }, (_, i) => `l${i}`).join('\n');
    const rendered = renderSamples([toSampleFile('src/api.ts', 'source', raw)]);

    expect(rendered).toContain('### src/api.ts (source, first');
    expect(rendered).toContain(`of ${MAX_LINES_PER_FILE + 5} lines`);
    expect(rendered).toContain('    1 | l0');
  });
});
