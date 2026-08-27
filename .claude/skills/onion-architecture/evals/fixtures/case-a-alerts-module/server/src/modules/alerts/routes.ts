import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { AlertRuleInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toAlertRuleDto } from './helpers.js';
import { AlertService } from './service.js';

/**
 * L09 — alerts module. Notifies a workspace when a review closes at or above a
 * configured severity.
 *   POST   /alerts/rules      → create an alert rule
 *   GET    /alerts/rules      → list rules (workspace-scoped)
 *   DELETE /alerts/rules/:id  → remove a rule
 */
export default async function alertsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AlertService(app.container);

  service.registerDeliveryJobHandler();

  app.post('/alerts/rules', { schema: { body: AlertRuleInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);

    const [existing] = await app.container.db
      .select()
      .from(t.alertRules)
      .where(
        and(eq(t.alertRules.workspaceId, workspaceId), eq(t.alertRules.repoId, req.body.repo_id)),
      );

    if (existing) {
      reply.status(200);
      return toAlertRuleDto(existing);
    }

    const rule = await service.createRule(workspaceId, userId, req.body);
    reply.status(201);
    return rule;
  });

  app.get('/alerts/rules', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.delete('/alerts/rules/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { deleted: req.params.id };
  });
}
