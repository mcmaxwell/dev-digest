import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The git commands the CLI runs, and the three settings that make them safe.
 *
 * 1. `execFile`, NEVER `exec` and never a shell. Shell injection was a real
 *    critical in an earlier lesson of this course, and there is no argument here
 *    that needs a shell to interpret it.
 * 2. `--no-ext-diff` on every diff. A repository can set `diff.external` in its
 *    own `.git/config`, and without this flag git would EXECUTE that program to
 *    produce the diff we are about to send to a hosted model. Cloning a hostile
 *    repository and running `devdigest review` in it must not run its code.
 * 3. `maxBuffer: 64 MB`. Node's 1 MB default does not fail loudly on a large
 *    diff in every case - and a silently truncated diff is the worst possible
 *    outcome here: the model would review a fragment and the CLI would report a
 *    confident pass.
 */
const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export class GitError extends Error {
  readonly name = 'GitError';
  constructor(
    readonly args: string[],
    message: string,
  ) {
    super(message);
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      // Keep the child's environment predictable: a pager or a locale-dependent
      // message would only make the output harder to parse.
      env: { ...process.env, GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  } catch (err) {
    const detail = (err as { stderr?: string; message?: string }).stderr?.trim();
    throw new GitError(args, detail || (err as Error).message);
  }
}

export interface WorkingTree {
  root: string;
  diff: string;
  /** Untracked files - EXCLUDED from the diff, and reported, never silently dropped. */
  untracked: string[];
}

/** The repository root, or null when the cwd is not inside a git work tree. */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim() || null;
  } catch {
    return null;
  }
}

/** False in a freshly `git init`ed repository, where `git diff HEAD` cannot run. */
export async function hasCommits(root: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * The diff for a mode, plus the untracked files it deliberately leaves out.
 *
 * UNTRACKED FILES ARE EXCLUDED BY DESIGN, and this is the one thing about the
 * command a user must not discover by accident. `.env.local`, `credentials.json`
 * and scratch files are untracked ON PURPOSE, and this command uploads whatever
 * it collects to a hosted model. Including them would quietly turn "check my
 * work" into "upload my untracked secrets". They are named on stderr on every
 * run and carried in `--format json`, so the exclusion is loud rather than
 * silent - a silent one would be the real failure.
 */
export async function collectDiff(root: string, diffArgs: string[]): Promise<WorkingTree> {
  const diff = await git(root, [
    'diff',
    ...diffArgs,
    '--no-color',
    '--no-ext-diff',
    '-U3',
    '--',
  ]);
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { root, diff, untracked };
}
