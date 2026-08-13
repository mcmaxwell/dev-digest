import type { OnboardingSection } from '@devdigest/shared';
import {
  DEFAULT_SECTION_TITLES,
  MAX_CRITICAL_PATHS,
  MAX_FIRST_TASKS,
  MAX_READING_ENTRIES,
  MAX_RUN_STEPS,
} from './constants.js';
import { firstTaskCandidates } from './candidates.js';
import { sectionStatus } from './verify.js';
import type { CandidateSets, DeterministicFacts } from './types.js';

/**
 * L06 — the deterministic tour. PURE.
 *
 * It has two jobs, and both are about the same guarantee: ALL FIVE SECTIONS
 * ALWAYS EXIST (AC-18).
 *
 *  1. When the model call fails, times out, or returns something unrepairable,
 *     this IS the tour — built from facts alone, persisted as `degraded`, and
 *     readable (AC-60). A failed generation must never produce an error page.
 *  2. When the call succeeds, this is the BASE the verified output merges into,
 *     so a section the model left blank still carries deterministic content or
 *     an empty line naming what was looked for (AC-19).
 *
 * Every string here is English by design: the tour is English-only (spec
 * non-goal) and the document is what "Copy as Markdown" hands over, so it
 * cannot be assembled from client translations.
 */

export interface SkeletonInput {
  facts: DeterministicFacts;
  candidates: CandidateSets;
  rankPercentile: (path: string) => number | null;
}

/** The empty line for each section: what was looked for, and where. */
const EMPTY_BODY: Record<OnboardingSection['kind'], string> = {
  architecture:
    'No manifest, compose file or README was readable in the clone, so there is nothing to describe the shape of this repository yet.',
  critical_paths:
    'No dependency chains were available for this repository. Critical paths appear once the repository is indexed and its import graph is built.',
  run_locally:
    'No runnable commands were found. Looked in `package.json` scripts, `Makefile`, `Justfile` and `Taskfile.yml`.',
  reading_path:
    'No ranked files were available for this repository. The reading path appears once the repository is indexed.',
  // AC-30 names BOTH sources it looked in.
  first_tasks:
    'No first tasks were found. Looked for `TODO` and `FIXME` markers in the highest-ranked files, and for open issues labelled `good first issue`.',
};

/** The five sections built from facts alone, in fixed order. */
export function deterministicSections(input: SkeletonInput): OnboardingSection[] {
  const { facts, candidates, rankPercentile } = input;

  const architectureBody = buildArchitectureBody(facts);
  const architecture: OnboardingSection = {
    kind: 'architecture',
    title: DEFAULT_SECTION_TITLES.architecture,
    body: architectureBody || EMPTY_BODY.architecture,
    status: sectionStatus('architecture', architectureBody.length > 0, candidates.usedGraph),
    links: [],
    diagram: null,
  };

  const criticalItems = candidates.critical.slice(0, MAX_CRITICAL_PATHS).map((path) => ({
    path,
    reason: candidates.usedGraph
      ? 'On a dependency chain from the repository’s highest-ranked files.'
      : 'Prominent by directory size and entry-point naming (no import graph available).',
    rank_percentile: rankPercentile(path),
  }));
  const criticalPaths: OnboardingSection = {
    kind: 'critical_paths',
    title: DEFAULT_SECTION_TITLES.critical_paths,
    body: criticalItems.length > 0 ? '' : EMPTY_BODY.critical_paths,
    status: sectionStatus('critical_paths', criticalItems.length > 0, candidates.usedGraph),
    links: [],
    items: criticalItems,
  };

  const runItems = facts.scripts.slice(0, MAX_RUN_STEPS).map((s, i) => ({
    step: i + 1,
    command: s.command,
    source: s.source,
  }));
  const runLocally: OnboardingSection = {
    kind: 'run_locally',
    title: DEFAULT_SECTION_TITLES.run_locally,
    body: runItems.length > 0 ? '' : EMPTY_BODY.run_locally,
    status: sectionStatus('run_locally', runItems.length > 0, candidates.usedGraph),
    links: [],
    items: runItems,
  };

  const readingItems = candidates.reading.slice(0, MAX_READING_ENTRIES).map((path, i) => ({
    order: i + 1,
    path,
    reason: candidates.usedGraph
      ? 'Ranked highly by the repository’s PageRank-derived file rank.'
      : 'Prominent by directory size and entry-point naming (no import graph available).',
  }));
  const readingPath: OnboardingSection = {
    kind: 'reading_path',
    title: DEFAULT_SECTION_TITLES.reading_path,
    body: readingItems.length > 0 ? '' : EMPTY_BODY.reading_path,
    status: sectionStatus('reading_path', readingItems.length > 0, candidates.usedGraph),
    links: [],
    items: readingItems,
  };

  const taskItems = firstTaskCandidates(candidates.markers, candidates.issues)
    .slice(0, MAX_FIRST_TASKS)
    .map((c) => ({
      title: c.title,
      origin: c.origin,
      path: c.path,
      line: c.line,
      issue_number: c.issueNumber,
    }));
  const firstTasks: OnboardingSection = {
    kind: 'first_tasks',
    title: DEFAULT_SECTION_TITLES.first_tasks,
    body: taskItems.length > 0 ? '' : EMPTY_BODY.first_tasks,
    status: sectionStatus('first_tasks', taskItems.length > 0, candidates.usedGraph),
    links: [],
    items: taskItems,
  };

  return [architecture, criticalPaths, runLocally, readingPath, firstTasks];
}

/** What the deterministic facts alone can honestly say about the repository. */
function buildArchitectureBody(facts: DeterministicFacts): string {
  const lines: string[] = [];
  if (facts.stack.length > 0) {
    lines.push(`**Declared stack** — ${facts.stack.slice(0, 12).join(', ')}.`);
  }
  if (facts.services.length > 0) {
    lines.push(`**Container services** — ${facts.services.join(', ')}.`);
  }
  if (facts.envKeys.length > 0) {
    lines.push(
      `**Configuration** — ${facts.envKeys.length} environment variable(s) declared in the example env file.`,
    );
  }
  if (facts.present.length > 0) {
    lines.push(`**Read from** — ${facts.present.map((p) => `\`${p}\``).join(', ')}.`);
  }
  return lines.join('\n\n');
}

/**
 * Merge a verified draft onto the deterministic base.
 *
 * The model wins wherever it actually said something; the base fills in
 * wherever it did not, or wherever verification dropped everything it did say.
 * That is what keeps a section from going blank because a model omitted it or
 * cited paths that do not exist.
 */
export function mergeSections(
  base: OnboardingSection[],
  verified: OnboardingSection[],
  usedGraph: boolean,
): OnboardingSection[] {
  const byKind = new Map(verified.map((s) => [s.kind, s]));
  return base.map((fallback) => {
    const model = byKind.get(fallback.kind);
    if (!model) return fallback;
    return mergeOne(fallback, model, usedGraph);
  });
}

function mergeOne(
  fallback: OnboardingSection,
  model: OnboardingSection,
  usedGraph: boolean,
): OnboardingSection {
  const body = model.body.trim().length > 0 ? model.body : fallback.body;
  const title = model.title.trim().length > 0 ? model.title : fallback.title;
  const links = model.links.length > 0 ? model.links : fallback.links;

  if (model.kind === 'architecture' && fallback.kind === 'architecture') {
    return {
      kind: 'architecture',
      title,
      body,
      links,
      diagram: model.diagram ?? fallback.diagram,
      status: sectionStatus(
        'architecture',
        body.trim().length > 0 || (model.diagram ?? null) !== null,
        usedGraph,
      ),
    };
  }
  if (model.kind === 'critical_paths' && fallback.kind === 'critical_paths') {
    const items = model.items.length > 0 ? model.items : fallback.items;
    return {
      kind: 'critical_paths',
      title,
      body: items.length > 0 && model.body.trim().length === 0 ? model.body : body,
      links,
      items,
      status: sectionStatus('critical_paths', items.length > 0, usedGraph),
    };
  }
  if (model.kind === 'run_locally' && fallback.kind === 'run_locally') {
    const items = model.items.length > 0 ? model.items : fallback.items;
    return {
      kind: 'run_locally',
      title,
      body: items.length > 0 && model.body.trim().length === 0 ? model.body : body,
      links,
      items,
      status: sectionStatus('run_locally', items.length > 0, usedGraph),
    };
  }
  if (model.kind === 'reading_path' && fallback.kind === 'reading_path') {
    const items = model.items.length > 0 ? model.items : fallback.items;
    return {
      kind: 'reading_path',
      title,
      body: items.length > 0 && model.body.trim().length === 0 ? model.body : body,
      links,
      items,
      status: sectionStatus('reading_path', items.length > 0, usedGraph),
    };
  }
  if (model.kind === 'first_tasks' && fallback.kind === 'first_tasks') {
    const items = model.items.length > 0 ? model.items : fallback.items;
    return {
      kind: 'first_tasks',
      title,
      body: items.length > 0 && model.body.trim().length === 0 ? model.body : body,
      links,
      items,
      status: sectionStatus('first_tasks', items.length > 0, usedGraph),
    };
  }
  return fallback;
}
