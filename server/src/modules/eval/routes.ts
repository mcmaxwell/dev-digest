import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseBody, EvalSuiteRunInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/** `GET /eval-runs/compare?left=…&right=…` - two run ids to pair. */
const CompareQuery = z.object({
  left: z.string().uuid(),
  right: z.string().uuid(),
});

/**
 * L06 - the eval harness.
 *
 *   POST   /agents/:id/eval-cases      → mint a case (the "turn into eval case" button)
 *   GET    /agents/:id/eval-cases      → the agent's set, each with its last run
 *   GET    /eval-cases/:id             → one case
 *   PUT    /eval-cases/:id             → edit a case (the case editor)
 *   DELETE /eval-cases/:id             → drop a case
 *   POST   /eval-cases/:id/run         → run one case
 *   POST   /agents/:id/eval-runs       → run the WHOLE set, persist one suite run
 *   GET    /agents/:id/eval-runs       → run history, newest first
 *   GET    /eval-runs/:id              → one suite run with its per-case rows
 *   GET    /eval-runs/compare          → two runs, paired case by case
 *   GET    /eval/dashboard             → every agent's set at a glance
 */
export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---- cases -------------------------------------------------------------

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await service.listCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Agent not found');
    return cases;
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Agent not found');
      reply.status(201);
      return created;
    },
  );

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const found = await service.getCase(workspaceId, req.params.id);
    if (!found) throw new NotFoundError('Eval case not found');
    return found;
  });

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const deleted = await service.deleteCase(workspaceId, req.params.id);
    if (!deleted) throw new NotFoundError('Eval case not found');
    return { deleted: true };
  });

  // ---- running -----------------------------------------------------------
  //
  // Both run routes spend money: one case is at least one structured model
  // call, and a suite run is that times the size of the set. The limit matches
  // `POST /reviews/diff` (4/min), the tightest on this API, chosen there for
  // the same reason - one request fanning out into billable calls.
  //
  // Neither is behind the job runner ON PURPOSE: `JobRunner.enqueue` wraps
  // every handler in `withRetry(retries: 2)`, so a transient provider error
  // would re-run the whole set and re-bill every call the first attempt made.

  app.post(
    '/eval-cases/:id/run',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.runOneCase(workspaceId, req.params.id);
      if (!run) throw new NotFoundError('Eval case not found');
      return run;
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, body: EvalSuiteRunInput },
      config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.runSuite(workspaceId, req.params.id, req.body.repeats);
      if (!run) throw new NotFoundError('Agent not found');
      reply.status(201);
      return run;
    },
  );

  // ---- history and comparison -------------------------------------------

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const runs = await service.listRuns(workspaceId, req.params.id);
    if (!runs) throw new NotFoundError('Agent not found');
    return runs;
  });

  // Registered BEFORE `/eval-runs/:id` so the literal path is not swallowed by
  // the uuid param route.
  app.get('/eval-runs/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const compared = await service.compare(workspaceId, req.query.left, req.query.right);
    if (!compared) throw new NotFoundError('Eval run not found');
    return compared;
  });

  app.get('/eval-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const detail = await service.getRun(workspaceId, req.params.id);
    if (!detail) throw new NotFoundError('Eval run not found');
    return detail;
  });

  // ---- dashboard ---------------------------------------------------------

  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });
}
