import { DEFAULT_MODE, isMode, MODES } from './modes.js';

/**
 * PURE argv parsing. It reads no environment, touches no filesystem and prints
 * nothing - it returns either a parsed command or a usage error, and `main.ts`
 * is the only file allowed to turn that into output and an exit code.
 *
 * That split is what makes every flag testable as a table.
 */

export type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';
export type Format = 'text' | 'json';
export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface ReviewCommand {
  kind: 'review';
  mode: string;
  agent?: string;
  failOn?: Severity;
  severityMin?: Severity;
  format: Format;
  apiUrl?: string;
  /** The ref a base-relative mode diffs against (`--mode branch` needs one). */
  base?: string;
  /**
   * `--repo` and `--pr` together switch the CLI from `POST /reviews/diff` to
   * `POST /ci-runs`: the server then records the run and posts the review.
   * Neither is useful without the other, so one without the other is refused.
   */
  repo?: string;
  prNumber?: number;
  postAs?: PostAs;
  /** Where to write the `CiResultArtifact` JSON, for `upload-artifact`. */
  ciResult?: string;
}

export type Command =
  | ReviewCommand
  | { kind: 'help'; topic?: string }
  | { kind: 'version' }
  | { kind: 'usage-error'; message: string };

const SEVERITIES: Record<string, Severity> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  suggestion: 'SUGGESTION',
};

const POST_AS: readonly PostAs[] = ['github_review', 'pr_comment', 'none'];

export function parseArgs(argv: readonly string[]): Command {
  const [first, ...rest] = argv;

  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return { kind: 'help' };
  }
  if (first === '--version' || first === '-v') return { kind: 'version' };
  if (first !== 'review') {
    return {
      kind: 'usage-error',
      message: `Unknown command "${first}". The only command is "review". Try: devdigest review --help`,
    };
  }

  const cmd: ReviewCommand = { kind: 'review', mode: DEFAULT_MODE, format: 'text' };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--help' || arg === '-h') return { kind: 'help', topic: 'review' };

    // `--flag=value` and `--flag value` both work; the former is what a hook
    // script tends to be written with.
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const readValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) return undefined;
      i += 1;
      return next;
    };

    switch (name) {
      case '--mode': {
        const value = readValue();
        if (value === undefined) return missingValue('--mode');
        if (!isMode(value)) {
          return {
            kind: 'usage-error',
            message: `Unknown mode "${value}". Known modes: ${Object.keys(MODES).join(', ')}.`,
          };
        }
        cmd.mode = value;
        break;
      }
      case '--agent': {
        const value = readValue();
        if (value === undefined) return missingValue('--agent');
        cmd.agent = value;
        break;
      }
      case '--fail-on': {
        const value = readValue();
        if (value === undefined) return missingValue('--fail-on');
        const sev = SEVERITIES[value.toLowerCase()];
        if (!sev) return badSeverity('--fail-on', value);
        cmd.failOn = sev;
        break;
      }
      case '--severity-min': {
        const value = readValue();
        if (value === undefined) return missingValue('--severity-min');
        const sev = SEVERITIES[value.toLowerCase()];
        if (!sev) return badSeverity('--severity-min', value);
        cmd.severityMin = sev;
        break;
      }
      case '--format': {
        const value = readValue();
        if (value === undefined) return missingValue('--format');
        if (value !== 'text' && value !== 'json') {
          return { kind: 'usage-error', message: `--format takes text or json, not "${value}".` };
        }
        cmd.format = value;
        break;
      }
      case '--base': {
        const value = readValue();
        if (value === undefined) return missingValue('--base');
        // Belt to `--end-of-options`' braces (git.ts). `readValue` already
        // refuses a following token starting with `--`, but `--base=-x` is one
        // token and slips past it, and git reads a leading-dash rev as an
        // option.
        if (value.startsWith('-')) {
          return {
            kind: 'usage-error',
            message: `--base takes a git ref, not an option ("${value}").`,
          };
        }
        cmd.base = value;
        break;
      }
      case '--repo': {
        const value = readValue();
        if (value === undefined) return missingValue('--repo');
        const parts = value.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          return {
            kind: 'usage-error',
            message: `--repo takes owner/name, not "${value}".`,
          };
        }
        cmd.repo = value;
        break;
      }
      case '--pr': {
        const value = readValue();
        if (value === undefined) return missingValue('--pr');
        // `Number()` alone accepts "1e3", " 12 " and "0x1f"; a pull request
        // number is decimal digits and nothing else.
        if (!/^[0-9]+$/.test(value) || Number(value) < 1) {
          return {
            kind: 'usage-error',
            message: `--pr takes a pull request number, not "${value}".`,
          };
        }
        cmd.prNumber = Number(value);
        break;
      }
      case '--post-as': {
        const value = readValue();
        if (value === undefined) return missingValue('--post-as');
        if (!POST_AS.includes(value as PostAs)) {
          return {
            kind: 'usage-error',
            message: `--post-as takes ${POST_AS.join(', ')}, not "${value}".`,
          };
        }
        cmd.postAs = value as PostAs;
        break;
      }
      case '--ci-result': {
        const value = readValue();
        if (value === undefined) return missingValue('--ci-result');
        cmd.ciResult = value;
        break;
      }
      case '--api': {
        const value = readValue();
        if (value === undefined) return missingValue('--api');
        cmd.apiUrl = value.replace(/\/+$/, '');
        break;
      }
      default:
        return {
          kind: 'usage-error',
          message: `Unknown option "${name}". Run devdigest review --help to see the flags.`,
        };
    }
  }

  // A CI run needs both halves: `--repo` alone has nothing to post to, and
  // `--pr` alone has no repository to post it in.
  if ((cmd.repo === undefined) !== (cmd.prNumber === undefined)) {
    return {
      kind: 'usage-error',
      message: '--repo and --pr go together: both name the pull request the review is posted to.',
    };
  }
  if (cmd.postAs !== undefined && cmd.repo === undefined) {
    return {
      kind: 'usage-error',
      message: '--post-as only means something with --repo and --pr, which name where to post.',
    };
  }

  return cmd;
}

function missingValue(flag: string): Command {
  return { kind: 'usage-error', message: `${flag} needs a value.` };
}

function badSeverity(flag: string, value: string): Command {
  return {
    kind: 'usage-error',
    message: `${flag} takes critical, warning or suggestion, not "${value}".`,
  };
}
