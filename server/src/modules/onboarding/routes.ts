import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

/**
 * L06 — onboarding module.
 *   GET  /repos/:id/onboarding           → the whole page in one read
 *   POST /repos/:id/onboarding/generate  → enqueue ONE generation, return the
 *                                          page with `generation.status` running
 *
 * ONE service instance for the process, constructed here in the plugin body:
 * its in-memory map is the single-flight guard, so a second instance would mean
 * two concurrent generations for the same repository. The job handler is
 * registered on that same instance, before any route, exactly as
 * `project-context/routes.ts` does.
 *
 * NEITHER schema carries anything path-shaped. That is not an omission — it is
 * what removes the path-traversal class from this feature by construction: the
 * only file list it reads is a module constant, and every other path comes from
 * `repo-intel` or is checked against the clone before it is used (AC-67).
 *
 * The generation is NOT awaited in the request. It runs on the JobRunner, which
 * is why the page reports a phase the client polls rather than a stream.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new OnboardingService(container, app.log);
  service.registerGenerateJobHandler();

  app.get('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.read(workspaceId, req.params.id);
  });

  app.post('/repos/:id/onboarding/generate', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.requestGeneration(workspaceId, req.params.id);
  });
}
