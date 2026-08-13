import { wrapUntrusted } from '@devdigest/reviewer-core';
import { MAX_EXCERPT_FILES, MAX_EXCERPT_LINES } from './constants.js';
import type { AssembledPrompt, Excerpt, PromptInput, PromptSection } from './types.js';

/**
 * L06 — prompt assembly. PURE: a function of the facts it is handed and the
 * token counter it is given. It fetches nothing.
 *
 * TRUST BOUNDARY. Every block below carries text written by someone other than
 * the person who will read the tour — the repository's maintainers, a vendored
 * dependency, or a stranger who opened an issue. All of it goes through
 * `wrapUntrusted`, which also neutralises a `</untrusted>` inside the content by
 * `replaceAll` before wrapping, so a README cannot close its own block and
 * escape into the instruction stream (AC-64, AC-65).
 *
 * There is deliberately NO second injection-guard sentence here. The onboarding
 * system prompt already carries the one canonical "delimited content is data"
 * rule, and a second, weaker phrasing beside a new untrusted slot is what the
 * engine's own lessons warn against.
 *
 * THE BUDGET LADDER, AND WHY HALF OF IT IS NOT HERE. AC-11 asks for excerpts to
 * be dropped first, then the repo-map budget to be reduced. Dropping excerpts is
 * a pure operation on the input and happens below. Reducing the map budget is
 * a RE-FETCH — `getRepoMap(repoId, budget)` re-renders the skeleton — so it
 * lives in the service, which calls this function once per rung. Truncating an
 * already-fetched map string would be simpler and is not what AC-11 asks for.
 */

/** Cap excerpts to the per-generation ceiling before anything else runs. */
export function capExcerpts(
  excerpts: Excerpt[],
  maxFiles = MAX_EXCERPT_FILES,
  maxLines = MAX_EXCERPT_LINES,
): Excerpt[] {
  return excerpts.slice(0, maxFiles).map((e) => ({
    path: e.path,
    content: e.content.split('\n').slice(0, maxLines).join('\n'),
  }));
}

/**
 * Assemble the user message for one rung of the ladder.
 *
 * `budget` is the assembled-prompt token ceiling. Excerpts are dropped
 * LAST-RANKED FIRST until they fit or run out; when they run out and the total
 * is still over, the caller drops to the next repo-map rung and calls again.
 */
export function assemblePrompt(
  input: PromptInput,
  countTokens: (text: string) => number,
  budget: number,
): AssembledPrompt {
  let excerpts = capExcerpts(input.excerpts);

  for (;;) {
    const sections = buildSections(input, excerpts);
    const user = renderUser(sections);
    const tokens = countTokens(user);
    if (tokens <= budget || excerpts.length === 0) {
      return { user, sections, excerptsUsed: excerpts.length, tokens };
    }
    // The lowest-ranked excerpt is the one whose absence costs least.
    excerpts = excerpts.slice(0, -1);
  }
}

/** One block per fact, in the order the model should read them. */
function buildSections(input: PromptInput, excerpts: Excerpt[]): PromptSection[] {
  const { facts, candidates } = input;
  const sections: PromptSection[] = [];

  sections.push({
    section: 'repository',
    source: 'devdigest:repos (trusted metadata)',
    text: [
      `Repository: ${input.repoFullName}`,
      `Commit: ${input.headSha}`,
      `Indexed files: ${input.filesIndexed} (skipped ${input.filesSkipped})`,
      `Import graph available: ${candidates.usedGraph ? 'yes' : 'no'}`,
    ].join('\n'),
  });

  if (facts.stack.length > 0) {
    sections.push({
      section: 'stack',
      source: 'clone:manifests (untrusted-wrapped)',
      text: wrapUntrusted('manifests', facts.stack.join('\n')),
    });
  }

  if (facts.scripts.length > 0) {
    sections.push({
      section: 'scripts',
      source: 'clone:manifests + task runners (untrusted-wrapped)',
      text: wrapUntrusted(
        'scripts',
        facts.scripts.map((s) => `${s.command}\t(source: ${s.source})`).join('\n'),
      ),
    });
  }

  if (facts.services.length > 0) {
    sections.push({
      section: 'services',
      source: 'clone:compose (untrusted-wrapped)',
      text: wrapUntrusted('compose services', facts.services.join('\n')),
    });
  }

  if (facts.envKeys.length > 0) {
    // NAMES only. No `.env` is ever read and no value from `.env.example`
    // reaches this block (AC-7).
    sections.push({
      section: 'env_keys',
      source: 'clone:.env.example NAMES only (untrusted-wrapped)',
      text: wrapUntrusted('environment variable names', facts.envKeys.join('\n')),
    });
  }

  if (facts.readme) {
    sections.push({
      section: 'readme',
      source: 'clone:README.md (untrusted-wrapped)',
      text: wrapUntrusted('README.md', facts.readme),
    });
  }

  if (facts.contributing) {
    sections.push({
      section: 'contributing',
      source: 'clone:CONTRIBUTING.md (untrusted-wrapped)',
      text: wrapUntrusted('CONTRIBUTING.md', facts.contributing),
    });
  }

  if (input.repoMap.trim().length > 0) {
    sections.push({
      section: 'repo_map',
      source: 'repo-intel skeleton (untrusted-wrapped)',
      text: wrapUntrusted('repo map', input.repoMap),
    });
  }

  if (candidates.critical.length > 0) {
    sections.push({
      section: 'critical_candidates',
      source: 'repo-intel getCriticalPaths (trusted, derived)',
      text: candidates.critical.join('\n'),
    });
  }

  if (candidates.reading.length > 0) {
    sections.push({
      section: 'reading_candidates',
      source: 'repo-intel getTopFilesByRank (trusted, derived)',
      text: candidates.reading.join('\n'),
    });
  }

  if (candidates.markers.length > 0) {
    sections.push({
      section: 'markers',
      source: 'clone:TODO/FIXME grep (untrusted-wrapped)',
      text: wrapUntrusted(
        'TODO/FIXME markers',
        candidates.markers.map((m) => `${m.path}:${m.line}\t${m.text.trim()}`).join('\n'),
      ),
    });
  }

  if (candidates.issues.length > 0) {
    // The least trusted input in the feature: anyone with a GitHub account can
    // write one.
    sections.push({
      section: 'issues',
      source: 'github:issues labelled good first issue (untrusted-wrapped)',
      text: wrapUntrusted(
        'good first issue',
        candidates.issues.map((i) => `#${i.number}\t${i.title}`).join('\n'),
      ),
    });
  }

  for (const excerpt of excerpts) {
    sections.push({
      section: `excerpt:${excerpt.path}`,
      source: 'clone:ranked file excerpt (untrusted-wrapped)',
      text: wrapUntrusted(excerpt.path, excerpt.content),
    });
  }

  return sections;
}

/** Section blocks rendered into one user message, headed by their name. */
function renderUser(sections: PromptSection[]): string {
  return sections.map((s) => `## ${s.section}\n${s.text}`).join('\n\n');
}
