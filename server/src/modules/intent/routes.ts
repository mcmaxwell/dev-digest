import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrIntentResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * Intent layer (L03).
 *
 *   GET  /pulls/:id/intent  → { intent }  (null when the PR has none yet)
 *   POST /pulls/:id/intent  → { intent }  (classify / re-classify)
 *
 * Both responses are NULLABLE rather than a 404 on the read: the client's fetch
 * layer turns any non-2xx into a thrown `ApiError`, which would leave the Intent
 * card permanently in an error state on a PR that simply has no intent yet.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return { intent: await service.get(workspaceId, req.params.id) };
    },
  );

  // Tight per-route limit, matching `POST /pulls/:id/review`: each call is an
  // LLM spend, and this one is reachable from a button on the PR page.
  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams, response: { 200: PrIntentResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return {
        intent: await service.classify(workspaceId, req.params.id, { logger: req.log }),
      };
    },
  );
}
