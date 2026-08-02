import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrCommentInput, PrMeta, PrDetail, PrReviewComment } from '@devdigest/shared';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. Transport layer only: schemas in, status codes out, all
 * business logic delegated to PullsService.
 *   GET  /repos/:id/pulls    → list PRs for a repo (synced from GitHub, persisted)
 *   GET  /pulls/:id          → full PR detail (diff/files, commits, body)
 *   GET  /pulls/:id/comments → inline review comments (proxied to GitHub)
 *   POST /pulls/:id/comments → create one inline review comment
 *
 * Import is idempotent (unique repo_id+number). Review triggering is MANUAL and
 * owned by the reviews module — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container, app.log);

  app.get(
    '/repos/:id/pulls',
    { schema: { params: IdParams, response: { 200: z.array(PrMeta) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.id);
    },
  );

  // Addressed by repo + PR NUMBER, which is what the UI routes carry — saves the
  // client a whole PR-list fetch just to translate a number into a uuid.
  app.get(
    '/repos/:id/pulls/:number',
    {
      schema: {
        params: IdParams.extend({ number: z.coerce.number().int().positive() }),
        response: { 200: PrDetail },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.detailByNumber(workspaceId, req.params.id, req.params.number);
    },
  );

  app.get(
    '/pulls/:id',
    { schema: { params: IdParams, response: { 200: PrDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.detail(workspaceId, req.params.id);
    },
  );

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams, response: { 200: z.array(PrReviewComment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput, response: { 200: PrReviewComment } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body);
    },
  );
}
