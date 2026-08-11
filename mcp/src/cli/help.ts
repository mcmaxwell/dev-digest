import { EXIT_DESCRIPTIONS } from './exit.js';
import { DEFAULT_MODE, MODES } from './modes.js';

/**
 * The whole `--help`, generated from the same tables the code dispatches on, so
 * a new mode or a new exit code cannot be documented wrong.
 *
 * Three things here are not decoration and are asserted by the tests: every exit
 * code is listed (a hook author reads nothing else), untracked files are named
 * as excluded (the surprising behaviour must be discoverable before it bites),
 * and the prompt-context caveat is stated (this review sees less than a PR
 * review does, and a user who does not know that will over-trust it).
 */
export function helpText(): string {
  const modes = Object.entries(MODES).map(
    ([name, def]) => `  --mode ${name.padEnd(9)} ${def.describe}`,
  );
  const codes = EXIT_DESCRIPTIONS.map(([code, text]) => `  ${code}  ${text}`);

  return [
    'devdigest review - run a DevDigest reviewer agent on your uncommitted changes.',
    '',
    'USAGE',
    '  devdigest review [--mode <mode>] [--agent <slug|id>] [--fail-on <severity>]',
    '                   [--severity-min <severity>] [--format text|json] [--api <url>]',
    '',
    'MODES',
    ...modes,
    `  (default: --mode ${DEFAULT_MODE})`,
    '',
    'OPTIONS',
    '  --agent <slug|id>      Which reviewer agent to run. Defaults to the only enabled',
    '                         agent; with several enabled you must name one.',
    '  --fail-on <severity>   critical | warning | suggestion. Findings at or above this',
    "                         severity are blockers and set exit code 1. Defaults to the",
    "                         agent's own configured gate.",
    '  --severity-min <sev>   Hide findings below this severity from the output.',
    '  --format text|json     json prints one machine-readable object, including the',
    '                         untracked files that were excluded.',
    '  --api <url>            DevDigest API base URL (default $DEVDIGEST_API_URL or',
    '                         http://localhost:3001).',
    '',
    'UNTRACKED FILES ARE NOT REVIEWED',
    '  Only tracked files are sent. Untracked files are untracked on purpose - .env.local,',
    '  credentials.json, scratch notes - and this command uploads what it collects to a',
    '  hosted model. Every run names the untracked files it skipped on stderr; run',
    '  `git add <file>` to include one.',
    '',
    'WHAT THIS REVIEW DOES NOT SEE',
    '  There is no pull request here, so the prompt gets no repository map, no callers of',
    '  the changed symbols, no linked issue and no PR description. It still gets the',
    "  agent's system prompt and skills, the prompt-injection guard, the scope filter and",
    '  the citation gate: every finding must quote a real line of your diff. Review the',
    '  pull request in DevDigest for the fuller picture.',
    '',
    'EXIT CODES',
    ...codes,
    '',
    'EXAMPLE pre-push hook (.git/hooks/pre-push)',
    '  #!/bin/sh',
    '  devdigest review --mode working --fail-on critical || exit $?',
  ].join('\n');
}
