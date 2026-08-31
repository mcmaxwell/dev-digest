/**
 * What "the changes" means for one invocation.
 *
 * A REGISTRY rather than a switch in `main.ts`: adding `staged` later is one
 * entry here plus its git command, with nothing to change in the dispatcher and
 * nothing to change in `--help`, which is generated from this table.
 *
 * `staged` is listed while unimplemented on purpose. It parses cleanly and exits
 * with a usage code and a sentence, which is a far better answer than "unknown
 * mode: staged" for something the tool is obviously going to grow.
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
  /**
   * For a mode whose diff depends on a ref the user names: the arguments for
   * that `base`. A mode defines this OR `diffArgs`, never both - `main.ts`
   * refuses the invocation when a mode that needs a base was given none, rather
   * than silently reviewing something else.
   */
  diffArgsFor?: (base: string) => string[];
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
    describe: 'this branch against the merge base with --base (what CI reviews)',
    diffArgs: null,
    // THREE dots, not two. `base..HEAD` is "what changed between the two tips"
    // and includes everything that landed on `base` since the branch forked -
    // reviewing other people's commits, and paying for them. `base...HEAD` is
    // the diff from the MERGE BASE, which is exactly what the pull request
    // shows and exactly what CI should review.
    diffArgsFor: (base: string) => [`${base}...HEAD`],
  },
};

export const DEFAULT_MODE = 'working';

export function isMode(name: string): name is keyof typeof MODES {
  return Object.prototype.hasOwnProperty.call(MODES, name);
}
