import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiBundleInput,
  CiExportInput,
  CiInstallation,
  CiRun,
  CiRunInput,
  CiRunResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DIFF_REVIEW_BODY_LIMIT_BYTES } from '../reviews/constants.js';
import { CiService } from './service.js';

/**
 * L06 - Export to CI.
 *   POST /agents/:id/ci-bundle       → the agent as a set of files (no side effects)
 *   POST /agents/:id/export-ci       → the same files, committed behind a PR, + the installation
 *   GET  /agents/:id/ci-installations → the repositories this agent is installed into
 *   POST /ci-runs                    → the runner pushes a diff back; we review, post and record
 *   GET  /ci-runs                    → the workspace's recorded runs, newest first
 *
 * `ci-bundle` is a POST with no side effects rather than a GET because the
 * options are a nested body (a trigger array), which does not belong in a query
 * string. `export-ci` is the one that writes: it reaches a real repository
 * through the GitHub port, so it carries a tighter rate limit than the global
 * 120/min - a repeated click must not turn into a stream of commits.
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

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.export(workspaceId, req.params.id, req.body);
    },
  );

  // ---- Ingest one CI run (the self-hosted runner pushes; nothing is pulled) -
  //
  // This endpoint reviews a diff AND writes a review to GitHub with the user's
  // PAT, on a server with no authentication, so it ships the same four
  // containment limits as `POST /reviews/diff` - socket `bodyLimit`, the 400k
  // zod bound on `diff`, the service's 200-file cap, 4/min - plus a fifth that
  // is specific to it: the repository must already have a `ci_installations`
  // row, so the call cannot be aimed at an arbitrary repository.
  app.post(
    '/ci-runs',
    {
      schema: { body: CiRunInput, response: { 200: CiRunResult } },
      bodyLimit: DIFF_REVIEW_BODY_LIMIT_BYTES,
      config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.recordRun(workspaceId, req.body, req.log);
    },
  );

  app.get(
    '/ci-runs',
    { schema: { response: { 200: z.array(CiRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runs(workspaceId);
    },
  );

  app.get(
    '/agents/:id/ci-installations',
    { schema: { params: IdParams, response: { 200: z.array(CiInstallation) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.installations(workspaceId, req.params.id);
    },
  );
}
