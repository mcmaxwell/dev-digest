import type {
  Agent,
  ConventionCandidate,
  Review,
  ReviewFinding,
  RunSummary,
  Severity,
} from '../api/index.js';
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
