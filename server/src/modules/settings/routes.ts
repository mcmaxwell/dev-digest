import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  SettingsUpdate,
  ConnTestRequest,
  ConnTestResult,
  SecretsStatus,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { SettingsService } from './service.js';

/**
 * F1 — settings module. Transport layer only.
 *   GET  /settings                 → current non-secret prefs
 *   GET  /settings/secrets-status  → which provider keys are configured (booleans)
 *   PUT  /settings                 → upsert prefs (atomic)
 *   POST /settings/test-connection → test a provider key (OpenAI/Anthropic/GitHub)
 *
 * Secrets are NOT stored here — only non-secret prefs. test-connection probes
 * the key through the SecretsProvider-backed clients and persists a supplied
 * key ONLY after the probe succeeds.
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SettingsService(app.container);

  // NOTE: no response schema on the two prefs endpoints on purpose — every key
  // in `Settings` carries a Zod `.default()`, so parsing the reply would inject
  // defaults for keys the workspace has never set and change what the UI sees.
  app.get('/settings', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId);
  });

  app.get(
    '/settings/secrets-status',
    { schema: { response: { 200: SecretsStatus } } },
    async (req) => {
      await getContext(app.container, req);
      return service.secretsStatus();
    },
  );

  app.put(
    '/settings',
    { schema: { body: SettingsUpdate } },
    async (req) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      return service.update(workspaceId, userId, req.body);
    },
  );

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest, response: { 200: ConnTestResult } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { provider, key } = req.body;
      return service.testConnection(provider, key);
    },
  );
}
