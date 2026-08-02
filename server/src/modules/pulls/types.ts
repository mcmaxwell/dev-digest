/** Row shapes the pulls repository accepts. Kept apart from the Zod API
 *  contracts in `@devdigest/shared` — these are persistence inputs. */

export interface PrUpsert {
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
  status: string;
  openedAt: Date | null;
  updatedAt: Date | null;
}

export interface PrFileInput {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PrCommitInput {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}
