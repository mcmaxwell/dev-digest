import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DigestQuery } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { DigestService } from './service.js';

/**
 * L09 — digest module. One read-only endpoint backing the pull overview card.
 *   GET /digest?pr_id=  → rolled-up review summary for that pull request
 */
export default async function digestRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestService(app.container);

  app.get('/digest', async (req) => {
    const { workspaceId } = await getContext(app.container, req);

    const query = DigestQuery.parse(req.query);

    return service.forPull(workspaceId, query.pr_id);
  });
}
