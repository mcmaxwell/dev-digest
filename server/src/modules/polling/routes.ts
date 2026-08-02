import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from '../pulls/service.js';

/**
 * F1 — polling module. MANUAL refresh that ONLY syncs the PR list
 * (new/updated PRs appear, head_sha updates). It does NOT trigger any review —
 * review is manual, owned by the reviews module.
 *
 *   POST /repos/:id/poll  → sync PR list from GitHub, bump last_polled_at
 *
 * The import itself is PullsService.syncPulls — the same code path the PR list
 * uses, so the two can never drift in what they persist.
 */
export default async function pollingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const pulls = new PullsService(app.container, app.log);

  app.post(
    '/repos/:id/poll',
    {
      schema: {
        params: IdParams,
        response: { 200: z.object({ synced: z.number(), reviewTriggered: z.boolean() }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { synced } = await pulls.poll(workspaceId, req.params.id);
      // NOTE: no review is triggered here — manual trigger only.
      return { synced, reviewTriggered: false };
    },
  );
}
