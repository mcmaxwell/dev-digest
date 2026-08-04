import type { ConventionCategory } from '@devdigest/shared';
import type { DraftCandidate, SampleFile } from './types.js';
import { ruleKeyFor } from './dedupe.js';

/**
 * Deterministic convention candidates — derived from the project's own config
 * files with NO model involved.
 *
 * Two reasons this stage exists:
 *  1. These rules are unhallucinatable. The evidence is the exact config line
 *     that declares them, so they are grounded before verification even runs.
 *  2. They keep the results non-empty when every LLM call fails (no key, rate
 *     limit, bad JSON) — a scan that surfaces "ESLint enforces X as an error"
 *     is still useful, and the page never renders as "no conventions found"
 *     when the truth is "the model call broke".
 *
 * Everything here is PURE: config text in, candidates out.
 */

/** Locate the 1-based line of the first occurrence of `needle` in `text`. */
function lineOf(text: string, needle: string): number | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.includes(needle)) return i + 1;
  }
  return null;
}

function candidate(
  file: SampleFile,
  needle: string,
  category: ConventionCategory,
  rule: string,
  rationale: string,
): DraftCandidate | null {
  const line = lineOf(file.content, needle);
  if (line === null) return null;
  const snippet = file.content.split('\n')[line - 1]!.trim();
  return {
    category,
    rule,
    rationale,
    evidence: [{ path: file.path, line, snippet, verified: 'exact' }],
    confidence: 1,
    origin: 'config',
    ruleKey: ruleKeyFor(rule),
  };
}

/** Strip `//` and `/* *​/` comments so JSON.parse survives tsconfig/jsonc files. */
function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

function parseJsonish(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(text));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** tsconfig compiler flags that describe how the project expects code to be written. */
const TSCONFIG_FLAGS: Array<{
  key: string;
  category: ConventionCategory;
  rule: string;
  rationale: string;
}> = [
  {
    key: 'strict',
    category: 'types',
    rule: 'TypeScript runs in `strict` mode — no implicit `any`, no unchecked `null`/`undefined`.',
    rationale: 'tsconfig declares strict mode, so loosely-typed code will not compile.',
  },
  {
    key: 'noUncheckedIndexedAccess',
    category: 'types',
    rule: 'Indexed access is unchecked-safe: `arr[i]` is `T | undefined` and must be narrowed before use.',
    rationale: '`noUncheckedIndexedAccess` is on, so an unguarded index read is a type error.',
  },
  {
    key: 'exactOptionalPropertyTypes',
    category: 'types',
    rule: 'Optional properties are exact — omit the key instead of assigning `undefined`.',
    rationale: '`exactOptionalPropertyTypes` rejects `{ x: undefined }` where `x?: T`.',
  },
  {
    key: 'verbatimModuleSyntax',
    category: 'imports',
    rule: 'Type-only imports use `import type` — value and type imports are never mixed.',
    rationale: '`verbatimModuleSyntax` preserves import statements verbatim in the emit.',
  },
  {
    key: 'noImplicitOverride',
    category: 'types',
    rule: 'Overriding a base-class member requires the explicit `override` keyword.',
    rationale: '`noImplicitOverride` is enabled in tsconfig.',
  },
];

function fromTsconfig(file: SampleFile): DraftCandidate[] {
  const json = parseJsonish(file.content);
  const opts = (json?.compilerOptions ?? {}) as Record<string, unknown>;
  const out: DraftCandidate[] = [];

  for (const flag of TSCONFIG_FLAGS) {
    if (opts[flag.key] !== true) continue;
    const c = candidate(file, `"${flag.key}"`, flag.category, flag.rule, flag.rationale);
    if (c) out.push(c);
  }

  const paths = opts.paths as Record<string, unknown> | undefined;
  if (paths && Object.keys(paths).length > 0) {
    const aliases = Object.keys(paths).slice(0, 6).join('`, `');
    const c = candidate(
      file,
      '"paths"',
      'imports',
      `Cross-folder imports use the configured path aliases (\`${aliases}\`), not deep relative chains.`,
      'tsconfig declares path aliases; relative `../../..` imports bypass them.',
    );
    if (c) out.push(c);
  }
  return out;
}

/** package.json facts that constrain how code is written. */
function fromPackageJson(file: SampleFile): DraftCandidate[] {
  const json = parseJsonish(file.content);
  if (!json) return [];
  const out: DraftCandidate[] = [];

  if (json.type === 'module') {
    const c = candidate(
      file,
      '"type"',
      'imports',
      'The package is ESM (`"type": "module"`) — use `import`/`export`, and keep the `.js` extension on relative specifiers.',
      'CommonJS `require` and extensionless relative imports fail at runtime in an ESM package.',
    );
    if (c) out.push(c);
  }

  const engines = json.engines as Record<string, unknown> | undefined;
  if (engines?.node) {
    const c = candidate(
      file,
      '"node"',
      'config',
      `Target Node ${String(engines.node)} — do not use APIs newer than that range.`,
      'package.json pins the supported Node range in `engines`.',
    );
    if (c) out.push(c);
  }
  return out;
}

/** Prettier settings, which are formatting conventions by definition. */
function fromPrettier(file: SampleFile): DraftCandidate[] {
  const json = parseJsonish(file.content);
  if (!json) return [];
  const out: DraftCandidate[] = [];
  const bits: string[] = [];
  if (typeof json.printWidth === 'number') bits.push(`max line width ${json.printWidth}`);
  if (json.singleQuote === true) bits.push('single quotes');
  if (json.semi === false) bits.push('no semicolons');
  if (typeof json.trailingComma === 'string') bits.push(`trailing commas: ${json.trailingComma}`);
  if (bits.length === 0) return out;

  const c = candidate(
    file,
    Object.keys(json)[0] ? `"${Object.keys(json)[0]}"` : '{',
    'structure',
    `Formatting follows Prettier: ${bits.join(', ')}.`,
    'Declared in the project’s Prettier config, so diverging code fails the format check.',
  );
  if (c) out.push(c);
  return out;
}

/**
 * ESLint rules the project set to `"error"`. A rule the team promoted to an
 * error IS a house rule — this is the highest-signal, lowest-cost source of
 * conventions in any JS/TS repo, and it needs no model at all.
 *
 * Text-scanned rather than parsed: flat configs are JS modules, so the only
 * portable read is the source itself.
 */
const ESLINT_RULE_RE = /['"]([@a-z0-9][\w@/-]*)['"]\s*:\s*(?:\[\s*)?['"]error['"]/gi;

function fromEslint(file: SampleFile): DraftCandidate[] {
  const out: DraftCandidate[] = [];
  const seen = new Set<string>();
  for (const m of file.content.matchAll(ESLINT_RULE_RE)) {
    const ruleName = m[1]!;
    if (seen.has(ruleName)) continue;
    seen.add(ruleName);
    const c = candidate(
      file,
      m[0],
      ruleName.includes('import') ? 'imports' : 'structure',
      `ESLint enforces \`${ruleName}\` as an error — code violating it does not pass lint.`,
      'The project promoted this lint rule to an error, making it a hard house rule.',
    );
    if (c) out.push(c);
    if (out.length >= 8) break; // a wall of lint rules drowns the real findings
  }
  return out;
}

/** Derive every deterministic candidate available from the config stratum. */
export function deriveConfigRules(configFiles: SampleFile[]): DraftCandidate[] {
  const out: DraftCandidate[] = [];
  for (const file of configFiles) {
    const name = file.path.split('/').pop() ?? file.path;
    if (name.startsWith('tsconfig')) out.push(...fromTsconfig(file));
    else if (name === 'package.json') out.push(...fromPackageJson(file));
    else if (name.includes('prettier')) out.push(...fromPrettier(file));
    else if (name.includes('eslint')) out.push(...fromEslint(file));
  }
  return out;
}
