import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { IMPORT_MAX_FILE_BYTES } from './constants.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module (owner A1).
 *   GET    /skills            → list (workspace-scoped)
 *   GET    /skills/:id        → one skill
 *   POST   /skills            → create (manual OR a confirmed import)
 *   PUT    /skills/:id        → update (body change bumps version)
 *   DELETE /skills/:id        → delete (agent links cascade)
 *   POST   /skills/import     → multipart .md/.zip → PREVIEW only (no persist)
 *   GET    /skills/:id/versions → immutable body history (newest first)
 *   POST   /skills/:id/rollback → restore an old body AS A NEW version
 *   GET    /skills/:id/stats  → usage stats via the agents the skill is linked to
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
});

const RollbackBody = z.object({
  version: z.number().int().min(1),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  // Multipart is registered INSIDE this plugin scope: only the import route
  // accepts uploads, the rest of the API stays JSON-only.
  await app.register(multipart, {
    limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1 },
  });

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      type: body.type,
      body: body.body,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.post(
    '/skills/:id/rollback',
    { schema: { params: IdParams, body: RollbackBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.rollback(workspaceId, req.params.id, req.body.version);
    },
  );

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  app.post('/skills/import', async (req) => {
    await getContext(app.container, req);
    const file = await req.file();
    if (!file) throw new ValidationError('Upload a .md file or a .zip archive');
    const buf = await file.toBuffer();
    return service.importPreview(file.filename, new Uint8Array(buf));
  });
}
