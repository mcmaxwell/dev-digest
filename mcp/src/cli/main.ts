import {
  ApiError,
  ApiShapeError,
  ApiTimeoutError,
  ApiUnreachableError,
  createApiClient,
  createResolvers,
  type ApiClient,
} from '../api/index.js';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { parseArgs, type ReviewCommand } from './args.js';
import { EXIT, type ExitCode } from './exit.js';
import { collectDiff, GitError, hasCommits, repoRoot } from './git.js';
import { helpText } from './help.js';
import { MODES } from './modes.js';
import {
  renderCiResult,
  renderJson,
  renderJsonFailure,
  renderReview,
  renderUntrackedWarning,
} from './render.js';

/**
 * `devdigest review` - the pre-push CLI.
 *
 * A SEPARATE ENTRY POINT from `src/index.ts`, not a branch inside it. That
 * module calls `serveStdio` at the top level and its entire contract is "stdout
 * is the JSON-RPC channel"; a CLI whose whole job is to print to stdout must not
 * share a module with it, because one refactor that moves a `console.log` across
 * the boundary breaks `initialize` for every MCP session. Two files, two stdout
 * contracts, no conditionals.
 *
 * This is also the ONLY file in `src/cli/` that prints or exits. Everything else
 * returns values, which is what makes the flags, the rendering and the exit
 * codes testable without spawning a process.
 */

/** Diff size the server refuses; checked locally so the message is useful. */
const MAX_DIFF_CHARS = 400_000;

async function main(argv: string[]): Promise<ExitCode> {
  const command = parseArgs(argv);

  if (command.kind === 'help') {
    process.stdout.write(`${helpText()}\n`);
    return EXIT.OK;
  }
  if (command.kind === 'version') {
    process.stdout.write('devdigest 0.0.0\n');
    return EXIT.OK;
  }
  if (command.kind === 'usage-error') {
    process.stderr.write(`devdigest: ${command.message}\n`);
    return EXIT.USAGE;
  }
  return review(command);
}

async function review(cmd: ReviewCommand): Promise<ExitCode> {
  const mode = MODES[cmd.mode]!;
  let diffArgs: string[];
  if (mode.diffArgsFor) {
    // A base-relative mode with no base cannot fall back to anything: guessing
    // "main" would review a different set of commits than the pull request.
    if (!cmd.base) {
      process.stderr.write(`devdigest: --mode ${cmd.mode} needs --base <ref>, e.g. --base main.\n`);
      return EXIT.USAGE;
    }
    diffArgs = mode.diffArgsFor(cmd.base);
  } else if (mode.diffArgs) {
    diffArgs = mode.diffArgs;
  } else {
    process.stderr.write(`devdigest: ${mode.notImplemented ?? `Mode "${cmd.mode}" is not implemented.`}\n`);
    return EXIT.USAGE;
  }

  const root = await repoRoot(process.cwd());
  if (!root) {
    process.stderr.write(
      'devdigest: not inside a git repository. Run this from a working copy.\n',
    );
    return EXIT.USAGE;
  }
  if (!(await hasCommits(root))) {
    process.stderr.write(
      'devdigest: this repository has no commits yet, so there are no tracked changes to review.\n',
    );
    return EXIT.NOTHING;
  }

  let tree;
  try {
    tree = await collectDiff(root, diffArgs);
  } catch (err) {
    const detail = err instanceof GitError ? err.message : (err as Error).message;
    process.stderr.write(`devdigest: git failed - ${detail}\n`);
    return EXIT.FAILED;
  }

  // Printed BEFORE the review, so it is visible even when the review then fails,
  // and on stderr, so a hook capturing stdout still shows it to the user.
  const warning = renderUntrackedWarning(tree.untracked);
  if (warning) process.stderr.write(`${warning}\n\n`);

  const ctx = { mode: cmd.mode, untracked: tree.untracked, failOn: cmd.failOn ?? 'the agent gate' };

  if (tree.diff.trim().length === 0) {
    const message =
      tree.untracked.length > 0
        ? 'No changes in tracked files. The untracked files listed above were not reviewed.'
        : 'No changes in tracked files.';
    if (cmd.format === 'json') {
      process.stdout.write(`${renderJsonFailure('nothing_to_review', message, ctx, EXIT.NOTHING)}\n`);
    } else {
      process.stderr.write(`devdigest: ${message}\n`);
    }
    return EXIT.NOTHING;
  }
  if (tree.diff.length > MAX_DIFF_CHARS) {
    // Refused locally rather than round-tripped into a 422: the useful part of
    // the message is the number, and the server cannot phrase it better.
    const message =
      `This diff is ${tree.diff.length} characters; the limit is ${MAX_DIFF_CHARS}. ` +
      'Commit part of the work, or push the branch and review the pull request instead.';
    process.stderr.write(`devdigest: ${message}\n`);
    return EXIT.USAGE;
  }

  const config = loadConfig();
  const api = createApiClient({
    apiUrl: cmd.apiUrl ?? config.apiUrl,
    timeoutMs: config.timeoutMs,
    label: 'devdigest',
  });

  let agentId: string | undefined;
  if (cmd.agent) {
    const resolution = await resolveAgent(api, cmd.agent);
    if ('error' in resolution) {
      process.stderr.write(`devdigest: ${resolution.error}\n`);
      return resolution.code;
    }
    agentId = resolution.id;
  }

  const runUrl = workflowRunUrl();

  try {
    // `--repo` + `--pr` mean this is a CI run: the SERVER reviews, posts the
    // review with its own GitHub token and records the row. Without them the
    // call is the ordinary PR-less review, which persists nothing.
    const result =
      cmd.repo && cmd.prNumber
        ? (
            await api.ciRun({
              repo: cmd.repo,
              pr_number: cmd.prNumber,
              diff: tree.diff,
              ...(agentId ? { agent: agentId } : {}),
              ...(cmd.postAs ? { post_as: cmd.postAs } : {}),
              ...(cmd.failOn ? { fail_on: cmd.failOn } : {}),
              ...(runUrl ? { github_url: runUrl } : {}),
            })
          ).review
        : await api.reviewDiff({
            diff: tree.diff,
            ...(agentId ? { agent: agentId } : {}),
            ...(cmd.severityMin ? { severity_min: cmd.severityMin } : {}),
            ...(cmd.failOn ? { fail_on: cmd.failOn } : {}),
            source: 'cli',
          });
    const code = result.blockers > 0 ? EXIT.BLOCKED : EXIT.OK;
    if (cmd.ciResult) await writeCiResult(cmd.ciResult, result, cmd.prNumber ?? null);
    process.stdout.write(
      cmd.format === 'json'
        ? `${renderJson(result, ctx, code)}\n`
        : `${renderReview(result, ctx)}\n`,
    );
    return code;
  } catch (err) {
    const message = describe(err);
    if (cmd.format === 'json') {
      process.stdout.write(`${renderJsonFailure('review_failed', message, ctx, EXIT.FAILED)}\n`);
    } else {
      process.stderr.write(`devdigest: ${message}\n`);
    }
    // ALWAYS 2, never 0. A hook must fail closed when the reviewer did not run.
    return EXIT.FAILED;
  }
}

/**
 * The artifact file, written before the review is printed.
 *
 * A failure here is reported and then IGNORED: the review has already been paid
 * for and its exit code is the thing CI acts on, so an unwritable path must not
 * turn a finished review into a failed step.
 */
async function writeCiResult(
  path: string,
  result: Parameters<typeof renderCiResult>[0],
  prNumber: number | null,
): Promise<void> {
  try {
    await writeFile(path, `${renderCiResult(result, prNumber)}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`devdigest: could not write ${path} - ${(err as Error).message}\n`);
  }
}

/**
 * The URL of the workflow run, when there is one.
 *
 * These three variables are set by GitHub Actions itself, so the generated
 * workflow does not have to pass a flag for something the runner already knows.
 * Outside Actions they are absent and the run is simply recorded without a link.
 */
function workflowRunUrl(): string | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

/**
 * Slug -> agent id, resolved HERE rather than on the server.
 *
 * The database has no slug column; `src/format/slug.ts` is where "security"
 * becomes an agent in this repo, and that derivation stays in one place. The
 * server therefore accepts an id or an exact name, and the CLI hands it an id.
 */
async function resolveAgent(
  api: ApiClient,
  ref: string,
): Promise<{ id: string } | { error: string; code: ExitCode }> {
  let resolution;
  try {
    resolution = await createResolvers(api).agent(ref);
  } catch (err) {
    return { error: describe(err), code: EXIT.FAILED };
  }
  if (resolution.ok) return { id: resolution.agent.id };
  if (resolution.reason === 'ambiguous') {
    return {
      error:
        `"${ref}" matches ${resolution.matches.length} agents. Pass an id instead: ` +
        resolution.matches.map((a) => `${a.name} (${a.id})`).join(', '),
      code: EXIT.USAGE,
    };
  }
  return {
    error: `No agent matches "${ref}". Known: ${resolution.known.join(', ') || '(none configured)'}.`,
    code: EXIT.USAGE,
  };
}

/** One sentence a human can act on, for every way the call can fail. */
function describe(err: unknown): string {
  if (err instanceof ApiUnreachableError || err instanceof ApiTimeoutError) return err.message;
  if (err instanceof ApiShapeError) {
    return `${err.message} The API and this CLI may be on different versions.`;
  }
  if (err instanceof ApiError) return `the review failed (${err.code}): ${err.message}`;
  return `the review failed: ${(err as Error).message}`;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    process.stderr.write(`devdigest: unexpected failure - ${err.message}\n`);
    process.exit(EXIT.FAILED);
  },
);
