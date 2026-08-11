import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { Review, ReviewFinding, Severity } from '../api/index.js';
import { describeApiError, pullNotImportedMessage, unknownRepoMessage } from '../format/errors.js';
import { agentLabel, renderFindings, renderReviewBlock, truncationHint } from '../format/render.js';
import { take } from '../format/truncate.js';
import { latestReviewPerAgent } from '../rules/latest-reviews.js';
import { atLeast } from '../rules/severity.js';
import {
  detailParam,
  fail,
  findingsLimitParam,
  MAX_FINDINGS_LIMIT,
  ok,
  PR_NUMBER_DESC,
  REPO_DESC_FINDINGS,
  RUN_ID_DESC,
  severityMinParam,
  type ToolDeps,
} from './shared.js';

/**
 * The second sentence is where `run_id` XOR (`repo` + `pr_number`) is expressed
 * - in prose, because the JSON Schema alternative is an `anyOf` and flat
 * schemas are the whole point here. The third contrasts this tool with its
 * paid neighbour so a model reaching for "what did the review say" picks the
 * free one.
 */
export const GET_FINDINGS_DESCRIPTION =
  'Return the verdict and findings of a DevDigest review that has already run. Pass run_id for one specific run, or repo plus pr_number for the latest review from every agent on that PR. This does not start a review and costs nothing.';

function filterFindings(findings: readonly ReviewFinding[], min: Severity): ReviewFinding[] {
  return findings.filter((f) => atLeast(f.severity, min));
}

export function registerGetFindings(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_findings',
    {
      description: GET_FINDINGS_DESCRIPTION,
      inputSchema: z.object({
        run_id: z.string().min(1).optional().describe(RUN_ID_DESC),
        repo: z.string().min(1).optional().describe(REPO_DESC_FINDINGS),
        // Optional here (it pairs with `repo`), but the meaning is unchanged,
        // so it keeps the shared wording.
        pr_number: z.number().int().min(1).optional().describe(PR_NUMBER_DESC),
        severity_min: severityMinParam,
        limit: findingsLimitParam,
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ run_id, repo, pr_number, severity_min, limit, detail }) => {
      const withBody = detail === 'full';
      try {
        // The XOR lives HERE rather than in the schema on purpose: `.refine()`
        // or a discriminated union would both emit `anyOf`, which is exactly
        // what the flat-schema rule (and the tools-list structural gate)
        // forbids. The cost of moving it here is one sentence of teaching text
        // in the two failure cases below; the benefit is a schema every model
        // reads correctly.
        if (!run_id && !repo && pr_number === undefined) {
          return fail(
            'get_findings needs either run_id, or repo plus pr_number. Pass run_id when ' +
              'run_agent_on_pr gave you one, otherwise pass repo="owner/name" together with ' +
              'pr_number to get the latest review from every agent on that PR.',
          );
        }
        if (!run_id && (!repo || pr_number === undefined)) {
          return fail(
            `get_findings was given ${repo ? 'repo without pr_number' : 'pr_number without repo'}. ` +
              'Those two go together; pass both, or pass run_id instead.',
          );
        }

        // ---- run_id path ---------------------------------------------------
        if (run_id) {
          const ref = deps.runIndex.lookup(run_id);
          if (!ref) {
            return fail(
              `This MCP server has no record of run ${run_id}. It only remembers runs it started ` +
                `itself (the DevDigest API has no route mapping a run back to its pull request), ` +
                `so a run from an earlier session or from the web UI is not resolvable. Call ` +
                `get_findings again with repo="owner/name" and pr_number instead.`,
            );
          }
          const reviews = await deps.api.reviewsForPull(ref.prId);
          const review = reviews.find((r) => r.run_id === run_id && r.kind === 'review');
          if (!review) {
            return ok(
              `Run ${run_id} on ${ref.repo}#${ref.prNumber} has not produced a review yet. If ` +
                `run_agent_on_pr returned status running, wait another minute and call this ` +
                `again; if the run failed, its error shows in the run history on the PR page.`,
            );
          }
          return ok(
            renderOneReview(review, `${ref.repo}#${ref.prNumber}`, severity_min, limit, withBody),
          );
        }

        // ---- repo + pr_number path ----------------------------------------
        const resolved = await deps.resolvers.repo(repo!);
        if (!resolved.ok) return fail(unknownRepoMessage(repo!, resolved.known));

        const pull = await deps.api.pullByNumber(resolved.repo.id, pr_number!);
        if (!pull.id) {
          return fail(pullNotImportedMessage(resolved.repo.full_name, pr_number!));
        }
        const where = `${resolved.repo.full_name}#${pr_number}`;

        const all = await deps.api.reviewsForPull(pull.id);
        const latest = latestReviewPerAgent(all);

        // An in-flight run explains an empty or stale answer, so it is worth
        // one extra read rather than letting the model conclude "clean".
        const active = await deps.api.activeRuns(pull.id).catch(() => []);
        const prefix =
          active.length > 0
            ? `NOTE: ${active.length} review run(s) are still in flight on this PR, so this may be incomplete.\n\n`
            : '';

        if (latest.length === 0) {
          return ok(
            `${prefix}${where} has no reviews yet. Run one with run_agent_on_pr (pass an agent ` +
              `slug from list_agents) - that spends LLM tokens - or start it from the PR page.`,
          );
        }

        const flat = latest.flatMap((r) => r.findings);
        const kept = filterFindings(flat, severity_min);
        const blocks = latest.map((review) => {
          const mine = take(filterFindings(review.findings, severity_min), limit);
          return renderReviewBlock(review, renderFindings(mine.shown, withBody));
        });

        const head =
          `${where}: latest review from each of ${latest.length} agent(s); ` +
          `${kept.length} findings at severity_min=${severity_min}.`;
        const hints = latest
          .map((r) =>
            truncationHint(
              filterFindings(r.findings, severity_min),
              Math.min(filterFindings(r.findings, severity_min).length, limit),
              severity_min,
              MAX_FINDINGS_LIMIT,
            ),
          )
          .filter((h): h is string => h !== null);

        return ok(
          prefix +
            [head, '', ...blocks, ...(hints.length > 0 ? ['', ...hints] : [])].join('\n'),
        );
      } catch (err) {
        return fail(describeApiError(err));
      }
    },
  );
}

function renderOneReview(
  review: Review,
  where: string,
  severityMin: Severity,
  limit: number,
  withBody: boolean,
): string {
  const kept = filterFindings(review.findings, severityMin);
  const { shown } = take(kept, limit);
  const head =
    `${where} reviewed by ${agentLabel(review.agent_name)}: ` +
    `${review.verdict ?? 'no verdict'}${review.score == null ? '' : ` (score ${review.score})`}. ` +
    `${kept.length} findings at severity_min=${severityMin}.`;
  const hint = truncationHint(kept, shown.length, severityMin, MAX_FINDINGS_LIMIT);
  const body = shown.length > 0 ? renderFindings(shown, withBody) : '(no findings at this severity)';
  return [head, '', body, ...(hint ? ['', hint] : [])].join('\n');
}
