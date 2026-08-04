import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions extractor (L02).
 *
 *   POST  /repos/:id/conventions/extract     → 202 { scanId, jobId } (409 while running)
 *   GET   /repos/:id/conventions             → { scan, candidates }
 *   PATCH /conventions/:id                   → accept / reject / edit one candidate
 *   POST  /repos/:id/conventions/skill-draft → render accepted rules as a skill (no persist)
 *
 * Saving the drafted skill deliberately has NO endpoint here: it goes through
 * the ordinary `POST /skills` + `POST /agents/:id/skills`, so an extracted skill
 * is versioned, editable and linkable exactly like a hand-written one.
 */

const UpdateConventionBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(10).optional(),
    category: ConventionCategory.optional(),
  })
  .refine((b) => b.status !== undefined || b.rule !== undefined || b.category !== undefined, {
    message: 'Provide at least one of status, rule or category',
  });

const SkillDraftBody = z.object({
  candidate_ids: z.array(z.string().uuid()).min(1),
  mode: z.enum(['merged', 'per_category']).default('merged'),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);
  service.registerJobHandler();

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getPage(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      if (await service.isScanRunning(workspaceId, req.params.id)) {
        throw new AppError('scan_in_progress', 'A conventions scan is already running', 409);
      }
      const result = await service.startScan(workspaceId, req.params.id);
      reply.code(202);
      return result;
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.updateCandidate(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.post(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams, body: SkillDraftBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const drafts = await service.skillDraft(
        workspaceId,
        req.params.id,
        req.body.candidate_ids,
        req.body.mode,
      );
      if (drafts.length === 0) throw new NotFoundError('No accepted conventions to render');
      return drafts;
    },
  );
}
