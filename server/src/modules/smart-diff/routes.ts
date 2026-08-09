import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff (L03).
 *
 *   GET /pulls/:id/smart-diff → the PR's files grouped core / wiring / boilerplate
 *
 * Unlike `GET /pulls/:id/intent`, this 404s on an unknown PR instead of
 * answering with null: an intent may legitimately not exist yet, but every
 * imported PR has a smart diff — an empty one only means it changed no files.
 *
 * No rate-limit override: the handler runs two indexed reads and a pure
 * function, so the global limit is the right one.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );
}
