import type {
  Finding,
  Provider,
  ReviewDiffRequest,
  ReviewDiffResponse,
  Severity,
} from '@devdigest/shared';
import { countBlockers, reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentRow } from '../../db/rows.js';
import { DIFF_REVIEW_MAX_FILES, DIFF_REVIEW_TASK, REVIEW_STRATEGY } from './constants.js';
import { skillToBlock } from './helpers.js';

/** Minimal structured logger (pino-compatible: (obj, msg)). */
type Logger = { info: (obj: unknown, msg?: string) => void };

/**
 * L04 - review a raw unified diff that belongs to no pull request.
 *
 * This is what `devdigest review --mode working` calls before a push. It lives
 * in the reviews module because it reuses that module's agent resolution, skill
 * rendering and the shared engine; it is a FUNCTION rather than a method on
 * `ReviewService` because it shares none of that class's run/SSE/persistence
 * machinery.
 *
 * IT PERSISTS NOTHING, deliberately:
 *  - `reviews.pr_id` is `notNull`, so a review row without a PR is impossible;
 *  - `agent_runs.pr_id` IS nullable, but the `(pr_id, ran_at)` index and every
 *    reader filter on it, so such a row would be invisible in the UI while still
 *    inflating future cost rollups;
 *  - there is no SSE consumer (the CLI blocks on the response), so the whole run
 *    apparatus would buy nothing.
 * The `usage` block in the response plus one structured log line is the
 * observability story.
 *
 * SECURITY IS ALREADY HANDLED BY THE ENGINE, and nothing is added on top:
 * `assemblePrompt` appends the shared `INJECTION_GUARD` and wraps the diff in
 * `wrapUntrusted`, and `groundFindings` still requires every finding to cite a
 * real hunk OF THIS DIFF. Neither the repo path nor the agent slug from the
 * caller reaches the prompt at all.
 *
 * WHAT THE PROMPT LOSES against a PR review: with no `repos` row there is no
 * repo map, no callers digest, no rank note, no intent and no PR description.
 * That is an acceptable trade for a small local change, and the CLI's `--help`
 * says so out loud - the enrichments raise precision at PR scale, while the
 * parts that make a finding trustworthy are untouched.
 */
export async function reviewDiff(
  container: Container,
  workspaceId: string,
  body: ReviewDiffRequest,
  logger?: Logger,
): Promise<ReviewDiffResponse> {
  const started = Date.now();

  const diff = parseUnifiedDiff(body.diff);
  if (diff.files.length === 0) {
    throw new AppError(
      'empty_diff',
      'The supplied text contains no file changes. Nothing to review.',
      422,
    );
  }
  if (diff.files.length > DIFF_REVIEW_MAX_FILES) {
    throw new AppError(
      'diff_too_many_files',
      `This diff touches ${diff.files.length} files; the limit is ${DIFF_REVIEW_MAX_FILES}. Review a smaller change, or push and review the pull request.`,
      413,
    );
  }

  const agent = await resolveAgent(container, workspaceId, body.agent);
  const llm = await container.llm(agent.provider as Provider);
  const skills = await loadSkillBlocks(container, agent.id);

  const outcome = await reviewPullRequest({
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    diff,
    llm,
    strategy: agent.strategy ?? REVIEW_STRATEGY,
    ...(skills.length > 0 ? { skills } : {}),
    task: DIFF_REVIEW_TASK,
  });

  const kept = filterBySeverity(outcome.review.findings, body.severity_min);
  // `fail_on` is a Severity on the wire (what a CLI user types) and a CiFailOn
  // in the engine. Absent, the agent's own configured gate decides, so the CLI
  // and CI agree by default.
  const failOn = body.fail_on ? FAIL_ON_BY_SEVERITY[body.fail_on] : agent.ciFailOn;

  const response: ReviewDiffResponse = {
    verdict: outcome.review.verdict,
    summary: outcome.review.summary,
    score: outcome.review.score,
    findings: kept,
    blockers: countBlockers(kept, failOn),
    grounding: outcome.grounding,
    dropped: [...outcome.dropped, ...outcome.scopeDropped].map((d) => ({
      title: d.finding.title,
      reason: d.reason,
    })),
    agent: {
      id: agent.id,
      slug: agentSlug(agent.name),
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
    },
    usage: {
      tokens_in: outcome.tokensIn,
      tokens_out: outcome.tokensOut,
      cost_usd: outcome.costUsd,
      duration_ms: Date.now() - started,
    },
    files_reviewed: diff.files.length,
  };

  // Counts and ids only, never a line of the diff. This endpoint writes no run
  // row, so this line is the only trace it leaves.
  logger?.info(
    {
      call: 'review_diff',
      source: body.source,
      workspaceId,
      agent: agent.name,
      provider: agent.provider,
      model: agent.model,
      files: diff.files.length,
      diffChars: body.diff.length,
      findings: kept.length,
      blockers: response.blockers,
      grounding: outcome.grounding,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      costUsd: outcome.costUsd,
      durationMs: response.usage.duration_ms,
    },
    'review: diff reviewed (no pull request)',
  );

  return response;
}

// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = { SUGGESTION: 1, WARNING: 2, CRITICAL: 3 };

/** Severity (what a user types) -> the engine's CI gate policy. */
const FAIL_ON_BY_SEVERITY: Record<Severity, AgentRow['ciFailOn']> = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  SUGGESTION: 'any',
};

function filterBySeverity(findings: Finding[], min: Severity | undefined): Finding[] {
  if (!min) return findings;
  const floor = SEVERITY_RANK[min];
  return findings.filter((f) => SEVERITY_RANK[f.severity] >= floor);
}

/**
 * `agent` is an id or an exact name. SLUGS ARE NOT RESOLVED HERE: the database
 * has no slug column, the derivation lives in `mcp/src/format/slug.ts`, and a
 * second copy on the server would be a third place for "what does `security`
 * mean" to drift. The CLI resolves a slug to an id before it calls this.
 *
 * With no agent named, the workspace's single enabled agent runs; more than one
 * and we refuse rather than pick, because picking would silently bill the wrong
 * model and produce the wrong review.
 */
async function resolveAgent(
  container: Container,
  workspaceId: string,
  ref: string | undefined,
): Promise<AgentRow> {
  if (ref) {
    if (UUID_RE.test(ref)) {
      const byId = await container.agentsRepo.getById(workspaceId, ref);
      if (byId) return byId;
    }
    const byName = await container.agentsRepo.getByName(workspaceId, ref);
    if (byName) return byName;
    throw new NotFoundError(`No agent matches "${ref}". Run list_agents (or open Agents) to see them.`);
  }

  const enabled = await container.agentsRepo.listEnabled(workspaceId);
  if (enabled.length === 0) {
    throw new NotFoundError('No enabled agent is configured in this workspace.');
  }
  if (enabled.length > 1) {
    throw new AppError(
      'agent_ambiguous',
      `${enabled.length} agents are enabled; name one with --agent (${enabled
        .map((a) => a.name)
        .join(', ')}).`,
      400,
    );
  }
  return enabled[0]!;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Echoed back for display only - see the note in `resolveAgent`. */
function agentSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The agent's enabled linked skills, rendered with the SHARED block rule. A
 * failure to load them degrades to no skills, exactly as the PR review path
 * does - a missing skill must not fail a review.
 */
async function loadSkillBlocks(container: Container, agentId: string): Promise<string[]> {
  try {
    const linked = await container.agentsRepo.linkedSkills(agentId);
    return linked.filter((l) => l.skill.enabled).map(({ skill }) => skillToBlock(skill));
  } catch {
    return [];
  }
}
