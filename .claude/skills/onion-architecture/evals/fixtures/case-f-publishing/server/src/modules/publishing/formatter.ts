import type { Finding, Review } from '@devdigest/shared';

/** L12 — report rendering. Pure: review in, markdown out. */

function severityIcon(severity: string): string {
  if (severity === 'CRITICAL') return '🔴';
  if (severity === 'WARNING') return '🟠';
  return '🔵';
}

export function renderFinding(finding: Finding): string {
  return [
    `### ${severityIcon(finding.severity)} ${finding.title}`,
    `\`${finding.file}:${finding.start_line}\``,
    '',
    finding.rationale,
  ].join('\n');
}

export function renderReport(review: Review, fullName: string, prNumber: number): string {
  return [
    `# DevDigest review — ${fullName}#${prNumber}`,
    '',
    review.summary,
    '',
    `Score: ${review.score}/100`,
    '',
    ...review.findings.map(renderFinding),
  ].join('\n');
}

/** The short body posted as the PR review itself. */
export function renderPrBody(review: Review, reportUrl: string | null): string {
  const lines = [review.summary, '', `Score: ${review.score}/100`];
  if (reportUrl) lines.push('', `[Full report](${reportUrl})`);
  return lines.join('\n');
}
