import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Severity } from '@devdigest/shared';

/**
 * L09 — per-repo severity tuning.
 *
 * A repository may ship a `.devdigest/severity.json` that re-rates findings of
 * a given category, so a team can calibrate the reviewer to its own risk
 * appetite without editing prompts:
 *
 *   { "overrides": { "style": "SUGGESTION", "security": "CRITICAL" } }
 */

const CONFIG_DIR = '.devdigest';
const CONFIG_FILE = 'severity.json';

export interface SeverityOverrides {
  overrides: Record<string, Severity>;
}

export interface TuneResult<T> {
  findings: T[];
  /** Categories whose severity was changed, for the run log. */
  applied: string[];
}

function readOverrides(repoRoot: string): SeverityOverrides | null {
  const path = join(repoRoot, CONFIG_DIR, CONFIG_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SeverityOverrides;
  } catch {
    return null;
  }
}

export function tuneSeverities<T extends { severity: Severity; category: string }>(
  findings: T[],
  repoRoot: string,
): TuneResult<T> {
  const config = readOverrides(repoRoot);
  if (!config?.overrides) return { findings, applied: [] };

  const applied: string[] = [];
  const tuned = findings.map((finding) => {
    const next = config.overrides[finding.category];
    if (!next || next === finding.severity) return finding;
    applied.push(finding.category);
    return { ...finding, severity: next };
  });

  return { findings: tuned, applied };
}
