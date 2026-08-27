import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { InvoicingService } from './service.js';

/**
 * L13 — invoicing module.
 *   GET /invoices/:period  → the rendered invoice for a billing period
 */
const PeriodParams = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });

export default async function invoicingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new InvoicingService(app.container);

  app.get('/invoices/:period', { schema: { params: PeriodParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.forPeriod(workspaceId, req.params.period, new Date());
  });
}
