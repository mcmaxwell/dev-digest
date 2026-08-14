import type { DiffReview } from '../api/index.js';
import { clip } from '../format/truncate.js';

/**
 * PURE rendering for the CLI. Every function returns a string; `main.ts` is the
 * only file that writes one anywhere.
 *
 * Findings come out of a model reading a diff, so their `title`, `file` and
 * bodies are untrusted text. They all go through `clip()`, which collapses
 * whitespace: without it a title containing newlines could forge extra result
 * lines - a fake finding, or a fake "0 blocking findings" footer - in a terminal
 * or in whatever hook is scraping this output.
 */

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export interface RenderContext {
  mode: string;
  untracked: string[];
  failOn: string;
}

export function renderReview(review: DiffReview, ctx: RenderContext): string {
  const findings = [...review.findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.file.localeCompare(b.file) ||
      a.start_line - b.start_line,
  );

  const head = [
    `${review.verdict.replace(/_/g, ' ')}${review.score == null ? '' : ` (score ${review.score})`}` +
      ` - ${review.findings.length} finding(s), ${review.blockers} blocking at ${ctx.failOn}`,
    `${review.agent.name}${review.agent.model ? ` (${review.agent.model})` : ''}` +
      ` - ${review.files_reviewed} file(s), mode ${ctx.mode}`,
  ];

  const body = findings.map(
    (f) =>
      [
        `[${f.severity}] ${clip(f.file, 200)}:${f.start_line} - ${clip(f.title, 200)}`,
        f.rationale ? `    why: ${clip(f.rationale, 300)}` : null,
        f.suggestion ? `    fix: ${clip(f.suggestion, 300)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
  );

  const foot: string[] = [];
  if (review.summary) foot.push(clip(review.summary, 400));
  if (review.dropped.length > 0) {
    // Never silent: a finding the citation gate refused is still information
    // about the model, and hiding it is how a grounding regression goes unseen.
    foot.push(
      `${review.dropped.length} finding(s) were dropped for not citing a real diff line: ` +
        review.dropped.map((d) => clip(d.title, 80)).join('; '),
    );
  }
  foot.push(
    `${review.usage.tokens_in}+${review.usage.tokens_out} tokens` +
      (review.usage.cost_usd == null ? '' : `, $${review.usage.cost_usd.toFixed(4)}`) +
      `, ${(review.usage.duration_ms / 1000).toFixed(1)}s` +
      (review.grounding ? `, grounding ${review.grounding}` : ''),
  );

  return [...head, '', ...(body.length > 0 ? [...body, ''] : []), ...foot].join('\n');
}

/** The stderr warning. Always printed when untracked files exist, never folded
 *  into the normal output, so a hook that captures stdout still shows it. */
export function renderUntrackedWarning(untracked: string[]): string | null {
  if (untracked.length === 0) return null;
  const shown = untracked.slice(0, 10).map((f) => `  ${f}`);
  const more = untracked.length - shown.length;
  return [
    `${untracked.length} untracked file(s) were NOT reviewed (untracked files are excluded so`,
    'this command never uploads secrets or scratch files to a model):',
    ...shown,
    ...(more > 0 ? [`  … and ${more} more`] : []),
    'Run `git add <file>` to include one in the review.',
  ].join('\n');
}

/** `--format json`: the same facts, plus the exclusion the text prints to stderr. */
export function renderJson(
  review: DiffReview,
  ctx: RenderContext,
  exitCode: number,
): string {
  return JSON.stringify(
    {
      mode: ctx.mode,
      fail_on: ctx.failOn,
      exit_code: exitCode,
      verdict: review.verdict,
      score: review.score ?? null,
      summary: review.summary,
      blockers: review.blockers,
      files_reviewed: review.files_reviewed,
      grounding: review.grounding ?? null,
      agent: review.agent,
      usage: review.usage,
      findings: review.findings,
      dropped: review.dropped,
      untracked_excluded: ctx.untracked,
    },
    null,
    2,
  );
}

/** `--format json` for a run that never produced a review. */
export function renderJsonFailure(
  reason: string,
  message: string,
  ctx: { mode: string; untracked: string[] },
  exitCode: number,
): string {
  return JSON.stringify(
    {
      mode: ctx.mode,
      exit_code: exitCode,
      error: { reason, message },
      untracked_excluded: ctx.untracked,
    },
    null,
    2,
  );
}
