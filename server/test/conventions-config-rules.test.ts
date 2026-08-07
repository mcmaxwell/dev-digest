import { describe, it, expect } from 'vitest';
import { deriveConfigRules } from '../src/modules/conventions/config-rules.js';
import { toSampleFile } from '../src/modules/conventions/sampling.js';

/**
 * The config stratum is the only source of candidates that involves no model at
 * all, so its evidence must be exact by construction — a wrong line number here
 * is a bug, not a model error.
 */
describe('conventions config rules (deterministic, no LLM)', () => {
  const sample = (path: string, content: string) => toSampleFile(path, 'config', content);

  it('derives strictness rules from tsconfig with the exact declaring line', () => {
    const tsconfig = sample(
      'tsconfig.json',
      `{
  "compilerOptions": {
    // strictness
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true
  }
}`,
    );

    const rules = deriveConfigRules([tsconfig]);
    const strict = rules.find((r) => r.rule.includes('`strict` mode'));

    expect(strict).toBeDefined();
    expect(strict!.origin).toBe('config');
    expect(strict!.confidence).toBe(1);
    expect(strict!.evidence).toHaveLength(1);
    expect(strict!.evidence[0]).toMatchObject({
      path: 'tsconfig.json',
      line: 4,
      verified: 'exact',
    });
    expect(strict!.evidence[0]!.snippet).toContain('"strict": true');

    expect(rules.map((r) => r.category)).toContain('imports'); // verbatimModuleSyntax
  });

  it('ignores tsconfig flags that are not enabled', () => {
    const rules = deriveConfigRules([
      sample('tsconfig.json', '{ "compilerOptions": { "strict": false } }'),
    ]);
    expect(rules).toEqual([]);
  });

  it('turns declared path aliases into an import rule', () => {
    const rules = deriveConfigRules([
      sample(
        'tsconfig.json',
        `{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}`,
      ),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.rule).toContain('@/*');
    expect(rules[0]!.category).toBe('imports');
  });

  it('reads ESM + engines out of package.json', () => {
    const rules = deriveConfigRules([
      sample(
        'package.json',
        `{
  "name": "api",
  "type": "module",
  "engines": { "node": ">=22" }
}`,
      ),
    ]);

    expect(rules.map((r) => r.rule)).toEqual([
      expect.stringContaining('ESM'),
      expect.stringContaining('>=22'),
    ]);
  });

  it('promotes ESLint error-level rules to conventions and caps the wall of them', () => {
    const many = Array.from({ length: 20 }, (_, i) => `      "rule-${i}": "error",`).join('\n');
    const rules = deriveConfigRules([
      sample('eslint.config.mjs', `export default [\n  {\n    rules: {\n${many}\n    }\n  }\n];`),
    ]);

    expect(rules.length).toBe(8); // capped — a lint dump would drown real findings
    expect(rules[0]!.rule).toContain('`rule-0`');
    expect(rules[0]!.evidence[0]!.verified).toBe('exact');
  });

  it('reports Prettier settings as one formatting rule', () => {
    const rules = deriveConfigRules([
      sample('.prettierrc', '{\n  "printWidth": 100,\n  "singleQuote": true\n}'),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.rule).toContain('max line width 100');
    expect(rules[0]!.rule).toContain('single quotes');
  });

  it('survives an unparseable config instead of failing the scan', () => {
    expect(deriveConfigRules([sample('tsconfig.json', '{ not json at all')])).toEqual([]);
  });
});
