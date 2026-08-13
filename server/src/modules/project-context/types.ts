/**
 * project-context module types.
 *
 * Wire shapes live in `@devdigest/shared` (`contracts/project-context.ts`);
 * these are the INTERNAL shapes the walk, the repository and the run-assembly
 * pipeline pass between themselves.
 */
import type { ProjectDocCategory } from '@devdigest/shared';

/** One document as the discovery walk found it. The body is never kept. */
export interface DiscoveredDoc {
  /** Repo-relative, forward-slashed. */
  path: string;
  category: ProjectDocCategory;
  sizeBytes: number;
  /** `approxTokens(body)` — the same estimate every budget in this module uses. */
  tokens: number;
}

export interface WalkDocsResult {
  docs: DiscoveredDoc[];
  /** Matched files dropped for exceeding `MAX_DOC_BYTES`. */
  skippedTooLarge: number;
  /** Matched files dropped for exceeding `MAX_DOCS`. */
  bounded: number;
}

/** One stored attachment row, before its body has been read. */
export interface AttachmentRef {
  repoId: string;
  path: string;
  /**
   * `agent` for the agent's own attachment, `skill:<name>` for one inherited
   * through an enabled linked skill. This is the string the trace records.
   */
  origin: string;
}

/** An attachment whose body has been read and measured, ready for the prompt. */
export interface LoadedDoc {
  path: string;
  origin: string;
  tokens: number;
  body: string;
}
