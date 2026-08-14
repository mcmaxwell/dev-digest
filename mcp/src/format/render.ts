import type {
  Agent,
  ConventionCandidate,
  PrBlast,
  Review,
  ReviewFinding,
  RunSummary,
  Severity,
} from '../api/index.js';
import type { ShapedBlast } from '../rules/blast-shape.js';
import { atLeast, stricterThan } from '../rules/severity.js';
import { slugFor } from './slug.js';
import { clip } from './truncate.js';

/**
 * Plain text, not JSON. The tools return prose-with-structure because that is
 * what a model reads best and because it lets a result carry a SENTENCE (a
 * truncation notice, a "still running" contract) that no JSON Schema has a
 * construct for. Line noise is kept low: every character here is paid for on
 * every call.
 */

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return 'duration unknown';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatCost(usd: number | null | undefined): string {
  return usd == null ? 'cost unknown' : `$${usd.toFixed(4)}`;
}

/** Percent, or the honest word `unmeasured` - "the repo does this 96% of the
 *  time" and "a model believes it" must not look the same. */
export function formatAdherence(adherence: number | null | undefined): string {
  return adherence == null ? 'unmeasured' : `${Math.round(adherence * 100)}%`;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export function renderAgents(
  shown: readonly Agent[],
  opts: { total: number; enabledOnly: boolean; detail: 'concise' | 'full'; ambiguous: Set<string> },
): string {
  const head =
    `${shown.length} of ${opts.total} reviewer agents ` +
    `(enabled_only=${opts.enabledOnly}). Pass the slug, or the id when a slug is ambiguous.`;
  const lines = shown.map((a) => {
    const slug = slugFor(a.name);
    const flags = [
      a.enabled ? null : 'disabled',
      opts.ambiguous.has(slug) ? 'AMBIGUOUS SLUG - use the id' : null,
    ].filter(Boolean);
    const first =
      `- ${slug} | ${a.name} | ${a.provider}/${a.model} | id=${a.id}` +
      (flags.length > 0 ? ` | ${flags.join(' | ')}` : '');
    if (opts.detail === 'full' && a.description) return `${first}\n    ${clip(a.description, 300)}`;
    return first;
  });
  return [head, '', ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function renderFinding(f: ReviewFinding, withBody: boolean): string {
  // `file` and `title` are LLM output derived from a diff somebody else wrote,
  // and the contract puts no length or newline bound on either. Rendered raw
  // into this newline-delimited result they could forge extra lines - a fake
  // verdict, a fake finding - in the reading agent's context. clip() collapses
  // whitespace, which removes the line-forging primitive.
  const head = `[${f.severity}] ${clip(f.file, 200)}:${f.start_line} - ${clip(f.title, 200)}`;
  if (!withBody) return head;
  const body: string[] = [];
  if (f.rationale) body.push(`    why: ${clip(f.rationale)}`);
  if (f.suggestion) body.push(`    fix: ${clip(f.suggestion)}`);
  return [head, ...body].join('\n');
}

export function renderFindings(findings: readonly ReviewFinding[], withBody: boolean): string {
  return findings.map((f) => renderFinding(f, withBody)).join('\n');
}

/**
 * The counts come from the FULL set, before the limit, which is what makes the
 * advice ("switch to WARNING, there are 37") worth following.
 */
export function truncationHint(
  all: readonly ReviewFinding[],
  shownCount: number,
  severityMin: Severity,
  maxLimit: number,
): string | null {
  if (shownCount >= all.length) return null;
  const options: string[] = [];
  const stricter = stricterThan(severityMin);
  if (stricter) {
    const n = all.filter((f) => atLeast(f.severity, stricter)).length;
    options.push(`severity_min="${stricter}" (${n} findings)`);
  }
  options.push(`raise limit (max ${maxLimit})`);
  return (
    `Showing ${shownCount} of ${all.length} findings (severity_min=${severityMin}). ` +
    `Narrow with ${options.join(' or ')}.`
  );
}

// ---------------------------------------------------------------------------
// Runs and reviews
// ---------------------------------------------------------------------------

export function renderCounts(run: RunSummary): string {
  const c = run.severity_counts;
  const total = run.findings_count ?? 0;
  if (!c) return `${total} findings`;
  return `${total} findings (${c.critical} critical, ${c.warning} warning, ${c.suggestion} suggestion)`;
}

/** The header of a finished run: everything a caller needs to judge the result
 *  without a second call, all of it already carried by the run row. */
export function renderRunHeader(
  where: string,
  agentName: string,
  run: RunSummary,
  review: Review | undefined,
): string {
  const verdict = review?.verdict ?? 'no verdict recorded';
  const score = review?.score ?? run.score;
  const scored = score == null ? '' : ` (score ${score})`;
  return [
    `${where} reviewed by ${agentName}: ${verdict}${scored}.`,
    `${renderCounts(run)} - ${formatDuration(run.duration_ms)} - ${formatCost(run.cost_usd)}` +
      (run.model ? ` - ${run.model}` : ''),
  ].join('\n');
}

/**
 * `agent_name` is null both when the agent was deleted and when the review was
 * never attached to one (seeded rows are like that), so the label must not
 * claim a deletion happened.
 */
export function agentLabel(name: string | null | undefined): string {
  return name ?? 'unknown agent';
}

/** One agent's block inside a multi-agent `get_findings` answer. */
export function renderReviewBlock(review: Review, findingsText: string): string {
  const who = agentLabel(review.agent_name);
  const score = review.score == null ? '' : `, score ${review.score}`;
  const run = review.run_id ? `, run_id=${review.run_id}` : '';
  const head = `## ${who}: ${review.verdict ?? 'no verdict'}${score}${run}`;
  return findingsText ? `${head}\n${findingsText}` : `${head}\n(no findings)`;
}

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

export function renderConvention(c: ConventionCandidate, withEvidence: boolean): string {
  const stats = [
    `adherence ${formatAdherence(c.adherence)}`,
    c.support == null ? null : `support ${c.support}`,
    c.violations == null ? null : `violations ${c.violations}`,
    c.confidence == null ? null : `confidence ${c.confidence.toFixed(2)}`,
    c.status === 'accepted' ? null : c.status,
  ].filter(Boolean);
  const head = `- [${c.category}] ${c.rule} (${stats.join(', ')})`;
  if (!withEvidence) return head;
  const first = c.evidence[0];
  return first ? `${head}\n    evidence: ${first.path}:${first.line}` : head;
}

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

export interface BlastRenderOptions {
  repo: string;
  prNumber: number;
  maxCallers: number;
  minRank: number;
  includeEndpoints: boolean;
}

/**
 * The result TEXT for `get_blast_radius`, which is where everything the output
 * schema deliberately omits ends up: truncation counts, the fact that
 * `min_rank` was ignored, and what a `partial` index actually means for the
 * lists below it. None of that is taxed until the tool is called.
 *
 * `shaped` is what the model also receives as `structuredContent`; `page` is the
 * raw envelope, and the only thing read from it here is the pre-truncation
 * totals - a count the schema has no field for.
 */
export function renderBlast(page: PrBlast, shaped: ShapedBlast, opts: BlastRenderOptions): string {
  const where = `${opts.repo}#${opts.prNumber}`;

  if (shaped.index_status === 'degraded') {
    return (
      `${where}: DevDigest has no usable code index for ${opts.repo}, so its blast radius is ` +
      `unknown - this is NOT a claim that the change reaches nothing. Analyze the repository ` +
      `(http://localhost:3000 -> the repo -> Re-analyze), wait for it to finish, then call this again.`
    );
  }

  if (shaped.changed_symbols.length === 0) {
    return (
      `${where}: the index holds no symbols for the files this PR changes. That happens when the ` +
      `PR only touches files the indexer skips (config, generated, non-source), or when it ADDS ` +
      `symbols - the index is built from the default branch, so brand-new symbols are invisible ` +
      `until it merges.`
    );
  }

  // Keyed by POSITION, not by symbol name: `shaped.downstream` is built 1:1 from
  // `page.blast.downstream` by `.map()`, while the shaped `symbol` has been
  // through `clip()`. A name that clip() shortened or flattened would miss a
  // name-keyed lookup and silently report "nothing was truncated", which is the
  // one thing this line exists to prevent.
  const lines = shaped.downstream.map((d, i) => {
    const raw = page.blast.downstream[i];
    const total = raw?.caller_total ?? raw?.callers.length ?? d.callers.length;
    const hidden = total - d.callers.length;
    const head =
      `- ${d.symbol}: ${total} caller file(s)` + (hidden > 0 ? ` (${hidden} not shown)` : '');
    const callers = d.callers.map((c) => `    ${c.file}:${c.line} in ${c.name}`);
    const endpoints =
      d.endpoints_affected.length > 0 ? [`    endpoints: ${d.endpoints_affected.join(', ')}`] : [];
    const crons = d.crons_affected.length > 0 ? [`    jobs: ${d.crons_affected.join(', ')}`] : [];
    return [head, ...callers, ...endpoints, ...crons].join('\n');
  });

  const notes: string[] = [];
  if (shaped.index_status === 'partial') {
    notes.push(
      // `reason` is an enum our own API produces, but it arrives here as a free
      // string and is interpolated into a newline-delimited result, so it goes
      // through clip() like everything else rather than being trusted by origin.
      `The index for ${opts.repo} is PARTIAL${page.index.reason ? ` (${clip(page.index.reason, 60)})` : ''}: ` +
        `an empty caller or endpoint list here means "not known", not "none".`,
    );
  }
  if (opts.minRank > 0 && !page.index.ranked) {
    notes.push(
      `min_rank=${opts.minRank} was IGNORED: this index has no file ranks, so every caller ` +
        `scores 0 and the filter would have hidden all of them.`,
    );
  }
  if (!opts.includeEndpoints) {
    notes.push('include_endpoints=false, so endpoint and job lists were emptied.');
  }
  notes.push(
    'Callers come from the index of the default branch, so line numbers are valid there, not on ' +
      'this PR head. Attribution is file-level: symbols declared in the same file share endpoints.',
  );

  const head =
    `${where}: ${shaped.changed_symbols.length} changed symbol(s), ` +
    `showing at most ${opts.maxCallers} caller(s) each.`;

  return [head, '', ...lines, '', ...notes].join('\n');
}
