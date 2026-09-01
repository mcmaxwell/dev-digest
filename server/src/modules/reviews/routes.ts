import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiAgentRunRequest, ReviewDiffRequest, ReviewDiffResponse, RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { reviewDiff } from './diff-review.js';
import { DIFF_REVIEW_BODY_LIMIT_BYTES } from './constants.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   POST   /reviews/diff       {diff, agent?}            → review a PR-less diff (L04 CLI)
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   GET    /agents/:id/runs    ?limit&before                → one agent's own run log (L07)
 *   POST   /pulls/:id/multi-agent-run  {agent_ids}         → fan one PR out to N agents (L07)
 *   GET    /multi-agent-runs/:id                           → header + columns + clusters
 *   GET    /repos/:id/multi-agent-runs ?limit              → a repo's recent runs (headers only)
 *   GET    /agents/run-estimates                           → every enabled agent's pre-run estimate
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;

/** RunRequest, but tolerant of a missing/null body (both fields are optional). */
const RunBody = z.preprocess((v) => v ?? {}, RunRequest);

/**
 * `GET /agents/:id/runs` paging. `limit` is coerced because a querystring is
 * always strings; `before` is the `ran_at` of the oldest row already shown and
 * is exclusive, so a load-more never repeats a row.
 */
const AgentRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  before: z.string().datetime().optional(),
});

/** `GET /repos/:id/multi-agent-runs` paging. The 20-row cap IS the whole list. */
const RepoMultiAgentRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Both fields are optional and an ABSENT body is valid, so the schema
  // pre-normalises a missing/null body to `{}` — validation still happens
  // before the handler (never `Schema.parse(req.body)` in here).
  app.post(
    '/pulls/:id/review',
    {
      schema: { params: IdParams, body: RunBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = req.body;
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Review a raw diff that belongs to no PR (L04, the pre-push CLI) -----
  //
  // The FOUR containment limits ship together with this route, because any one
  // of them alone leaves a money hole reachable from a git hook that fires on
  // every push:
  //   bodyLimit 2 MB      stops the socket
  //   400k chars (zod)    stops a body that fits but would cost a fortune
  //   200 files (service) stops a change that is wide rather than long
  //   4/min               stops repetition — deliberately tighter than the
  //                       10/min on `POST /pulls/:id/review`, which is behind a
  //                       button a human presses, not behind a hook.
  app.post(
    '/reviews/diff',
    {
      schema: { body: ReviewDiffRequest, response: { 200: ReviewDiffResponse } },
      bodyLimit: DIFF_REVIEW_BODY_LIMIT_BYTES,
      config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return reviewDiff(container, workspaceId, req.body, req.log);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });
        // A client that disconnects mid-run must also wake the pending await
        // below — otherwise a run that never emits again (orphaned, no `done`)
        // would leave this generator, and its RunBus subscription, alive forever.
        const onClose = () => {
          done = true;
          resolve?.();
        };
        req.raw.on('close', onClose);

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          req.raw.off('close', onClose);
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- One agent's own run log (the agent editor's Runs tab) --------------
  // One request, at most 50 rows, no per-run follow-up: the trace is fetched
  // only when a row opens the drawer.
  app.get(
    '/agents/:id/runs',
    { schema: { params: IdParams, querystring: AgentRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRunsForAgent(workspaceId, req.params.id, {
        limit: req.query.limit,
        ...(req.query.before !== undefined ? { before: req.query.before } : {}),
      });
    },
  );

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- L07: multi-agent runs ---------------------------------------------
  //
  // 4/min, the TIGHTEST limit on this API, shared with `POST /reviews/diff` and
  // `POST /agents/:id/eval-runs` and chosen there for exactly this reason: one
  // request fans out into N billable model calls.
  //
  // Deliberately NOT behind the job runner. `JobRunner.enqueue` wraps every
  // handler in `withRetry` at a default of 2, so a throw after a successful
  // model call would re-issue and re-bill every call the first attempt made.
  //
  // "At least two agents" is enforced by the SCHEMA (`agent_ids.min(2)`), so a
  // one-agent request is a 422 before the handler runs.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: MultiAgentRunRequest },
      config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const run = await service.startMultiAgentRun(
        workspaceId,
        req.params.id,
        req.body.agent_ids,
        req.log,
      );
      reply.status(201);
      return run;
    },
  );

  // The WHOLE results screen in one request: header, columns and clusters.
  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getMultiAgentRun(workspaceId, req.params.id);
  });

  // A repository's recent multi-agent runs (amendment 01 - the landing page).
  // HEADERS ONLY: no column, no cluster, no finding.
  app.get(
    '/repos/:id/multi-agent-runs',
    { schema: { params: IdParams, querystring: RepoMultiAgentRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listMultiAgentRunsForRepo(workspaceId, req.params.id, req.query.limit);
    },
  );

  // Every enabled agent's pre-run estimate, from recorded history only - so the
  // configure screen issues NO request when a checkbox is toggled.
  app.get('/agents/run-estimates', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.agentRunEstimates(workspaceId);
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
