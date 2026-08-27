import type { ReportStore, StoredReport } from './index.js';

/**
 * L12 — ReportStore over an S3-compatible bucket.
 */
export class S3ReportStore implements ReportStore {
  constructor(
    private endpoint: string,
    private bucket: string,
    private token: string,
  ) {}

  async put(key: string, body: string): Promise<StoredReport> {
    const res = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.token}` },
      body,
    });
    if (!res.ok) throw new Error(`report store PUT failed: ${res.status}`);
    return { key, bytes: new TextEncoder().encode(body).length };
  }

  async get(key: string): Promise<string | undefined> {
    const res = await fetch(`${this.endpoint}/${this.bucket}/${key}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`report store GET failed: ${res.status}`);
    return res.text();
  }

  /** Time-limited public link. S3-specific: not part of the ReportStore port. */
  presignedUrl(key: string, ttlSeconds: number): string {
    const expires = ttlSeconds.toString();
    return `${this.endpoint}/${this.bucket}/${key}?X-Amz-Expires=${expires}`;
  }
}
