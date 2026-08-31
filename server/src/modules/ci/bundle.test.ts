import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import {
  buildBundle,
  slugify,
  uniqueSlugs,
  MAX_BUNDLE_BYTES,
  type BundleAgent,
  type BundleOptions,
  type BundleSkill,
} from './bundle.js';

/**
 * Hermetic - `buildBundle` is pure, so there is no container, no clock and no
 * database here, and deliberately no `*.it.test.ts` counterpart.
 */

const agent: BundleAgent = {
  name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  system_prompt: 'Flag secrets, injection and SSRF.\nCite a file and a line.',
  strategy: 'single-pass',
  ci_fail_on: 'critical',
};

const options: BundleOptions = {
  target: 'gha',
  triggers: ['opened', 'synchronize'],
  post_as: 'github_review',
};

const skill = (over: Partial<BundleSkill> = {}): BundleSkill => ({
  name: 'Secret Leakage Gate',
  body: '# Secret leakage\n\nNever pass a token through a query string.',
  enabled: true,
  ...over,
});

const at = <T extends { path: string }>(files: T[], path: string) =>
  files.find((f) => f.path === path);
const manifestOf = (files: { path: string; contents: string }[]) =>
  AgentManifest.parse(YAML.parse(at(files, '.devdigest/agents/security-reviewer.yaml')!.contents));

describe('slugify', () => {
  it('reduces a display name to a path-safe slug', () => {
    expect(slugify('Secret Leakage Gate', 'skill')).toBe('secret-leakage-gate');
  });

  it('cannot emit a path traversal, a separator or a null byte', () => {
    for (const hostile of ['../../etc/passwd', '/absolute', 'a/b\\c', 'nul byte', '..']) {
      const slug = slugify(hostile, 'skill');
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug).not.toContain('..');
    }
  });

  it('falls back when a name has no slug-able characters', () => {
    expect(slugify('EMOJIONLY', 'skill')).toBe('emojionly');
    expect(slugify('   ', 'agent')).toBe('agent');
    expect(slugify('!!! ???', 'skill')).toBe('skill');
  });
});

describe('uniqueSlugs', () => {
  it('disambiguates names that collapse to the same slug', () => {
    expect(uniqueSlugs(['Secret Leakage Gate', 'secret-leakage gate', 'Other'], 'skill')).toEqual([
      'secret-leakage-gate',
      'secret-leakage-gate-2',
      'other',
    ]);
  });
});

describe('buildBundle', () => {
  it('emits the workflow, the manifest and one file per enabled skill (AC-10)', () => {
    const files = buildBundle(agent, [skill()], options);
    expect(files.map((f) => f.path)).toEqual([
      '.github/workflows/devdigest-review.yml',
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/secret-leakage-gate.md',
    ]);
  });

  it('carries the agent record into the manifest without substituting defaults (AC-11)', () => {
    const files = buildBundle(
      { ...agent, provider: 'anthropic', strategy: 'map-reduce', ci_fail_on: 'any' },
      [],
      options,
    );
    expect(manifestOf(files)).toMatchObject({
      name: 'Security Reviewer',
      provider: 'anthropic',
      model: 'gpt-4.1',
      system_prompt: agent.system_prompt,
      strategy: 'map-reduce',
      ci_fail_on: 'any',
    });
  });

  it('lists skill slugs in link order and emits a file for each (AC-12)', () => {
    const files = buildBundle(
      agent,
      [skill(), skill({ name: 'Lethal Trifecta', body: '# Trifecta' })],
      options,
    );
    expect(manifestOf(files).skills).toEqual(['secret-leakage-gate', 'lethal-trifecta']);
    expect(at(files, '.devdigest/skills/lethal-trifecta.md')?.contents).toBe('# Trifecta');
  });

  it('excludes a disabled skill from both the manifest and the files (AC-13)', () => {
    const files = buildBundle(
      agent,
      [skill(), skill({ name: 'Disabled One', enabled: false })],
      options,
    );
    expect(manifestOf(files).skills).toEqual(['secret-leakage-gate']);
    expect(at(files, '.devdigest/skills/disabled-one.md')).toBeUndefined();
  });

  it('copies a skill body verbatim, including an empty one', () => {
    const files = buildBundle(agent, [skill({ body: '' })], options);
    expect(at(files, '.devdigest/skills/secret-leakage-gate.md')?.contents).toBe('');
  });

  it('produces a manifest that parses against AgentManifest (AC-14)', () => {
    expect(() => manifestOf(buildBundle(agent, [skill()], options))).not.toThrow();
  });

  it('is deterministic across two identical calls (AC-15)', () => {
    expect(buildBundle(agent, [skill()], options)).toEqual(buildBundle(agent, [skill()], options));
  });

  it('emits triggers in canonical order regardless of request order (AC-16)', () => {
    const files = buildBundle(agent, [], {
      ...options,
      triggers: ['reopened', 'synchronize', 'opened'],
    });
    expect(at(files, '.github/workflows/devdigest-review.yml')?.contents).toContain(
      'types: [opened, synchronize, reopened]',
    );
  });

  it('marks the review step as a placeholder that does not run a review (AC-17)', () => {
    const wf = at(buildBundle(agent, [], options), '.github/workflows/devdigest-review.yml')!;
    expect(wf.contents).toContain('PLACEHOLDER');
    expect(wf.contents).toContain('no runner is configured');
  });

  it('leaves the GitHub token as an Actions expression, not an interpolated value', () => {
    const wf = at(buildBundle(agent, [], options), '.github/workflows/devdigest-review.yml')!;
    expect(wf.contents).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
  });

  it('exports an agent with no skills as two files with an empty skills list (AC-18)', () => {
    const files = buildBundle(agent, [], options);
    expect(files).toHaveLength(2);
    expect(manifestOf(files).skills).toEqual([]);
  });

  it('rejects a target other than GitHub Actions with a 400 (AC-6)', () => {
    expect(() => buildBundle(agent, [], { ...options, target: 'circle' })).toThrowError(
      /Only GitHub Actions/,
    );
  });

  it('refuses a bundle over the size limit', () => {
    const huge = skill({ body: 'x'.repeat(MAX_BUNDLE_BYTES + 1) });
    expect(() => buildBundle(agent, [huge], options)).toThrowError(/over the/);
  });

  describe('a system prompt is untrusted text', () => {
    const cases: [string, string][] = [
      ['a YAML document break', 'before\n---\nowned: true\n...\nafter'],
      ['an indented first line', '   indented first\nthen not'],
      ['trailing blank lines', 'ends with blanks\n\n\n'],
      ['a tab', '\tstarts with a tab'],
      ['a carriage return', 'has\r\ncrlf'],
      ['quotes and colons', 'he said "run: rm -rf /" and left'],
      ['an empty prompt', ''],
    ];

    it.each(cases)('round-trips %s without changing the prompt', (_label, prompt) => {
      const files = buildBundle({ ...agent, system_prompt: prompt }, [], options);
      expect(manifestOf(files).system_prompt).toBe(prompt);
    });

    it('never lets prompt content escape the manifest into another key', () => {
      const files = buildBundle(
        { ...agent, system_prompt: 'x\nci_fail_on: never\nmodel: evil' },
        [],
        options,
      );
      const manifest = manifestOf(files);
      expect(manifest.ci_fail_on).toBe('critical');
      expect(manifest.model).toBe('gpt-4.1');
    });
  });
});
