import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBlastResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module (L04).
 *
 *   GET  /pulls/:id/blast          -> PrBlastResponse   (free: pure index read)
 *   POST /pulls/:id/blast/summary  -> PrBlastResponse   (one LLM call)
 *
 * Transport only. Every decision that could go wrong - the tenancy lookup, the
 * degraded gate that keeps the request off the clone, the refusal to summarise
 * an empty radius - lives in the service, where a test can reach it without an
 * HTTP layer.
 *
 * The GET carries NO per-route rate limit: it is a plain indexed read, and the
 * global 120/min already covers it. The POST spends money, so it gets the same
 * tight limit as the other model-calling buttons.
 *
 * The POST returns the WHOLE envelope, not just the summary, so the client can
 * seed a complete cache entry with `setQueryData` instead of re-fetching.
 *
 * DEPRECATED: `POST /pulls/:id/blast/summary` is superseded by
 * `POST /pulls/:id/brief` (L05), which absorbs the impact summary into the PR
 * brief. It is still registered and still functional, and it still writes
 * `pr_blast_summary`; it is simply no longer called by the client. Removing a
 * working route in the same change that redirects its only caller would make
 * two failures indistinguishable, so deletion is a separate follow-up.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: PrBlastResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/blast/summary',
    {
      schema: { params: IdParams, response: { 200: PrBlastResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.summarize(workspaceId, req.params.id, { logger: req.log });
    },
  );
}
