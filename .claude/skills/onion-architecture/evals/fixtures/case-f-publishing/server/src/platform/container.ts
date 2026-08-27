/**
 * Excerpt of `platform/container.ts` — only the parts this change adds.
 * The surrounding class, constructor and existing getters are unchanged.
 */

import type { ReportStore } from '../adapters/reportstore/index.js';
import { S3ReportStore } from '../adapters/reportstore/s3.js';

export interface ContainerOverrides {
  // …existing slots…
  reportStore?: ReportStore;
}

export class Container {
  // …existing fields and getters…

  private _reportStore?: ReportStore;

  /** Secret-gated: the bucket token is resolved through SecretsProvider. */
  async reportStore(): Promise<ReportStore> {
    if (this.overrides.reportStore) return this.overrides.reportStore;
    if (this._reportStore) return this._reportStore;
    const token = await this.secrets.get('REPORT_STORE_TOKEN');
    if (!token) throw new ConfigError('REPORT_STORE_TOKEN is not configured');
    this._reportStore = new S3ReportStore(
      this.config.reportStoreEndpoint,
      this.config.reportStoreBucket,
      token,
    );
    return this._reportStore;
  }
}
