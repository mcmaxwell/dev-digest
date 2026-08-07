import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionEvidence,
  ConventionScan,
  ConventionSkillDraft,
} from '@devdigest/shared';
import { ConventionEvidence as ConventionEvidenceSchema } from '@devdigest/shared';
import { SKILL_NAME_SUFFIX } from './constants.js';
import type { ConventionRow, ConventionScanRow } from './repository.js';
import type { ConventionProbe } from './types.js';

/** Row → DTO mappers and the markdown renderer for the generated skill. */

function toEvidence(value: unknown): ConventionEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: ConventionEvidence[] = [];
  for (const item of value) {
    const parsed = ConventionEvidenceSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category as ConventionCategory,
    rule: row.rule,
    rationale: row.rationale,
    evidence: toEvidence(row.evidence),
    confidence: row.confidence ?? 0,
    adherence: row.adherence,
    support: row.support,
    violations: row.violations,
    origin: row.origin,
    status: row.status,
    edited: row.edited,
  };
}

export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    repo_id: row.repoId,
    status: row.status,
    sha: row.sha,
    provider: row.provider,
    model: row.model,
    sample_count: row.sampleCount,
    candidate_count: row.candidateCount,
    error: row.error,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

export function probeOf(row: ConventionRow): ConventionProbe | undefined {
  const p = row.probe as { positive?: unknown; negative?: unknown } | null;
  if (!p || typeof p.positive !== 'string' || typeof p.negative !== 'string') return undefined;
  return { positive: p.positive, negative: p.negative };
}

/** `Always use async/await…` → `always-use-async-await` (a stable heading anchor). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Render accepted candidates as a skill body.
 *
 * Every rule ships with its evidence because a reviewer instructed to enforce an
 * unsourced rule has no way to calibrate it — the `file:line` is what lets the
 * agent recognise the same pattern in a diff, and what lets a human sanity-check
 * the skill before enabling it.
 */
export function renderSkillBody(
  repoName: string,
  candidates: ConventionCandidate[],
): string {
  const sections = candidates.map((c) => {
    const lines = [`## ${slugify(c.rule) || c.category}`, c.rule];
    if (c.rationale) lines.push('', c.rationale);

    const cited = c.evidence.slice(0, 3);
    if (cited.length > 0) {
      const label = cited.length === 1 ? 'Detected in' : 'Detected in';
      lines.push(
        '',
        `${label} ${cited.map((e) => `\`${e.path}:${e.line}\``).join(', ')}:`,
        '',
        '```',
        ...cited.map((e) => e.snippet),
        '```',
      );
    }
    if (c.adherence != null && c.support != null) {
      lines.push(
        '',
        `Followed in ${Math.round(c.adherence * 100)}% of matching sites (${c.support} conforming, ${c.violations ?? 0} violating).`,
      );
    }
    return lines.join('\n');
  });

  return [
    `# ${repoName}-${SKILL_NAME_SUFFIX}`,
    '',
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
    '',
    sections.join('\n\n'),
  ].join('\n');
}

/** One merged draft, or one per category when the user wants them split. */
export function buildSkillDrafts(
  repoName: string,
  candidates: ConventionCandidate[],
  mode: 'merged' | 'per_category',
): ConventionSkillDraft[] {
  if (candidates.length === 0) return [];

  if (mode === 'merged') {
    return [
      {
        name: `${repoName}-${SKILL_NAME_SUFFIX}`,
        description: `${candidates.length} house convention${
          candidates.length === 1 ? '' : 's'
        } extracted from ${repoName}`,
        type: 'convention',
        body: renderSkillBody(repoName, candidates),
        candidate_ids: candidates.map((c) => c.id),
      },
    ];
  }

  const byCategory = new Map<ConventionCategory, ConventionCandidate[]>();
  for (const c of candidates) {
    const arr = byCategory.get(c.category);
    if (arr) arr.push(c);
    else byCategory.set(c.category, [c]);
  }

  return [...byCategory.entries()].map(([category, group]) => ({
    name: `${repoName}-${category}-${SKILL_NAME_SUFFIX}`,
    description: `${group.length} ${category} convention${
      group.length === 1 ? '' : 's'
    } extracted from ${repoName}`,
    type: 'convention' as const,
    body: renderSkillBody(`${repoName} · ${category}`, group),
    candidate_ids: group.map((c) => c.id),
  }));
}
