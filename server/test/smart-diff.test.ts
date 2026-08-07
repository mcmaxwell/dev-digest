/**
 * Smart Diff classifier (L03) — the whole rule set as a table. Hermetic: the
 * classifier is pure, so none of this needs Postgres, a container or a model.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  buildSmartDiff,
  isPlumbingOnlyPatch,
  roleFor,
  type ChangedFile,
} from '../src/modules/smart-diff/classify.js';
import { findingLinesByPath, latestReviewFindings } from '../src/modules/smart-diff/helpers.js';
import type { FindingRow } from '../src/db/rows.js';

function file(path: string, additions = 10, deletions = 0, patch: string | null = null): ChangedFile {
  return { path, additions, deletions, patch };
}

function finding(over: Partial<FindingRow> & Pick<FindingRow, 'file' | 'startLine'>): FindingRow {
  return {
    id: `f-${over.file}-${over.startLine}`,
    reviewId: 'r1',
    endLine: over.startLine,
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    rationale: 'why',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...over,
  } as FindingRow;
}

describe('roleFor', () => {
  const cases: [string, ReturnType<typeof roleFor>][] = [
    // boilerplate — lock files, build output, snapshots, generated code, assets
    ['pnpm-lock.yaml', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['go.sum', 'boilerplate'],
    ['packages/api/dist/index.js', 'boilerplate'],
    ['client/.next/static/chunk.js', 'boilerplate'],
    ['src/__snapshots__/Button.test.tsx.snap', 'boilerplate'],
    ['server/src/db/migrations/0015_warm.sql', 'boilerplate'],
    ['src/api/client.generated.ts', 'boilerplate'],
    ['public/logo.svg', 'boilerplate'],
    ['vendor/lib.min.js', 'boilerplate'],

    // wiring — barrels, bootstrap, config, CI
    ['src/api/public/index.ts', 'wiring'],
    ['src/server.ts', 'wiring'],
    ['src/config.ts', 'wiring'],
    ['src/main.rs', 'wiring'],
    ['pkg/__init__.py', 'wiring'],
    ['vitest.config.ts', 'wiring'],
    ['tsconfig.build.json', 'wiring'],
    ['package.json', 'wiring'],
    ['Dockerfile', 'wiring'],
    ['docker-compose.yml', 'wiring'],
    ['.github/workflows/e2e-web.yml', 'wiring'],
    ['.eslintrc.json', 'wiring'],

    // core — everything else, including anything unrecognised
    ['src/middleware/ratelimit.ts', 'core'],
    ['src/api/public/webhooks.ts', 'core'],
    ['src/api/users.ts', 'core'],
    ['lib/billing/invoice_calculator.rb', 'core'],
    ['some/unknown/thing.xyz', 'core'],

    // `out`/`build` are build output only at the ROOT — nested, they are source.
    ['out/bundle.js', 'boilerplate'],
    ['build/release.js', 'boilerplate'],
    ['src/out/handlers.ts', 'core'],
    ['src/build/pipeline.ts', 'core'],

    // company / assistant context — collapsed, at any depth
    ['.company/onboarding.md', 'boilerplate'],
    ['.company/memory/decisions.md', 'boilerplate'],
    ['packages/api/.company/notes.md', 'boilerplate'],
    ['.claude/settings.json', 'boilerplate'],
    ['.cursor/rules/style.mdc', 'boilerplate'],
    ['MEMORY.md', 'boilerplate'],
    ['docs/memory.md', 'boilerplate'],
    ['docs/team.memory.md', 'boilerplate'],
    ['.github/copilot-instructions.md', 'boilerplate'],
  ];

  it.each(cases)('%s → %s', (path, role) => {
    expect(roleFor(path)).toBe(role);
  });

  it('prefers boilerplate over wiring for a generated barrel', () => {
    // `index.ts` is a wiring stem, but under dist/ it is build output.
    expect(roleFor('dist/index.ts')).toBe('boilerplate');
  });

  it('defaults to core so an unknown path is reviewed, never skimmed', () => {
    expect(roleFor('')).toBe('core');
  });

  describe('company / assistant context', () => {
    it('does not swallow real code that merely mentions the words', () => {
      // The context rules are name-scoped on purpose: a source file is never
      // demoted to "skim" just because of what it is called.
      expect(roleFor('src/company/billing.ts')).toBe('core');
      expect(roleFor('src/memory/cache.ts')).toBe('core');
      expect(roleFor('src/memory-store.ts')).toBe('core');
      expect(roleFor('src/copilot-session.ts')).toBe('core');
    });

    it('keeps the rest of .github as wiring', () => {
      // .github is a wiring dir; only Copilot's instruction files are context.
      expect(roleFor('.github/workflows/e2e-web.yml')).toBe('wiring');
      expect(roleFor('.github/copilot-instructions.md')).toBe('boilerplate');
    });

    it('collapses context even when the filename looks like wiring', () => {
      // Context is checked BEFORE wiring, so a config file inside .claude/
      // reads as context rather than as toolchain config.
      expect(roleFor('.claude/settings.json')).toBe('boilerplate');
      expect(roleFor('.company/index.ts')).toBe('boilerplate');
    });
  });
});

describe('isPlumbingOnlyPatch', () => {
  it('treats an import/export-only diff as wiring wherever it lives', () => {
    const patch = [
      '@@ -1,2 +1,4 @@',
      "+import { rateLimit } from './middleware/ratelimit';",
      "+export { rateLimit };",
      " const unchanged = 1;",
    ].join('\n');
    expect(isPlumbingOnlyPatch(patch)).toBe(true);
    expect(roleFor('src/middleware/registry.ts', patch)).toBe('wiring');
  });

  it('does not sweep in a brace-only refactor with no module keyword', () => {
    expect(isPlumbingOnlyPatch('@@ -1 +1 @@\n-}\n+}\n')).toBe(false);
  });

  it('stays core as soon as one real statement changed', () => {
    const patch = ["+import x from 'y';", '+const total = price * qty;'].join('\n');
    expect(isPlumbingOnlyPatch(patch)).toBe(false);
    expect(roleFor('src/billing.ts', patch)).toBe('core');
  });

  it('ignores the +++/--- file headers and an empty patch', () => {
    expect(isPlumbingOnlyPatch('--- a/x.ts\n+++ b/x.ts\n')).toBe(false);
    expect(isPlumbingOnlyPatch(null)).toBe(false);
  });

  // Every alternative must be end-anchored or end in a literal. Each of these
  // was a real misclassification: real logic demoted from core to wiring, which
  // is the one direction "core is the default" cannot protect against.
  it.each([
    ['a line merely STARTING with a brace', '+}); await chargeCard(user);'],
    ['an exported constant', '+export const TAX_RATE = 0.35;'],
    ['an exported function', '+export function chargeCard(user) {'],
    ['a default-exported expression', '+export default compute(a, b);'],
  ])('stays core for %s', (_name, line) => {
    const patch = `+import { x } from './x';\n${line}`;
    expect(isPlumbingOnlyPatch(patch)).toBe(false);
    expect(roleFor('src/billing/charge.ts', patch)).toBe('core');
  });

  it('still recognises the re-export forms that ARE plumbing', () => {
    for (const line of ['+export { rateLimit };', "+export * from './rl';", '+export default Foo;']) {
      expect(isPlumbingOnlyPatch(`+import { rateLimit } from './rl';\n${line}`)).toBe(true);
    }
  });

  it('handles a multi-line import block', () => {
    const patch = ['+import {', '+  alpha,', '+  beta,', "+} from './mod';"].join('\n');
    expect(isPlumbingOnlyPatch(patch)).toBe(true);
  });

  // Patch text comes from GitHub, so it is attacker-controlled. The regex used
  // to backtrack cubically here: 2000 spaces blocked the event loop for 4.4s,
  // and Fastify is single-threaded, so that is the whole API.
  it('does not backtrack catastrophically on an adversarial patch line', () => {
    const evil = `+const${' '.repeat(4000)}x`;
    const started = performance.now();
    expect(isPlumbingOnlyPatch(evil)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('buildSmartDiff', () => {
  const seededFiles = [
    file('src/middleware/ratelimit.ts', 84, 0),
    file('src/api/public/webhooks.ts', 31, 6),
    file('src/config.ts', 4, 0),
    file('src/api/users.ts', 7, 2),
  ];

  it('emits groups in core → wiring → boilerplate order and omits empty ones', () => {
    const d = buildSmartDiff(seededFiles, new Map());
    expect(d.groups.map((g) => g.role)).toEqual(['core', 'wiring']);
    expect(d.groups[1]!.files.map((f) => f.path)).toEqual(['src/config.ts']);
  });

  it('sorts findings first, then size, then path', () => {
    const d = buildSmartDiff(
      [file('a/big.ts', 100, 0), file('a/small.ts', 1, 0), file('a/flagged.ts', 2, 0)],
      new Map([['a/flagged.ts', [7]]]),
    );
    expect(d.groups[0]!.files.map((f) => f.path)).toEqual([
      'a/flagged.ts',
      'a/big.ts',
      'a/small.ts',
    ]);
  });

  it('breaks a findings+size tie on path, so group order is stable across runs', () => {
    const d = buildSmartDiff([file('a/z.ts', 5, 0), file('a/a.ts', 5, 0)], new Map());
    expect(d.groups[0]!.files.map((f) => f.path)).toEqual(['a/a.ts', 'a/z.ts']);
  });

  it('dedupes and sorts finding_lines and leaves pseudocode_summary null', () => {
    const d = buildSmartDiff([file('src/api/users.ts')], new Map([['src/api/users.ts', [52, 45, 52]]]));
    const f = d.groups[0]!.files[0]!;
    expect(f.finding_lines).toEqual([45, 52]);
    expect(f.pseudocode_summary).toBeNull();
  });

  it('reports a file with no findings as an empty finding_lines array', () => {
    const d = buildSmartDiff([file('src/api/users.ts')], new Map());
    expect(d.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('returns a contract-valid payload with no files at all', () => {
    const d = buildSmartDiff([], new Map());
    expect(() => SmartDiff.parse(d)).not.toThrow();
    expect(d.groups).toEqual([]);
    expect(d.split_suggestion).toEqual({ too_big: false, total_lines: 0, proposed_splits: [] });
  });

  describe('split_suggestion', () => {
    it('counts every file including boilerplate in total_lines', () => {
      const d = buildSmartDiff(seededFiles, new Map());
      expect(d.split_suggestion.total_lines).toBe(134); // the seeded PR #482
      expect(d.split_suggestion.too_big).toBe(false);
      expect(d.split_suggestion.proposed_splits).toEqual([]);
    });

    it('is not too_big exactly at the line threshold, but is one line over', () => {
      const at = buildSmartDiff([file('src/a.ts', 200, 200)], new Map());
      expect(at.split_suggestion.total_lines).toBe(400);
      expect(at.split_suggestion.too_big).toBe(false);

      const over = buildSmartDiff([file('src/a.ts', 200, 201)], new Map());
      expect(over.split_suggestion.too_big).toBe(true);
    });

    it('is not too_big at exactly the file threshold, but is one file over', () => {
      const files = (n: number) =>
        Array.from({ length: n }, (_, i) => file(`src/mod${i}/thing.ts`, 1, 0));
      expect(buildSmartDiff(files(20), new Map()).split_suggestion.too_big).toBe(false);
      expect(buildSmartDiff(files(21), new Map()).split_suggestion.too_big).toBe(true);
    });

    it('buckets non-boilerplate files by directory, largest bucket first', () => {
      const files = [
        file('src/api/a.ts', 200, 0),
        file('src/api/b.ts', 200, 0),
        file('src/billing/c.ts', 100, 0),
        file('README.md', 60, 0), // root-level: its own bucket
        file('pnpm-lock.yaml', 900, 0), // boilerplate: no bucket at all
      ];
      const { proposed_splits } = buildSmartDiff(files, new Map()).split_suggestion;
      expect(proposed_splits).toEqual([
        { name: 'src/api', files: ['src/api/a.ts', 'src/api/b.ts'] },
        { name: 'README.md', files: ['README.md'] },
        { name: 'src/billing', files: ['src/billing/c.ts'] },
      ]);
    });

    it('suppresses the suggestion when everything lives in one bucket', () => {
      const files = [file('src/api/a.ts', 300, 0), file('src/api/b.ts', 300, 0)];
      const s = buildSmartDiff(files, new Map()).split_suggestion;
      expect(s.too_big).toBe(true);
      expect(s.proposed_splits).toEqual([]);
    });
  });
});

describe('latestReviewFindings', () => {
  let seq = 0;
  const review = (agentId: string | null, kind = 'review') => ({
    id: `rev-${seq++}`,
    agentId,
    kind,
  });

  it('supersedes an agent’s older review with its newest one', () => {
    const rows = [
      { review: review('sec'), findings: [finding({ file: 'new.ts', startLine: 1 })] },
      { review: review('sec'), findings: [finding({ file: 'old.ts', startLine: 2 })] },
    ];
    expect(latestReviewFindings(rows).map((f) => f.file)).toEqual(['new.ts']);
  });

  // The regression that made a reviewed PR show no marks at all: running N
  // agents creates N separate runs, so keying on the newest RUN threw away
  // every other agent's findings whenever the last one to finish found nothing.
  it('keeps every agent, so a later clean run cannot hide another agent', () => {
    const rows = [
      { review: review('general'), findings: [] },
      { review: review('security'), findings: [finding({ file: 'auth.ts', startLine: 7 })] },
      { review: review('perf'), findings: [finding({ file: 'query.ts', startLine: 9 })] },
    ];
    expect(latestReviewFindings(rows).map((f) => f.file)).toEqual(['auth.ts', 'query.ts']);
  });

  it('treats a review whose agent was deleted as its own agent', () => {
    const rows = [
      { review: review(null), findings: [finding({ file: 'a.ts', startLine: 1 })] },
      { review: review(null), findings: [finding({ file: 'b.ts', startLine: 2 })] },
    ];
    // Two deleted-agent reviews are NOT the same agent, so neither is dropped.
    expect(latestReviewFindings(rows).map((f) => f.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('ignores summary rows', () => {
    const rows = [
      { review: review('sec', 'summary'), findings: [finding({ file: 'nope.ts', startLine: 1 })] },
      { review: review('sec'), findings: [finding({ file: 'a.ts', startLine: 1 })] },
    ];
    expect(latestReviewFindings(rows).map((f) => f.file)).toEqual(['a.ts']);
  });

  it('is empty when the PR has never been reviewed', () => {
    expect(latestReviewFindings([])).toEqual([]);
  });
});

describe('findingLinesByPath', () => {
  it('groups by file and keys on start_line', () => {
    const map = findingLinesByPath([
      finding({ file: 'src/config.ts', startLine: 12 }),
      finding({ file: 'src/api/users.ts', startLine: 45 }),
      finding({ file: 'src/api/users.ts', startLine: 52 }),
    ]);
    expect(map.get('src/config.ts')).toEqual([12]);
    expect(map.get('src/api/users.ts')).toEqual([45, 52]);
  });

  it('drops dismissed findings but keeps accepted ones', () => {
    const map = findingLinesByPath([
      finding({ file: 'a.ts', startLine: 1, dismissedAt: new Date('2026-08-07') }),
      finding({ file: 'a.ts', startLine: 2, acceptedAt: new Date('2026-08-07') }),
    ]);
    expect(map.get('a.ts')).toEqual([2]);
  });
});
