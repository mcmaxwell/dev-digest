/**
 * Exit codes are the CLI's real contract.
 *
 * This command is meant to be wired into a `pre-push` hook, and a hook can only
 * read a number. Collapsing any two of these would break a real decision:
 *
 *  - 1 vs 2: "the reviewer says no" and "the reviewer never ran" must not look
 *    the same. A hook has to fail CLOSED on an infrastructure error, and a human
 *    has to know whether to fix code or start the API.
 *  - 4 vs 0: a clean working tree did not pass a review, it had nothing to
 *    review. Reporting success there teaches people to trust a check that never
 *    happened.
 *  - 3 stays separate from 2 because a typo in a flag is not an outage.
 */
export const EXIT = {
  /** The review ran and nothing reached the `--fail-on` severity. */
  OK: 0,
  /** The review ran and found at least one blocking finding. */
  BLOCKED: 1,
  /** The review could NOT run: API down, timeout, unknown agent, LLM error. */
  FAILED: 2,
  /** Usage error: unknown flag, unimplemented mode, not inside a git repo. */
  USAGE: 3,
  /** Nothing to review: no changes in tracked files. */
  NOTHING: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** One line per code, printed by `--help` and asserted by the tests. */
export const EXIT_DESCRIPTIONS: ReadonlyArray<[ExitCode, string]> = [
  [EXIT.OK, 'review ran, nothing at or above --fail-on'],
  [EXIT.BLOCKED, 'review ran, blocking findings were reported'],
  [EXIT.FAILED, 'review could NOT run (API unreachable, timeout, agent error)'],
  [EXIT.USAGE, 'usage error (unknown flag, unimplemented mode, not a git repo)'],
  [EXIT.NOTHING, 'nothing to review (no changes in tracked files)'],
];
