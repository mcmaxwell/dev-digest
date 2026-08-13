import { describe, it, expect } from 'vitest';
import { MAX_PATH_PROBES } from './constants.js';
import {
  collectDraftPaths,
  guardDiagram,
  linkProsePaths,
  sectionStatus,
  verifyDraft,
  type VerifyContext,
} from './verify.js';
import type { OnboardingDraft } from './schemas.js';
import type { MarkerRow } from './types.js';

/**
 * L06 — grounding what the model wrote, against the spec's own criteria.
 *
 *   AC-19  a section with no content carries its own status.
 *   AC-20  at most one diagram, on the architecture section.
 *   AC-21  a diagram that does not parse is dropped, the prose kept.
 *   AC-22  at most 8 critical paths, each with a path and a one-line reason.
 *   AC-23  every critical-path entry appears in `getCriticalPaths` output.
 *   AC-24  at most 12 run steps, each with an ordinal, a command and a source.
 *   AC-25  a step citing a source that does not exist at `head_sha` is dropped.
 *   AC-27  at most 10 reading entries, each with its position and reason.
 *   AC-28  at most 5 first tasks, each carrying a path+line or an issue number.
 *   AC-29  first tasks resolve to a marker we found or an issue we fetched.
 *   AC-32  every path the model emitted is verified against the clone.
 *   AC-33  a row naming a path that does not exist is dropped, and counted.
 *   AC-34  a prose path that does not exist renders as plain text, not a link.
 *   AC-35  a verified path links to GitHub, pinned to `head_sha`.
 *   AC-58  a section built without the import graph is marked as such.
 */

const HEAD = 'abc1234def5678';
const REPO = 'acme/payments-api';

/** Everything that exists in the clone at HEAD, for this file's fixtures. */
const REAL = [
  'src/server.ts',
  'src/middleware/auth.ts',
  'src/lib/redis.ts',
  'src/routes/public.ts',
  'package.json',
  'Makefile',
  'README.md',
];

const MARKERS: MarkerRow[] = [
  { path: 'src/middleware/auth.ts', line: 42, text: 'TODO: rotate the signing key' },
];

function ctx(over: Partial<VerifyContext> = {}): VerifyContext {
  const real = new Set(REAL);
  return {
    exists: (p) => real.has(p),
    repoFullName: REPO,
    headSha: HEAD,
    readingCandidates: new Set(['src/server.ts', 'src/middleware/auth.ts', 'src/lib/redis.ts']),
    criticalCandidates: new Set(['src/middleware/auth.ts', 'src/routes/public.ts']),
    rankPercentile: (p) => (p === 'src/middleware/auth.ts' ? 0.97 : null),
    markers: MARKERS,
    issueNumbers: new Set([311]),
    usedGraph: { reading: true, critical: true },
    ...over,
  };
}

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

function draft(over: DeepPartial<OnboardingDraft> = {}): OnboardingDraft {
  const base = { title: '', body: '', links: [] };
  return {
    architecture: { ...base, diagram: null, ...over.architecture },
    critical_paths: { ...base, items: [], ...over.critical_paths },
    run_locally: { ...base, items: [], ...over.run_locally },
    reading_path: { ...base, items: [], ...over.reading_path },
    first_tasks: { ...base, items: [], ...over.first_tasks },
  } as OnboardingDraft;
}

/** Narrow a verified section by kind without `any` at every call site. */
function section<K extends string>(sections: ReturnType<typeof verifyDraft>['sections'], kind: K) {
  const found = sections.find((s) => s.kind === kind);
  if (!found) throw new Error(`no ${kind} section`);
  return found as Extract<(typeof sections)[number], { kind: K }>;
}

describe('L06 verify — critical paths (AC-22, AC-23, AC-32, AC-33)', () => {
  it('drops a row naming a path that does not exist in the clone, and counts the drop', () => {
    const result = verifyDraft(
      draft({
        critical_paths: {
          title: 'Critical paths',
          body: '',
          links: [],
          items: [
            { path: 'src/middleware/auth.ts', reason: 'Every request passes through it.' },
            { path: 'src/services/invented.ts', reason: 'Sounds important.' },
          ],
        },
      }),
      ctx(),
    );

    const critical = section(result.sections, 'critical_paths');
    expect(critical.items.map((i) => i.path)).toEqual(['src/middleware/auth.ts']);
    expect(result.droppedRows).toBe(1);
  });

  it('drops a row whose path exists but is not among the dependency-chain candidates', () => {
    // AC-23 is a MEMBERSHIP property: an entry the chains never produced is not
    // a critical path, however real the file is.
    const result = verifyDraft(
      draft({
        critical_paths: {
          title: '',
          body: '',
          links: [],
          items: [{ path: 'README.md', reason: 'It is a file that exists.' }],
        },
      }),
      ctx(),
    );

    expect(section(result.sections, 'critical_paths').items).toEqual([]);
    expect(result.droppedRows).toBe(1);
  });

  it('carries the file path, a one-line reason and the rank percentile on every surviving row', () => {
    const result = verifyDraft(
      draft({
        critical_paths: {
          title: '',
          body: '',
          links: [],
          items: [{ path: 'src/middleware/auth.ts', reason: 'Every request passes through it.' }],
        },
      }),
      ctx(),
    );

    expect(section(result.sections, 'critical_paths').items[0]).toEqual({
      path: 'src/middleware/auth.ts',
      reason: 'Every request passes through it.',
      rank_percentile: 0.97,
    });
  });

  it('lists at most 8', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `src/c${i}.ts`);
    const result = verifyDraft(
      draft({
        critical_paths: {
          title: '',
          body: '',
          links: [],
          items: paths.map((p) => ({ path: p, reason: 'r' })),
        },
      }),
      ctx({ exists: () => true, criticalCandidates: new Set(paths) }),
    );

    expect(section(result.sections, 'critical_paths').items).toHaveLength(8);
  });
});

describe('L06 verify — run steps (AC-24, AC-25)', () => {
  it('drops a step whose cited source file does not exist, and counts it', () => {
    const result = verifyDraft(
      draft({
        run_locally: {
          title: '',
          body: '',
          links: [],
          items: [
            { command: 'pnpm install', source: 'package.json' },
            { command: 'bin/setup --all', source: 'bin/setup' },
            { command: 'make up', source: 'Makefile' },
          ],
        },
      }),
      ctx(),
    );

    const run = section(result.sections, 'run_locally');
    expect(run.items.map((i) => i.command)).toEqual(['pnpm install', 'make up']);
    expect(result.droppedSteps).toBe(1);
  });

  it('numbers the surviving steps 1..n, leaving no gap where a step was dropped', () => {
    const result = verifyDraft(
      draft({
        run_locally: {
          title: '',
          body: '',
          links: [],
          items: [
            { command: 'a', source: 'nope/one.sh' },
            { command: 'b', source: 'package.json' },
            { command: 'c', source: 'Makefile' },
          ],
        },
      }),
      ctx(),
    );

    expect(section(result.sections, 'run_locally').items).toEqual([
      { step: 1, command: 'b', source: 'package.json' },
      { step: 2, command: 'c', source: 'Makefile' },
    ]);
  });

  it('keeps a multi-line command whole, so it can be copied as one value', () => {
    const command = 'docker compose up -d \\\n  --build postgres';
    const result = verifyDraft(
      draft({ run_locally: { title: '', body: '', links: [], items: [{ command, source: 'Makefile' }] } }),
      ctx(),
    );

    expect(section(result.sections, 'run_locally').items[0]!.command).toBe(command);
  });

  it('lists at most 12', () => {
    const items = Array.from({ length: 18 }, (_, i) => ({ command: `cmd ${i}`, source: 'Makefile' }));
    const result = verifyDraft(draft({ run_locally: { title: '', body: '', links: [], items } }), ctx());

    expect(section(result.sections, 'run_locally').items).toHaveLength(12);
  });
});

describe('L06 verify — what gets probed against the clone (AC-24, AC-25, AC-32)', () => {
  /**
   * The service probes the FIRST `MAX_PATH_PROBES` of this list and treats
   * everything it did not probe as non-existent. AC-24 and AC-25 require a run
   * step to survive on its cited source existing — so a verbose body, which the
   * draft schema does not cap, must never be able to starve that citation.
   */
  it('probes a run step’s cited source even when prose named more paths than the budget', () => {
    const chatty = Array.from({ length: MAX_PATH_PROBES + 50 }, (_, i) => `src/prose${i}.ts`)
      .map((p) => `\`${p}\``)
      .join(' and ');

    const collected = collectDraftPaths(
      draft({
        architecture: { title: '', body: chatty, links: [], diagram: null },
        run_locally: {
          title: '',
          body: '',
          links: [],
          // A path-shaped source: `looksLikePath` needs a slash or a suffix, so
          // an extension-less `Makefile` is never a probe candidate at all — it
          // survives on being a fact file the collector already read.
          items: [{ command: 'npm run dev', source: 'package.json' }],
        },
        first_tasks: {
          title: '',
          body: '',
          links: [],
          items: [
            {
              title: 'Rotate the signing key',
              origin: 'todo',
              path: 'src/middleware/auth.ts',
              line: 42,
              issue_number: null,
            },
          ],
        },
      }),
    );

    const probed = collected.slice(0, MAX_PATH_PROBES);
    expect(probed).toContain('package.json');
    expect(probed).toContain('src/middleware/auth.ts');
    // …and the prose was not dropped, only queued behind them.
    expect(collected).toContain('src/prose0.ts');
    expect(collected.length).toBeGreaterThan(MAX_PATH_PROBES);
  });

  it('puts every section’s links and rows ahead of every section’s prose', () => {
    const collected = collectDraftPaths(
      draft({
        architecture: {
          title: '',
          body: 'The queue lives in `src/prose-only.ts`.',
          links: [{ label: 'Entry point', path: 'src/server.ts' }],
          diagram: null,
        },
        // Last section in schema order: its cited path still outranks the
        // prose of the first.
        first_tasks: {
          title: '',
          body: '',
          links: [],
          items: [
            {
              title: 'Rotate the signing key',
              origin: 'todo',
              path: 'src/middleware/auth.ts',
              line: 42,
              issue_number: null,
            },
          ],
        },
      }),
    );

    expect(collected.indexOf('src/middleware/auth.ts')).toBeLessThan(
      collected.indexOf('src/prose-only.ts'),
    );
    expect(collected.indexOf('src/server.ts')).toBeLessThan(collected.indexOf('src/prose-only.ts'));
  });

  it('lists a path named in both a row and the prose exactly once', () => {
    const collected = collectDraftPaths(
      draft({
        run_locally: {
          title: '',
          body: 'Read `package.json` first.',
          links: [],
          items: [{ command: 'npm run dev', source: 'package.json' }],
        },
      }),
    );

    expect(collected.filter((p) => p === 'package.json')).toHaveLength(1);
  });
});

describe('L06 verify — reading path (AC-8, AC-27)', () => {
  it('keeps only entries drawn from the ranked candidate set, in position order', () => {
    const result = verifyDraft(
      draft({
        reading_path: {
          title: '',
          body: '',
          links: [],
          items: [
            { path: 'src/server.ts', reason: 'Where a request enters.' },
            { path: 'src/invented.ts', reason: 'Invented.' },
            { path: 'src/lib/redis.ts', reason: 'The shared cache.' },
          ],
        },
      }),
      ctx(),
    );

    expect(section(result.sections, 'reading_path').items).toEqual([
      { order: 1, path: 'src/server.ts', reason: 'Where a request enters.' },
      { order: 2, path: 'src/lib/redis.ts', reason: 'The shared cache.' },
    ]);
    expect(result.droppedRows).toBe(1);
  });

  it('lists at most 10', () => {
    const paths = Array.from({ length: 16 }, (_, i) => `src/r${i}.ts`);
    const result = verifyDraft(
      draft({
        reading_path: {
          title: '',
          body: '',
          links: [],
          items: paths.map((p) => ({ path: p, reason: 'r' })),
        },
      }),
      ctx({ exists: () => true, readingCandidates: new Set(paths) }),
    );

    expect(section(result.sections, 'reading_path').items).toHaveLength(10);
  });
});

describe('L06 verify — first tasks (AC-28, AC-29)', () => {
  it('keeps only tasks that resolve to a marker we found or an issue we fetched', () => {
    const result = verifyDraft(
      draft({
        first_tasks: {
          title: '',
          body: '',
          links: [],
          items: [
            {
              title: 'Rotate the signing key',
              origin: 'todo',
              path: 'src/middleware/auth.ts',
              line: 42,
              issue_number: null,
            },
            {
              // A plausible chore with no marker behind it.
              title: 'Add more tests',
              origin: 'todo',
              path: 'src/lib/redis.ts',
              line: 900,
              issue_number: null,
            },
            { title: 'Document the headers', origin: 'issue', path: null, line: null, issue_number: 311 },
            { title: 'Invented issue', origin: 'issue', path: null, line: null, issue_number: 999 },
          ],
        },
      }),
      ctx(),
    );

    const tasks = section(result.sections, 'first_tasks');
    expect(tasks.items).toEqual([
      {
        title: 'Rotate the signing key',
        origin: 'todo',
        path: 'src/middleware/auth.ts',
        line: 42,
        issue_number: null,
      },
      { title: 'Document the headers', origin: 'issue', path: null, line: null, issue_number: 311 },
    ]);
    expect(result.droppedRows).toBe(2);
  });

  it('requires a marker task to carry both a path and a line', () => {
    const result = verifyDraft(
      draft({
        first_tasks: {
          title: '',
          body: '',
          links: [],
          items: [
            { title: 'No line', origin: 'todo', path: 'src/middleware/auth.ts', line: null, issue_number: null },
          ],
        },
      }),
      ctx(),
    );

    expect(section(result.sections, 'first_tasks').items).toEqual([]);
    expect(result.droppedRows).toBe(1);
  });

  it('lists at most 5', () => {
    const markers: MarkerRow[] = Array.from({ length: 9 }, (_, i) => ({
      path: 'src/server.ts',
      line: i + 1,
      text: 'TODO',
    }));
    const result = verifyDraft(
      draft({
        first_tasks: {
          title: '',
          body: '',
          links: [],
          items: markers.map((m, i) => ({
            title: `task ${i}`,
            origin: 'todo' as const,
            path: m.path,
            line: m.line,
            issue_number: null,
          })),
        },
      }),
      ctx({ markers }),
    );

    expect(section(result.sections, 'first_tasks').items).toHaveLength(5);
  });
});

describe('L06 verify — prose paths (AC-34, AC-35)', () => {
  it('links a path that exists to the GitHub blob, pinned to the generation commit', () => {
    const linked = linkProsePaths('Requests enter through `src/server.ts` first.', ctx());

    expect(linked).toContain(`https://github.com/${REPO}/blob/${HEAD}/src/server.ts`);
    expect(linked).toContain('[`src/server.ts`]');
  });

  it('leaves a path that does not exist as plain text, never a link', () => {
    const linked = linkProsePaths('See `src/services/invented.ts` for the queue.', ctx());

    expect(linked).toBe('See `src/services/invented.ts` for the queue.');
    expect(linked).not.toContain('http');
  });

  it('links prose paths inside the body of every section it verifies', () => {
    const body = 'Auth lives in `src/middleware/auth.ts`; the queue in `src/invented.ts`.';
    const result = verifyDraft(draft({ architecture: { title: '', body, links: [], diagram: null } }), ctx());

    const arch = section(result.sections, 'architecture');
    expect(arch.body).toContain(`/blob/${HEAD}/src/middleware/auth.ts`);
    expect(arch.body).toContain('`src/invented.ts`');
    expect(arch.body).not.toContain('/blob/' + HEAD + '/src/invented.ts');
  });

  it('drops a section link whose path does not exist', () => {
    const result = verifyDraft(
      draft({
        architecture: {
          title: '',
          body: '',
          diagram: null,
          links: [
            { label: 'Entry point', path: 'src/server.ts' },
            { label: 'Ghost', path: 'src/ghost.ts' },
          ],
        },
      }),
      ctx(),
    );

    expect(section(result.sections, 'architecture').links).toEqual([
      { label: 'Entry point', path: 'src/server.ts' },
    ]);
  });
});

describe('L06 verify — the diagram (AC-20, AC-21)', () => {
  const VALID = 'flowchart TD\n  A["client"] --> B["api"]\n  B --> C["postgres"]';

  it('keeps a diagram that parses', () => {
    expect(guardDiagram(VALID)).toBe(VALID);
  });

  for (const [name, src] of [
    ['prose rather than a diagram', 'Here is how the system works.'],
    ['a fenced block', '```mermaid\nflowchart TD\n A --> B\n```'],
    ['a label left open across a newline', 'flowchart TD\n  A["client\n  A --> B'],
    ['nothing at all', ''],
  ] as const) {
    it(`drops ${name}`, () => {
      expect(guardDiagram(src)).toBeNull();
    });
  }

  it('keeps the section prose when the diagram is dropped', () => {
    const result = verifyDraft(
      draft({
        architecture: {
          title: 'Architecture overview',
          body: 'A gateway in front of two services.',
          links: [],
          diagram: 'not a diagram at all',
        },
      }),
      ctx(),
    );

    const arch = section(result.sections, 'architecture');
    expect(arch.diagram).toBeNull();
    expect(arch.body).toBe('A gateway in front of two services.');
    expect(arch.status).toBe('ok');
  });

  it('puts a diagram on the architecture section and on no other', () => {
    const result = verifyDraft(draft({ architecture: { title: '', body: 'x', links: [], diagram: VALID } }), ctx());

    expect(section(result.sections, 'architecture').diagram).toBe(VALID);
    for (const other of result.sections.filter((s) => s.kind !== 'architecture')) {
      expect(other).not.toHaveProperty('diagram');
    }
  });
});

describe('L06 verify — section status (AC-19, AC-58)', () => {
  it('marks the two graph-dependent sections when there was no import graph', () => {
    const result = verifyDraft(draft(), ctx({ usedGraph: { reading: false, critical: false } }));
    const byKind = Object.fromEntries(result.sections.map((s) => [s.kind, s.status]));

    expect(byKind.critical_paths).toBe('no_graph');
    expect(byKind.reading_path).toBe('no_graph');
    expect(byKind.run_locally).toBe('empty');
    expect(byKind.first_tasks).toBe('empty');
  });

  it('reports a section with nothing in it as empty rather than dropping it', () => {
    const result = verifyDraft(draft(), ctx());

    expect(result.sections.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
    expect(result.sections.every((s) => s.status === 'empty')).toBe(true);
  });

  it('is `ok` only when the section actually carries something', () => {
    const graph = { reading: true, critical: true };
    expect(sectionStatus('run_locally', true, graph)).toBe('ok');
    expect(sectionStatus('run_locally', false, graph)).toBe('empty');
    expect(sectionStatus('reading_path', true, { reading: false, critical: false })).toBe('no_graph');
  });

  /**
   * AC-57 names the import graph as the thing the fallback replaces, and AC-58
   * asks for the marker on the sections BUILT WITHOUT IT. The two sections lose
   * it separately — the reading path needs a ranking, critical paths need
   * dependency chains — so the marker is per section, not per generation.
   */
  it('marks critical paths without the graph while the reading path keeps its ranking', () => {
    const result = verifyDraft(
      draft({
        reading_path: {
          title: '',
          body: '',
          links: [],
          items: [{ path: 'src/server.ts', reason: 'Where a request enters.' }],
        },
      }),
      ctx({ usedGraph: { reading: true, critical: false } }),
    );
    const byKind = Object.fromEntries(result.sections.map((s) => [s.kind, s.status]));

    expect(byKind.critical_paths).toBe('no_graph');
    expect(byKind.reading_path).toBe('ok');
  });
});

describe('L06 verify — the five sections survive whatever the model returned', () => {
  it('produces exactly five sections in the fixed order from an empty draft', () => {
    // The spec's "model returns four sections, or six" edge case: there is
    // nothing to count, only known keys to repair against.
    const result = verifyDraft(draft(), ctx());
    expect(result.sections).toHaveLength(5);
  });

  it('falls back to the section-kind title when the model left the title blank', () => {
    const result = verifyDraft(draft(), ctx());
    expect(result.sections.map((s) => s.title)).toEqual([
      'Architecture overview',
      'Critical paths',
      'How to run locally',
      'Guided reading path',
      'First tasks',
    ]);
  });
});
