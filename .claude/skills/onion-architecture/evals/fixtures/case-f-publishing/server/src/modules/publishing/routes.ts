import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PublishInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { PublishService } from './service.js';

/**
 * L12 — publishing module.
 *   POST /publish          → publish a finished review to its pull request
 *   GET  /publish/summary  → per-repo publish counters for the settings table
 */
export default async function publishingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PublishService(app.container);

  service.registerPublishJobHandler();

  app.post('/publish', { schema: { body: PublishInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);

    const existing = await service.alreadyPublished(workspaceId, req.body.review_id);
    if (existing) {
      reply.status(200);
      return existing;
    }

    const result = await service.publish(workspaceId, req.body);
    reply.status(201);
    return result;
  });

  app.get('/publish/summary', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.summary(workspaceId);
  });
}
