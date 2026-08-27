/**
 * L12 — ReportStore port. Where a published review report is persisted so the
 * PR comment can link to it. Implemented by adapters/reportstore/s3.ts.
 */
export interface StoredReport {
  key: string;
  bytes: number;
}

export interface ReportStore {
  /** Store the rendered report and return its key. */
  put(key: string, body: string): Promise<StoredReport>;
  /** Fetch a stored report, or undefined when the key is unknown. */
  get(key: string): Promise<string | undefined>;
}
