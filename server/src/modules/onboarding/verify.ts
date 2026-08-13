import type {
  OnboardingCriticalPath,
  OnboardingFirstTask,
  OnboardingLink,
  OnboardingReadingEntry,
  OnboardingRunStep,
  OnboardingSection,
  OnboardingSectionKind,
  OnboardingSectionStatus,
} from '@devdigest/shared';
import {
  DEFAULT_SECTION_TITLES,
  MAX_CRITICAL_PATHS,
  MAX_DIAGRAM_BYTES,
  MAX_FIRST_TASKS,
  MAX_READING_ENTRIES,
  MAX_RUN_STEPS,
} from './constants.js';
import type { OnboardingDraft } from './schemas.js';
import type { MarkerRow } from './types.js';

/**
 * L06 — grounding the model's output. PURE over an injected `exists(path)`, so
 * every branch is testable without a clone.
 *
 * The model's answer is UNTRUSTED until it is checked against the repository it
 * claims to describe. This file is that check, and it is deliberately the only
 * place a model-authored path can become a link.
 */

/** The two sections that cannot be built without the import graph. */
const GRAPH_DEPENDENT = new Set<OnboardingSectionKind>(['critical_paths', 'reading_path']);

export interface VerifyContext {
  /** Does this repo-relative path exist in the clone at `headSha`? */
  exists: (path: string) => boolean;
  repoFullName: string;
  headSha: string;
  /** Paths a reading-path row may name (AC-8: order and membership). */
  readingCandidates: Set<string>;
  /** Paths a critical-path row may name (AC-23). */
  criticalCandidates: Set<string>;
  /** From `repoIntel.getFileRank`; a path it does not know yields null. */
  rankPercentile: (path: string) => number | null;
  /** Markers the grep actually found — a first task must resolve to one. */
  markers: MarkerRow[];
  /** Issue numbers the label query actually returned. */
  issueNumbers: Set<number>;
  usedGraph: boolean;
}

export interface VerifiedDraft {
  sections: OnboardingSection[];
  /** Rows dropped for naming a path (or issue, or marker) that does not exist. */
  droppedRows: number;
  /** Run steps dropped for citing a source file that does not exist. */
  droppedSteps: number;
}

/**
 * Per-section state.
 *
 * `no_graph` wins over `empty` for the two graph-dependent sections: AC-58 asks
 * for the marker whenever a section was built WITHOUT the import graph, and
 * that is true whether or not the heuristic then found anything. The page still
 * renders an empty line when a section has no content, because it derives that
 * from the content rather than from this status.
 */
export function sectionStatus(
  kind: OnboardingSectionKind,
  hasContent: boolean,
  usedGraph: boolean,
): OnboardingSectionStatus {
  if (GRAPH_DEPENDENT.has(kind) && !usedGraph) return 'no_graph';
  return hasContent ? 'ok' : 'empty';
}

/**
 * A mermaid source must start with a known graph keyword. The same list the
 * client's renderer applies, so a diagram this accepts has already passed the
 * first of the two gates it will meet.
 */
const MERMAID_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;

/**
 * Structural guard on a model-written diagram (AC-21).
 *
 * DELIBERATELY NOT A REAL PARSE. A true `mermaid.parse` needs the `mermaid`
 * package plus a DOM emulator in the API process, for one boolean. The client
 * already parses authoritatively and renders `null` on failure, so this is the
 * cheap first gate: known keyword, no code fence, no line break inside a quoted
 * label (the single most common way a generated diagram fails to parse), and a
 * size cap. Anything rejected here leaves the section's prose standing.
 */
export function guardDiagram(src: string | null | undefined): string | null {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (trimmed.length === 0) return null;
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_DIAGRAM_BYTES) return null;
  if (!MERMAID_RE.test(trimmed)) return null;
  if (trimmed.includes('```')) return null;
  // An odd number of double quotes on a line means a label opened and never
  // closed before the newline — mermaid's most frequent generated-output defect.
  for (const line of trimmed.split('\n')) {
    if ((line.match(/"/g) ?? []).length % 2 !== 0) return null;
  }
  return trimmed;
}

/** Fenced code blocks are left alone; a path inside one is already literal. */
const FENCE_RE = /```[\s\S]*?(?:```|$)/g;
/** An inline-code span, which is how a model names a file in prose. */
const INLINE_CODE_RE = /`([^`\n]+)`/g;

function looksLikePath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 200) return false;
  if (/\s/.test(candidate)) return false;
  if (candidate.startsWith('/') || candidate.includes('..')) return false;
  return candidate.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(candidate);
}

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function blobUrl(repoFullName: string, headSha: string, path: string): string {
  return `https://github.com/${repoFullName}/blob/${headSha}/${encPath(path)}`;
}

/**
 * Link the paths a section's prose names, and ONLY those that exist (AC-34,
 * AC-35).
 *
 * A path that does not resolve stays inline code and never becomes a link:
 * an invented path rendered as a working-looking link is precisely how a
 * hallucination gets mistaken for a fact.
 */
export function linkProsePaths(body: string, ctx: VerifyContext): string {
  if (!body) return body;
  const out: string[] = [];
  let last = 0;
  FENCE_RE.lastIndex = 0;
  for (let m = FENCE_RE.exec(body); m; m = FENCE_RE.exec(body)) {
    out.push(linkOutsideFences(body.slice(last, m.index), ctx));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  out.push(linkOutsideFences(body.slice(last), ctx));
  return out.join('');
}

function linkOutsideFences(text: string, ctx: VerifyContext): string {
  return text.replace(INLINE_CODE_RE, (whole, inner: string, offset: number) => {
    // Already the label of a markdown link — leave it alone.
    if (text[offset - 1] === '[') return whole;
    if (!looksLikePath(inner) || !ctx.exists(inner)) return whole;
    return `[${whole}](${blobUrl(ctx.repoFullName, ctx.headSha, inner)})`;
  });
}

/**
 * Every path a draft mentions, anywhere: row paths, run-step sources, section
 * links, and every path-shaped inline-code span in the prose.
 *
 * The service probes these against the clone ONCE and hands `verifyDraft` a
 * synchronous `exists`. That split is what keeps the whole verification pass
 * pure and testable without a repository, while still checking every claim
 * against the real thing.
 */
export function collectDraftPaths(draft: OnboardingDraft): string[] {
  const out = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (typeof p === 'string' && looksLikePath(p)) out.add(p);
  };

  for (const section of Object.values(draft) as Record<string, unknown>[]) {
    for (const link of (section.links as { path?: string }[] | undefined) ?? []) add(link.path);
    if (typeof section.body === 'string') {
      for (const path of prosePaths(section.body)) add(path);
    }
    for (const item of (section.items as Record<string, unknown>[] | undefined) ?? []) {
      add(item.path as string | undefined);
      add(item.source as string | undefined);
    }
  }
  return [...out];
}

/** Path-shaped inline-code spans in a body, outside fenced code blocks. */
function prosePaths(body: string): string[] {
  const out: string[] = [];
  const outsideFences = body.replace(FENCE_RE, '');
  INLINE_CODE_RE.lastIndex = 0;
  for (let m = INLINE_CODE_RE.exec(outsideFences); m; m = INLINE_CODE_RE.exec(outsideFences)) {
    if (m[1] && looksLikePath(m[1])) out.push(m[1]);
  }
  return out;
}

/** Section-level links keep only the ones that resolve in the clone. */
function verifyLinks(links: { label: string; path: string }[], ctx: VerifyContext): OnboardingLink[] {
  return links.filter((l) => ctx.exists(l.path)).map((l) => ({ label: l.label, path: l.path }));
}

function title(raw: string, kind: OnboardingSectionKind): string {
  return raw.trim().length > 0 ? raw.trim() : DEFAULT_SECTION_TITLES[kind];
}

/**
 * Verify a whole draft into the five persisted sections.
 *
 * Every drop is counted rather than silently swallowed: `dropped_rows` and
 * `dropped_steps` are what make the grounding gate observable instead of
 * invisible.
 */
export function verifyDraft(draft: OnboardingDraft, ctx: VerifyContext): VerifiedDraft {
  let droppedRows = 0;
  let droppedSteps = 0;

  // --- architecture --------------------------------------------------------
  const archBody = linkProsePaths(draft.architecture.body, ctx);
  const diagram = guardDiagram(draft.architecture.diagram);
  const architecture: OnboardingSection = {
    kind: 'architecture',
    title: title(draft.architecture.title, 'architecture'),
    body: archBody,
    status: sectionStatus(
      'architecture',
      archBody.trim().length > 0 || diagram !== null,
      ctx.usedGraph,
    ),
    links: verifyLinks(draft.architecture.links, ctx),
    diagram,
  };

  // --- critical paths ------------------------------------------------------
  const criticalItems: OnboardingCriticalPath[] = [];
  for (const row of draft.critical_paths.items) {
    if (!ctx.criticalCandidates.has(row.path) || !ctx.exists(row.path)) {
      droppedRows += 1;
      continue;
    }
    if (criticalItems.some((r) => r.path === row.path)) continue;
    criticalItems.push({
      path: row.path,
      reason: row.reason,
      rank_percentile: ctx.rankPercentile(row.path),
    });
    if (criticalItems.length >= MAX_CRITICAL_PATHS) break;
  }
  const criticalPaths: OnboardingSection = {
    kind: 'critical_paths',
    title: title(draft.critical_paths.title, 'critical_paths'),
    body: linkProsePaths(draft.critical_paths.body, ctx),
    status: sectionStatus('critical_paths', criticalItems.length > 0, ctx.usedGraph),
    links: verifyLinks(draft.critical_paths.links, ctx),
    items: criticalItems,
  };

  // --- run locally ---------------------------------------------------------
  // Steps are NOT restricted to a candidate set: AC-25 defines the check as
  // "the cited source exists", not "the command came from a list", so the model
  // may quote a command out of a README as long as it names the file.
  const runItems: OnboardingRunStep[] = [];
  for (const row of draft.run_locally.items) {
    if (!ctx.exists(row.source)) {
      droppedSteps += 1;
      continue;
    }
    runItems.push({ step: runItems.length + 1, command: row.command, source: row.source });
    if (runItems.length >= MAX_RUN_STEPS) break;
  }
  const runLocally: OnboardingSection = {
    kind: 'run_locally',
    title: title(draft.run_locally.title, 'run_locally'),
    body: linkProsePaths(draft.run_locally.body, ctx),
    status: sectionStatus('run_locally', runItems.length > 0, ctx.usedGraph),
    links: verifyLinks(draft.run_locally.links, ctx),
    items: runItems,
  };

  // --- reading path --------------------------------------------------------
  const readingItems: OnboardingReadingEntry[] = [];
  for (const row of draft.reading_path.items) {
    if (!ctx.readingCandidates.has(row.path) || !ctx.exists(row.path)) {
      droppedRows += 1;
      continue;
    }
    if (readingItems.some((r) => r.path === row.path)) continue;
    readingItems.push({ order: readingItems.length + 1, path: row.path, reason: row.reason });
    if (readingItems.length >= MAX_READING_ENTRIES) break;
  }
  const readingPath: OnboardingSection = {
    kind: 'reading_path',
    title: title(draft.reading_path.title, 'reading_path'),
    body: linkProsePaths(draft.reading_path.body, ctx),
    status: sectionStatus('reading_path', readingItems.length > 0, ctx.usedGraph),
    links: verifyLinks(draft.reading_path.links, ctx),
    items: readingItems,
  };

  // --- first tasks ---------------------------------------------------------
  const markerKeys = new Set(ctx.markers.map((m) => `${m.path}:${m.line}`));
  const taskItems: OnboardingFirstTask[] = [];
  for (const row of draft.first_tasks.items) {
    const kept = resolveFirstTask(row, markerKeys, ctx);
    if (!kept) {
      droppedRows += 1;
      continue;
    }
    taskItems.push(kept);
    if (taskItems.length >= MAX_FIRST_TASKS) break;
  }
  const firstTasks: OnboardingSection = {
    kind: 'first_tasks',
    title: title(draft.first_tasks.title, 'first_tasks'),
    body: linkProsePaths(draft.first_tasks.body, ctx),
    status: sectionStatus('first_tasks', taskItems.length > 0, ctx.usedGraph),
    links: verifyLinks(draft.first_tasks.links, ctx),
    items: taskItems,
  };

  return {
    sections: [architecture, criticalPaths, runLocally, readingPath, firstTasks],
    droppedRows,
    droppedSteps,
  };
}

/**
 * A first task survives only when it resolves to a marker WE found or an issue
 * WE fetched. A plausible chore the model invented has no citation and is not a
 * task (AC-28, AC-29).
 */
function resolveFirstTask(
  row: OnboardingDraft['first_tasks']['items'][number],
  markerKeys: Set<string>,
  ctx: VerifyContext,
): OnboardingFirstTask | null {
  if (row.origin === 'todo') {
    if (!row.path || !row.line) return null;
    if (!markerKeys.has(`${row.path}:${row.line}`)) return null;
    if (!ctx.exists(row.path)) return null;
    return {
      title: row.title,
      origin: 'todo',
      path: row.path,
      line: row.line,
      issue_number: null,
    };
  }
  if (!row.issue_number || !ctx.issueNumbers.has(row.issue_number)) return null;
  return {
    title: row.title,
    origin: 'issue',
    path: null,
    line: null,
    issue_number: row.issue_number,
  };
}
