import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ReviewFinding, Severity } from '../api/index.js';
import {
  ambiguousAgentMessage,
  describeApiError,
  pullNotImportedMessage,
  unknownAgentMessage,
  unknownRepoMessage,
} from '../format/errors.js';
import { renderFindings, renderRunHeader, truncationHint } from '../format/render.js';
import { take } from '../format/truncate.js';
import { atLeast } from '../rules/severity.js';
import { waitForRun } from '../wait.js';
import {
  AGENT_DESC,
  fail,
  findingsLimitParam,
  MAX_FINDINGS_LIMIT,
  ok,
  prNumberParam,
  repoParam,
  severityMinParam,
  WAIT_SECONDS_DESC,
  type ToolDeps,
} from './shared.js';

/**
 * The longest description of the five, on purpose:
 *  - `already-imported` heads off the most common first failure, before a call
 *    is spent on it;
 *  - the money-and-time sentence is what makes a model ask the user first, and
 *    it deliberately duplicates `openWorldHint` because hosts rarely show
 *    annotations to the model;
 *  - the last sentence is the degradation contract. Without it a model reads a
 *    timeout as a failure and calls again, i.e. pays twice.
 */
export const RUN_AGENT_ON_PR_DESCRIPTION =
  'Run one DevDigest reviewer agent on an already-imported pull request, wait for it to finish, and return the verdict and findings. This spends real LLM tokens and usually takes 30 to 180 seconds. If the wait limit is reached the tool returns status running plus a run_id instead of an error; call get_findings with that run_id a minute later.';

function filterFindings(findings: readonly ReviewFinding[], min: Severity): ReviewFinding[] {
  return findings.filter((f) => atLeast(f.severity, min));
}

export function registerRunAgentOnPr(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      description: RUN_AGENT_ON_PR_DESCRIPTION,
      inputSchema: z.object({
        repo: repoParam,
        pr_number: prNumberParam,
        agent: z.string().min(1).describe(AGENT_DESC),
        severity_min: severityMinParam,
        limit: findingsLimitParam,
        wait_seconds: z
          .number()
          .int()
          .min(10)
          .max(300)
          .default(deps.defaultWaitSeconds)
          .describe(WAIT_SECONDS_DESC),
      }),
      // `destructiveHint` is set EXPLICITLY: the MCP default is `true` whenever
      // `readOnlyHint` is false, and a review only appends rows. `openWorldHint`
      // is true because this spends real money with a third-party model, and
      // `idempotentHint` is false because two calls are two runs and two bills.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, pr_number, agent, severity_min, limit, wait_seconds }) => {
      try {
        // 1. owner/name -> repo uuid (there is no GET /repos/:owner/:name).
        const resolvedRepo = await deps.resolvers.repo(repo);
        if (!resolvedRepo.ok) return fail(unknownRepoMessage(repo, resolvedRepo.known));
        const where = `${resolvedRepo.repo.full_name}#${pr_number}`;

        // 2. repo + number -> PR uuid. A PR that was never imported has no row
        //    and there is no GitHub fallback anywhere in the server.
        const pull = await deps.api.pullByNumber(resolvedRepo.repo.id, pr_number);
        if (!pull.id) return fail(pullNotImportedMessage(resolvedRepo.repo.full_name, pr_number));

        // 3. slug/name/id -> agent uuid.
        const resolvedAgent = await deps.resolvers.agent(agent);
        if (!resolvedAgent.ok) {
          return fail(
            resolvedAgent.reason === 'ambiguous'
              ? ambiguousAgentMessage(resolvedAgent.slug, resolvedAgent.matches)
              : unknownAgentMessage(agent, resolvedAgent.known),
          );
        }

        // 4. Start it. `all: true` is NOT exposed: one call, one agent, one bill.
        //    The response's `reviews` array is always empty - the executor is
        //    fired as `void this.executor.executeRuns(...)` in
        //    server/src/modules/reviews/service.ts:133 - so the run id is the
        //    only usable output and the result is read back in step 7.
        const started = await deps.api.startReview(pull.id, resolvedAgent.agent.id);
        const target = started.runs[0];
        if (!target) {
          return fail(
            `DevDigest accepted the request for ${where} but started no run. That usually means ` +
              `the agent is disabled - call list_agents with enabled_only=false to check, enable ` +
              `it at http://localhost:3000/agents, then retry.`,
          );
        }

        // 5. Remember the mapping so get_findings can answer by run_id later.
        deps.runIndex.remember({
          runId: target.run_id,
          prId: pull.id,
          repo: resolvedRepo.repo.full_name,
          prNumber: pr_number,
          agent: { id: resolvedAgent.agent.id, name: resolvedAgent.agent.name },
        });

        // 6. Wait (poll; see src/wait.ts for why not SSE).
        const outcome = await waitForRun(deps.api, pull.id, target.run_id, {
          waitMs: wait_seconds * 1000,
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
          ...(deps.now ? { now: deps.now } : {}),
        });

        if (outcome.kind === 'missing') {
          return fail(
            `Run ${target.run_id} on ${where} is no longer in the run history. It was probably ` +
              `deleted from the PR page while it was in flight. Call run_agent_on_pr again to ` +
              `start a fresh run.`,
          );
        }
        if (outcome.kind === 'failed') {
          return fail(
            `The ${resolvedAgent.agent.name} run on ${where} failed: ` +
              `${outcome.run.error ?? 'no error was recorded'}. If that mentions a key or an ` +
              `authentication problem, the provider key is missing from ` +
              `~/.devdigest/secrets.json; otherwise the full trace is on the PR page. Nothing ` +
              `was billed for a failed run in most cases, but do not retry blindly.`,
          );
        }
        if (outcome.kind === 'cancelled') {
          return fail(
            `The ${resolvedAgent.agent.name} run on ${where} was cancelled before it finished. ` +
              `Call run_agent_on_pr again if you still want the review.`,
          );
        }
        if (outcome.kind === 'timeout') {
          // NOT an error: the run is alive and this is the contract the tool
          // description promised.
          return ok(
            [
              `status: running`,
              `run_id: ${target.run_id}`,
              '',
              `The ${resolvedAgent.agent.name} review of ${where} is still running after ` +
                `${wait_seconds}s. Nothing was cancelled - it keeps going on the server, and it ` +
                `will still be billed once.`,
              `Call get_findings with run_id="${target.run_id}" in about a minute to read the ` +
                `verdict and findings. Do NOT call run_agent_on_pr again; that would start a ` +
                `second run and pay twice.`,
            ].join('\n'),
          );
        }

        // 7. Done: pull the persisted review for THIS run.
        const reviews = await deps.api.reviewsForPull(pull.id);
        const review = reviews.find((r) => r.run_id === target.run_id && r.kind === 'review');
        const all = review?.findings ?? [];
        const kept = filterFindings(all, severity_min);
        const { shown } = take(kept, limit);
        const hint = truncationHint(kept, shown.length, severity_min, MAX_FINDINGS_LIMIT);

        const header = renderRunHeader(where, resolvedAgent.agent.name, outcome.run, review);
        const summary = review?.summary ? ['', `Summary: ${review.summary}`] : [];
        const body =
          shown.length > 0
            ? renderFindings(shown, true)
            : `(no findings at severity_min=${severity_min})`;

        return ok([header, ...summary, '', body, ...(hint ? ['', hint] : [])].join('\n'));
      } catch (err) {
        return fail(describeApiError(err));
      }
    },
  );
}
