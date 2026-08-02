import type {
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SettingsRepository } from './repository.js';
import { rowsToSettings } from './helpers.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';

/**
 * F1 — settings service. Non-secret workspace prefs plus the provider
 * connection test. Secret VALUES never touch this module's table — they go
 * through `container.secrets` (SecretsProvider).
 */
export class SettingsService {
  private repo: SettingsRepository;

  constructor(private container: Container) {
    this.repo = new SettingsRepository(container.db);
  }

  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.listForWorkspace(workspaceId));
  }

  /** Which provider keys are configured — booleans only, values NEVER returned. */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /** Upsert prefs. ATOMIC: a partially applied settings update is never visible. */
  async update(
    workspaceId: string,
    userId: string | null,
    patch: SettingsUpdate,
  ): Promise<Settings> {
    await this.repo.transaction(async (tx) => {
      for (const [key, value] of Object.entries(patch)) {
        await this.repo.upsert({ workspaceId, userId, key, value }, tx);
      }
    });
    return this.get(workspaceId);
  }

  /**
   * Probe a provider key. When the UI supplies a key (BYO), it is tested FIRST
   * and only persisted once the probe succeeds — a bad key must never overwrite
   * a working stored one.
   */
  async testConnection(provider: ConnTestProvider, key?: string): Promise<ConnTestResult> {
    const secretKey = SECRET_KEY_BY_PROVIDER[provider];
    if (key && !this.container.secrets.set) {
      return { provider, ok: false, message: 'Secrets backend is read-only' };
    }

    try {
      const message = key
        ? await this.probeCandidate(provider, key)
        : await this.probeStored(provider);

      if (key) {
        await this.container.secrets.set!(secretKey, key);
        this.container.invalidateSecretCaches();
      }
      return { provider, ok: true, message };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }

  /** Probe using the key already in the SecretsProvider. */
  private async probeStored(provider: ConnTestProvider): Promise<string> {
    if (provider === GITHUB_PROVIDER) {
      const gh = await this.container.github();
      return `Connected as @${await gh.currentLogin()}`;
    }
    const llm = await this.container.llm(provider);
    return `OK — ${(await llm.listModels()).length} models available`;
  }

  /**
   * Probe a candidate key WITHOUT persisting it: build a throwaway client from
   * the key itself, so a failed test leaves the stored secret untouched.
   */
  private async probeCandidate(provider: ConnTestProvider, key: string): Promise<string> {
    if (provider === GITHUB_PROVIDER) {
      const gh = this.container.githubWithToken(key);
      return `Connected as @${await gh.currentLogin()}`;
    }
    const llm = this.container.llmWithKey(provider, key);
    return `OK — ${(await llm.listModels()).length} models available`;
  }
}
