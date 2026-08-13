import {
  FACT_FILES,
  MAX_README_LINES,
  STACK_BY_MANIFEST,
} from './constants.js';
import type { DeterministicFacts, FactFile, RunScript } from './types.js';

/**
 * L06 — deterministic fact extraction. PURE: no I/O, no Container, no `node:fs`.
 * Everything here is a function of the `{ path, content }` records the service
 * read through the `GitClient` port.
 *
 * The one rule that shapes every function below: a BLANK or whitespace-only
 * content means the file is ABSENT, not empty. `MockGitClient.readFile`
 * resolves a missing path to `''` rather than rejecting (server/INSIGHTS.md), so
 * "it threw" is never the only failure shape a caller may check for.
 */

/** A file with no non-whitespace content did not exist. */
export function isPresent(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.trim().length > 0;
}

/**
 * Variable NAMES from a `.env.example`-shaped file — left-hand sides only, and
 * never a value (AC-7). A value in an example file is still a value: it is
 * routinely a real key someone pasted and then forgot to blank.
 */
export function envKeys(content: string): string[] {
  if (!isPresent(content)) return [];
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const lhs = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(lhs) && !out.includes(lhs)) out.push(lhs);
  }
  return out;
}

/** `scripts` from a `package.json`. Malformed JSON yields nothing, never a throw. */
export function packageScripts(content: string, source = 'package.json'): RunScript[] {
  if (!isPresent(content)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const scripts = (parsed as { scripts?: Record<string, unknown> })?.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  return Object.entries(scripts)
    .filter(([name, cmd]) => typeof cmd === 'string' && name.length > 0)
    .map(([name]) => ({ name, command: `npm run ${name}`, source }));
}

/**
 * Target names from a Makefile-shaped file. `.PHONY` and pattern rules are
 * dropped: neither is something a newcomer types.
 */
export function makeTargets(content: string, source = 'Makefile'): RunScript[] {
  if (!isPresent(content)) return [];
  const out: RunScript[] = [];
  for (const raw of content.split('\n')) {
    if (/^\s/.test(raw)) continue; // recipe line, not a target
    const m = raw.match(/^([A-Za-z0-9_.-]+)\s*:(?!=)/);
    const name = m?.[1];
    if (!name || name.startsWith('.') || name.includes('%')) continue;
    if (out.some((t) => t.name === name)) continue;
    out.push({ name, command: `make ${name}`, source });
  }
  return out;
}

/**
 * Service names from a compose file. A deliberate two-level indentation scan
 * rather than a YAML dependency: this needs the keys under `services:` and
 * nothing else, and a parser would be a new dependency for one list.
 */
export function composeServices(content: string): string[] {
  if (!isPresent(content)) return [];
  const out: string[] = [];
  let inServices = false;
  let indent: number | null = null;
  for (const raw of content.split('\n')) {
    if (raw.trim().length === 0 || raw.trim().startsWith('#')) continue;
    const leading = raw.length - raw.trimStart().length;
    if (!inServices) {
      if (/^services\s*:/.test(raw)) inServices = true;
      continue;
    }
    if (leading === 0) break; // back to a top-level key
    const m = raw.match(/^\s+([A-Za-z0-9_.-]+)\s*:/);
    if (!m?.[1]) continue;
    if (indent === null) indent = leading;
    if (leading !== indent) continue; // nested key of a service, not a service
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * What the repository says it is built with: one entry per manifest that
 * exists, plus the frameworks a `package.json` names outright. Derived from
 * declarations only — never from guessing at file extensions.
 */
export function declaredStack(files: FactFile[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    if (!isPresent(file.content)) continue;
    const stack = STACK_BY_MANIFEST[file.path];
    if (stack && !out.includes(stack)) out.push(stack);
  }
  const pkg = files.find((f) => f.path === 'package.json');
  if (pkg && isPresent(pkg.content)) {
    try {
      const parsed = JSON.parse(pkg.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = Object.keys({ ...parsed.dependencies, ...parsed.devDependencies });
      for (const dep of deps) {
        if (!/^[@a-z0-9][\w@/.-]*$/i.test(dep)) continue;
        if (!out.includes(dep)) out.push(dep);
      }
    } catch {
      // A manifest we cannot parse still counts as "Node.js" above.
    }
  }
  return out;
}

/** First `maxLines` lines of a prose file, or null when it is absent. */
export function proseExcerpt(content: string, maxLines = MAX_README_LINES): string | null {
  if (!isPresent(content)) return null;
  return content.split('\n').slice(0, maxLines).join('\n');
}

/**
 * The whole deterministic pass over the fixed fact-file list.
 *
 * Every extraction is per file and independent: a manifest that fails to parse
 * or a file that came back blank drops that ONE fact and nothing else, which is
 * what lets a generation continue on whatever facts it actually has.
 */
export function extractFacts(files: FactFile[]): DeterministicFacts {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  // Paths only. Keeping the CONTENT here would mean carrying `.env.example`'s
  // values around in a struct that gets logged, serialised and passed into
  // prompt assembly — see the doc comment on `DeterministicFacts.present`.
  const present = FACT_FILES.filter((p) => isPresent(byPath.get(p)));

  const keys: string[] = [];
  for (const path of ['.env.example', '.env.sample']) {
    for (const key of envKeys(byPath.get(path) ?? '')) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  const scripts: RunScript[] = [
    ...packageScripts(byPath.get('package.json') ?? ''),
    ...makeTargets(byPath.get('Makefile') ?? '', 'Makefile'),
    ...makeTargets(byPath.get('Justfile') ?? '', 'Justfile'),
    ...makeTargets(byPath.get('Taskfile.yml') ?? '', 'Taskfile.yml'),
  ];

  const services: string[] = [];
  for (const path of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    for (const name of composeServices(byPath.get(path) ?? '')) {
      if (!services.includes(name)) services.push(name);
    }
  }

  return {
    present: [...present],
    envKeys: keys,
    scripts,
    services,
    stack: declaredStack(files),
    readme: proseExcerpt(byPath.get('README.md') ?? ''),
    contributing: proseExcerpt(byPath.get('CONTRIBUTING.md') ?? ''),
  };
}
