import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiBundleInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * L06 - Export to CI.
 *   POST /agents/:id/ci-bundle → the agent as a set of files (no side effects)
 *
 * A POST with no side effects rather than a GET because the options are a
 * nested body (a trigger array), which does not belong in a query string.
 * Nothing is persisted, so there is no read counterpart to fetch afterwards.
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  app.post(
    '/agents/:id/ci-bundle',
    { schema: { params: IdParams, body: CiBundleInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.bundle(workspaceId, req.params.id, req.body);
    },
  );
}
