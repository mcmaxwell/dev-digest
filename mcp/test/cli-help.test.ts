/**
 * `--help` carries three things the CLI cannot work without, and this file is
 * what stops any of them being edited away:
 *
 *  - every exit code, because a pre-push hook author reads nothing else;
 *  - the untracked-files exclusion, because it is the one surprising behaviour
 *    and finding it out by accident means finding it out too late;
 *  - what the prompt does NOT get, because a review that sees less than the PR
 *    review does must not be over-trusted.
 */
import { describe, expect, it } from 'vitest';
import { helpText } from '../src/cli/help.js';
import { EXIT_DESCRIPTIONS } from '../src/cli/exit.js';
import { MODES } from '../src/cli/modes.js';

const help = helpText();

describe('devdigest --help', () => {
  it('documents every exit code', () => {
    expect(EXIT_DESCRIPTIONS).toHaveLength(5);
    for (const [code, text] of EXIT_DESCRIPTIONS) {
      expect(help, `exit code ${code}`).toContain(`  ${code}  ${text}`);
    }
  });

  it('lists every mode, including the unimplemented ones', () => {
    for (const name of Object.keys(MODES)) expect(help).toContain(`--mode ${name}`);
  });

  it('says untracked files are excluded, and how to include one', () => {
    expect(help).toContain('UNTRACKED FILES ARE NOT REVIEWED');
    expect(help).toContain('.env.local');
    expect(help).toContain('git add <file>');
  });

  it('states what the prompt loses against a pull-request review', () => {
    expect(help).toContain('no repository map');
    expect(help).toContain('citation gate');
  });

  it('shows a working pre-push hook', () => {
    expect(help).toContain('pre-push');
    expect(help).toContain('devdigest review --mode working --fail-on critical');
  });
});
