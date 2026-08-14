/**
 * `parseArgs` — the CLI's flag table.
 *
 * Pure, so every flag is one row. The point of keeping parsing out of `main.ts`
 * is exactly this: none of these cases needs a process, a git repo or an API.
 */
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli/args.js';

describe('parseArgs', () => {
  it('defaults to review --mode working, text output', () => {
    expect(parseArgs(['review'])).toEqual({ kind: 'review', mode: 'working', format: 'text' });
  });

  it('treats no arguments and --help alike', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['review', '--help'])).toEqual({ kind: 'help', topic: 'review' });
  });

  it('accepts --flag value and --flag=value alike', () => {
    expect(parseArgs(['review', '--agent', 'security'])).toMatchObject({ agent: 'security' });
    expect(parseArgs(['review', '--agent=security'])).toMatchObject({ agent: 'security' });
  });

  it('parses the unimplemented modes cleanly instead of rejecting them', () => {
    // They must reach the dispatcher, which answers with a sentence and exit 3.
    expect(parseArgs(['review', '--mode', 'staged'])).toMatchObject({ mode: 'staged' });
    expect(parseArgs(['review', '--mode', 'branch'])).toMatchObject({ mode: 'branch' });
  });

  it('normalises severities and rejects anything else', () => {
    expect(parseArgs(['review', '--fail-on', 'warning'])).toMatchObject({ failOn: 'WARNING' });
    expect(parseArgs(['review', '--severity-min', 'CRITICAL'])).toMatchObject({
      severityMin: 'CRITICAL',
    });
    expect(parseArgs(['review', '--fail-on', 'nope'])).toMatchObject({ kind: 'usage-error' });
  });

  it('rejects an unknown flag, an unknown mode and an unknown command', () => {
    expect(parseArgs(['review', '--yolo'])).toMatchObject({ kind: 'usage-error' });
    expect(parseArgs(['review', '--mode', 'cosmic'])).toMatchObject({ kind: 'usage-error' });
    expect(parseArgs(['blast'])).toMatchObject({ kind: 'usage-error' });
  });

  it('rejects a flag whose value is missing rather than swallowing the next flag', () => {
    // `--agent --format json` must not resolve the agent to "--format".
    expect(parseArgs(['review', '--agent', '--format', 'json'])).toMatchObject({
      kind: 'usage-error',
    });
  });

  it('strips a trailing slash from --api so URLs never double up', () => {
    expect(parseArgs(['review', '--api', 'http://host:3001/'])).toMatchObject({
      apiUrl: 'http://host:3001',
    });
  });
});
