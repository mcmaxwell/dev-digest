import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SetContextDocsBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ProjectContextService } from './service.js';

/**
 * L05 — project-context module.
 *   GET  /repos/:id/context          → the repository's document list + scan
 *   GET  /repos/:id/context/doc      → one document's body (?path=)
 *   POST /repos/:id/context/refresh  → re-run discovery, return the fresh list
 *   GET  /agents/:id/context         → an agent's attachments (?repo_id=)
 *   PUT  /agents/:id/context         → replace them
 *   GET  /skills/:id/context         → a skill's attachments
 *   PUT  /skills/:id/context         → replace them
 *
 * Job-handler registration lives here, like `repo-intel/routes.ts`: this plugin
 * runs once at boot and registers SCAN_JOB_KIND, so the enqueues from
 * `repos/service.ts` (after a clone) and `repo-intel/service.ts` (after a
 * resync) have a handler to run against.
 */

const DocQuery = z.object({ path: z.string().min(1) });
const RepoQuery = z.object({ repo_id: z.string().uuid().optional() });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ProjectContextService(container);
  service.registerScanJobHandler();

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/doc',
    { schema: { params: IdParams, querystring: DocQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.readDoc(workspaceId, req.params.id, req.query.path);
    },
  );

  app.post('/repos/:id/context/refresh', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.refresh(workspaceId, req.params.id);
  });

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, querystring: RepoQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getAgentContext(workspaceId, req.params.id, req.query.repo_id ?? null);
    },
  );

  app.put(
    '/agents/:id/context',
    { schema: { params: IdParams, querystring: RepoQuery, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.setAgentDocs(
        workspaceId,
        req.params.id,
        req.body.docs,
        req.query.repo_id ?? null,
      );
    },
  );

  app.get('/skills/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getSkillContext(workspaceId, req.params.id);
  });

  app.put(
    '/skills/:id/context',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.setSkillDocs(workspaceId, req.params.id, req.body.docs);
    },
  );
}
