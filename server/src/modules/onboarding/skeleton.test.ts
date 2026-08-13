import { describe, it, expect } from 'vitest';
import type { OnboardingSection } from '@devdigest/shared';
import { deterministicSections, mergeSections } from './skeleton.js';
import type { CandidateSets, DeterministicFacts } from './types.js';

/**
 * L06 — the deterministic tour, against the spec's own criteria.
 *
 *   AC-17  exactly five sections, in the order Architecture overview, Critical
 *          paths, How to run locally, Guided reading path, First tasks.
 *   AC-18  every one of the five renders on every tour, including empty ones.
 *   AC-19  a section with no content carries its own empty line naming what was
 *          looked for, rather than being omitted.
 *   AC-30  with neither a marker nor a labelled issue, First tasks is empty and
 *          names BOTH sources it looked in.
 *   AC-57  with no import graph, Critical paths and Guided reading path are
 *          built from the heuristic — and are populated.
 *   AC-58  a section built without the import graph is marked as such.
 *   AC-60  a failed model call still yields the five headings with the
 *          deterministic facts collected.
 */

const NO_FACTS: DeterministicFacts = {
  present: [],
  envKeys: [],
  scripts: [],
  services: [],
  stack: [],
  readme: null,
  contributing: null,
};

const NO_CANDIDATES: CandidateSets = {
  reading: [],
  critical: [],
  markers: [],
  issues: [],
  usedGraph: true,
};

const FIVE_IN_ORDER = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
];

function build(
  facts: Partial<DeterministicFacts> = {},
  candidates: Partial<CandidateSets> = {},
  rank: (p: string) => number | null = () => null,
) {
  return deterministicSections({
    facts: { ...NO_FACTS, ...facts },
    candidates: { ...NO_CANDIDATES, ...candidates },
    rankPercentile: rank,
  });
}

function bodyOf(sections: OnboardingSection[], kind: string): string {
  return sections.find((s) => s.kind === kind)!.body;
}

describe('L06 skeleton — the five sections always exist (AC-17, AC-18)', () => {
  it('renders all five, in the fixed order, for a repository with nothing in it', () => {
    const sections = build();
    expect(sections.map((s) => s.kind)).toEqual(FIVE_IN_ORDER);
  });

  it('renders all five for a repository of three files with one run script', () => {
    const sections = build(
      { scripts: [{ name: 'dev', command: 'npm run dev', source: 'package.json' }] },
      { reading: ['src/index.ts'] },
    );
    expect(sections.map((s) => s.kind)).toEqual(FIVE_IN_ORDER);
    // Short lists are short, not padded.
    expect(sections.find((s) => s.kind === 'reading_path')!).toMatchObject({
      items: [expect.objectContaining({ order: 1, path: 'src/index.ts' })],
    });
  });

  it('gives every section a title, so no card is headed by an empty string', () => {
    expect(build().map((s) => s.title)).toEqual([
      'Architecture overview',
      'Critical paths',
      'How to run locally',
      'Guided reading path',
      'First tasks',
    ]);
  });
});

describe('L06 skeleton — the empty line names what was looked for (AC-19, AC-30)', () => {
  const sections = build();

  it('names the manifest, compose file and README on an empty architecture section', () => {
    const body = bodyOf(sections, 'architecture');
    for (const needle of ['manifest', 'compose', 'README']) expect(body).toContain(needle);
  });

  it('names the four task sources on an empty How to run locally section', () => {
    const body = bodyOf(sections, 'run_locally');
    for (const needle of ['package.json', 'Makefile', 'Justfile', 'Taskfile.yml']) {
      expect(body).toContain(needle);
    }
  });

  it('names BOTH first-task sources when neither a marker nor a labelled issue was found', () => {
    const body = bodyOf(sections, 'first_tasks');
    expect(body).toContain('TODO');
    expect(body).toContain('FIXME');
    expect(body).toContain('good first issue');
  });

  it('says the index is what is missing on the two graph-dependent sections', () => {
    expect(bodyOf(sections, 'critical_paths')).toMatch(/index/i);
    expect(bodyOf(sections, 'reading_path')).toMatch(/index/i);
  });

  it('reports each empty section as empty rather than omitting it', () => {
    expect(sections.every((s) => s.status === 'empty')).toBe(true);
  });
});

describe('L06 skeleton — the tour a failed model call leaves behind (AC-60)', () => {
  const sections = build(
    {
      present: ['package.json', 'docker-compose.yml'],
      stack: ['Node.js', 'fastify'],
      services: ['postgres', 'redis'],
      envKeys: ['DATABASE_URL', 'REDIS_URL'],
      scripts: [
        { name: 'dev', command: 'npm run dev', source: 'package.json' },
        { name: 'up', command: 'make up', source: 'Makefile' },
      ],
    },
    {
      reading: ['src/server.ts', 'src/middleware/auth.ts'],
      critical: ['src/middleware/auth.ts'],
      markers: [{ path: 'src/lib/redis.ts', line: 7, text: 'TODO: reconnect backoff' }],
      issues: [{ number: 311, title: 'Document the rate-limit headers' }],
    },
    (p) => (p === 'src/middleware/auth.ts' ? 0.97 : null),
  );

  it('describes the repository from the facts alone', () => {
    const body = bodyOf(sections, 'architecture');
    expect(body).toContain('Node.js');
    expect(body).toContain('postgres');
    expect(sections.find((s) => s.kind === 'architecture')!.status).toBe('ok');
  });

  it('states the number of environment variables without naming one value', () => {
    expect(bodyOf(sections, 'architecture')).toContain('2 environment variable');
  });

  it('lists every run step with its ordinal, its command and the file it came from', () => {
    const run = sections.find((s) => s.kind === 'run_locally')!;
    expect(run).toMatchObject({
      items: [
        { step: 1, command: 'npm run dev', source: 'package.json' },
        { step: 2, command: 'make up', source: 'Makefile' },
      ],
      status: 'ok',
    });
  });

  it('builds first tasks from the markers and issues, and from nothing else', () => {
    const tasks = sections.find((s) => s.kind === 'first_tasks')!;
    expect(tasks).toMatchObject({
      items: [
        expect.objectContaining({ origin: 'todo', path: 'src/lib/redis.ts', line: 7 }),
        expect.objectContaining({ origin: 'issue', issue_number: 311 }),
      ],
      status: 'ok',
    });
  });

  it('carries the rank percentile on a critical-path row', () => {
    const critical = sections.find((s) => s.kind === 'critical_paths')!;
    expect(critical).toMatchObject({
      items: [expect.objectContaining({ path: 'src/middleware/auth.ts', rank_percentile: 0.97 })],
    });
  });

  it('carries no diagram — a deterministic tour draws nothing', () => {
    expect(sections.find((s) => s.kind === 'architecture')!).toMatchObject({ diagram: null });
  });
});

describe('L06 skeleton — no import graph (AC-57, AC-58)', () => {
  const sections = build(
    {},
    {
      usedGraph: false,
      reading: ['src/index.ts', 'src/routes/public.ts'],
      critical: ['src/index.ts'],
    },
  );

  it('populates both graph-dependent sections from the heuristic candidates', () => {
    expect(sections.find((s) => s.kind === 'reading_path')!).toMatchObject({
      items: [
        expect.objectContaining({ order: 1, path: 'src/index.ts' }),
        expect.objectContaining({ order: 2, path: 'src/routes/public.ts' }),
      ],
    });
    expect(sections.find((s) => s.kind === 'critical_paths')!).toMatchObject({
      items: [expect.objectContaining({ path: 'src/index.ts' })],
    });
  });

  it('marks exactly the two sections computed without the import graph', () => {
    const byKind = Object.fromEntries(sections.map((s) => [s.kind, s.status]));
    expect(byKind.critical_paths).toBe('no_graph');
    expect(byKind.reading_path).toBe('no_graph');
    expect(byKind.architecture).not.toBe('no_graph');
    expect(byKind.run_locally).not.toBe('no_graph');
    expect(byKind.first_tasks).not.toBe('no_graph');
  });

  it('says in the row itself that the reason is a heuristic, not the graph', () => {
    const reading = sections.find((s) => s.kind === 'reading_path')!;
    if (reading.kind !== 'reading_path') throw new Error('unreachable');
    expect(reading.items.length).toBeGreaterThan(0);
    for (const item of reading.items) expect(item.reason).toContain('no import graph');
  });
});

describe('L06 skeleton — merging the model onto the deterministic base (AC-18, AC-19)', () => {
  const base = build(
    { scripts: [{ name: 'dev', command: 'npm run dev', source: 'package.json' }] },
    { reading: ['src/server.ts'] },
  );

  function modelSection(over: Partial<OnboardingSection> & { kind: OnboardingSection['kind'] }) {
    const shell = { title: '', body: '', status: 'ok' as const, links: [] };
    switch (over.kind) {
      case 'architecture':
        return { ...shell, diagram: null, ...over } as OnboardingSection;
      default:
        return { ...shell, items: [], ...over } as OnboardingSection;
    }
  }

  it('keeps all five sections when the model returned only some of them', () => {
    const merged = mergeSections(
      base,
      [modelSection({ kind: 'architecture', title: 'What this is', body: 'A payments API.' })],
      true,
    );

    expect(merged.map((s) => s.kind)).toEqual(FIVE_IN_ORDER);
    expect(merged[0]).toMatchObject({ title: 'What this is', body: 'A payments API.' });
  });

  it('falls back to the deterministic rows when verification dropped every model row', () => {
    const merged = mergeSections(
      base,
      [modelSection({ kind: 'run_locally', title: 'How to run locally', body: '', items: [] })],
      true,
    );

    const run = merged.find((s) => s.kind === 'run_locally')!;
    expect(run).toMatchObject({
      items: [{ step: 1, command: 'npm run dev', source: 'package.json' }],
      status: 'ok',
    });
  });

  it('falls back to the empty line when neither the model nor the facts had anything', () => {
    const bare = build();
    const merged = mergeSections(
      bare,
      [modelSection({ kind: 'first_tasks', title: '', body: '', items: [] })],
      true,
    );

    const tasks = merged.find((s) => s.kind === 'first_tasks')!;
    expect(tasks.status).toBe('empty');
    expect(tasks.body).toContain('good first issue');
    expect(tasks.body).toContain('TODO');
  });

  it('keeps the no-graph marker after a merge', () => {
    const noGraph = build({}, { usedGraph: false, reading: ['src/index.ts'] });
    const merged = mergeSections(
      noGraph,
      [
        modelSection({
          kind: 'reading_path',
          title: 'Guided reading path',
          body: '',
          items: [{ order: 1, path: 'src/index.ts', reason: 'The entry point.' }],
        }),
      ],
      false,
    );

    expect(merged.find((s) => s.kind === 'reading_path')!.status).toBe('no_graph');
  });
});
