/**
 * What "the changes" means for one invocation.
 *
 * A REGISTRY rather than a switch in `main.ts`: adding `staged` later is one
 * entry here plus its git command, with nothing to change in the dispatcher and
 * nothing to change in `--help`, which is generated from this table.
 *
 * `staged` and `branch` are listed while unimplemented on purpose. They parse
 * cleanly and exit with a usage code and a sentence, which is a far better
 * answer than "unknown mode: staged" for something the tool is obviously going
 * to grow.
 */
export interface ModeDef {
  /** How the mode is described in `--help`. */
  describe: string;
  /**
   * The `git diff` arguments that produce this mode's diff, or null while the
   * mode is not implemented. `--no-ext-diff` and the rest are added centrally in
   * `git.ts`, so a new mode cannot forget them.
   */
  diffArgs: string[] | null;
  /** Shown when an unimplemented mode is asked for. */
  notImplemented?: string;
}

export const MODES: Record<string, ModeDef> = {
  working: {
    describe: 'everything not committed yet: staged and unstaged changes to tracked files',
    diffArgs: ['HEAD'],
  },
  staged: {
    describe: 'only what is in the index (not implemented yet)',
    diffArgs: null,
    notImplemented:
      'Mode "staged" is not implemented yet. Use --mode working, which already covers staged changes together with unstaged ones.',
  },
  branch: {
    describe: 'this branch against its merge base (not implemented yet)',
    diffArgs: null,
    notImplemented:
      'Mode "branch" is not implemented yet. Push the branch and review the pull request in DevDigest, which gets the repo map and intent this command cannot.',
  },
};

export const DEFAULT_MODE = 'working';

export function isMode(name: string): name is keyof typeof MODES {
  return Object.prototype.hasOwnProperty.call(MODES, name);
}
