import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module (L05).
 *
 *   GET  /pulls/:id/brief  -> { brief }  (null when the PR has none yet)
 *   POST /pulls/:id/brief  -> { brief }  (one LLM call)
 *
 * Transport only. Every decision that could go wrong — the tenancy 404, the four
 * degraded gates that keep the request off the model, the single-flight guard —
 * lives in the service, where a test can reach it without an HTTP layer.
 *
 * Both responses are NULLABLE rather than a 404 on the read: the client's fetch
 * layer turns any non-2xx into a thrown `ApiError`, which would leave the card
 * permanently in an error state on a PR that simply has no brief yet.
 *
 * The GET carries NO per-route rate limit — it is a plain read and the global
 * 120/min already covers it. The POST spends money, so it gets the same tight
 * limit as the other model-calling buttons (AC-50). Note that `app.ts` skips
 * `@fastify/rate-limit` entirely when `NODE_ENV === 'test'`, so this config is
 * inert in every automated lane and is verified by inspection against
 * `blast/routes.ts`.
 *
 * Both verbs return the WHOLE envelope so the client seeds one complete cache
 * entry with `setQueryData` instead of re-fetching.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return { brief: await service.get(workspaceId, req.params.id) };
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: PrBriefResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return {
        brief: await service.generate(workspaceId, req.params.id, { logger: req.log }),
      };
    },
  );
}
