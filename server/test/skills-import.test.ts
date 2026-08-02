import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillImport } from '../src/modules/skills/helpers.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * L02 — the import parser: markdown core extraction from .md / .zip uploads.
 * Pure unit tests; the security property under test is that non-markdown
 * archive entries are only ever LISTED (skipped_entries), never parsed.
 */

const MD_WITH_FRONTMATTER = `---
name: flaky-test-patterns
description: Flag flaky test patterns.
type: convention
---

# Flaky test patterns

Scan added tests for real timers and unseeded randomness.
`;

const MD_PLAIN = `# Secret scanning rules

Flag credential-shaped literals in added lines.

- sk_live_ prefixes
`;

describe('parseSkillImport — markdown', () => {
  it('reads name/description/type from frontmatter and strips it from the body', () => {
    const out = parseSkillImport('anything.md', strToU8(MD_WITH_FRONTMATTER));
    expect(out.name).toBe('flaky-test-patterns');
    expect(out.description).toBe('Flag flaky test patterns.');
    expect(out.type).toBe('convention');
    expect(out.body.startsWith('# Flaky test patterns')).toBe(true);
    expect(out.body).not.toContain('---');
    expect(out.skippedEntries).toEqual([]);
  });

  it('derives name from the first heading and description from the first paragraph', () => {
    const out = parseSkillImport('rules.md', strToU8(MD_PLAIN));
    expect(out.name).toBe('Secret scanning rules');
    expect(out.description).toBe('Flag credential-shaped literals in added lines.');
    expect(out.type).toBeNull();
  });

  it('flags an unknown frontmatter type as a warning instead of failing', () => {
    const md = `---\ntype: no-such-type\n---\n# X\nbody`;
    const out = parseSkillImport('x.md', strToU8(md));
    expect(out.type).toBeNull();
    expect(out.warnings.some((w) => w.includes('no-such-type'))).toBe(true);
  });

  it('rejects unsupported extensions and empty markdown', () => {
    expect(() => parseSkillImport('skill.sh', strToU8('#!/bin/sh'))).toThrow(ValidationError);
    expect(() => parseSkillImport('empty.md', strToU8('  \n'))).toThrow(ValidationError);
  });
});

describe('parseSkillImport — zip archives', () => {
  it('extracts SKILL.md and lists every other entry as skipped (never parsed)', () => {
    const zip = zipSync({
      'SKILL.md': strToU8(MD_WITH_FRONTMATTER),
      'install.sh': strToU8('echo pwned'),
      'bin/tool': strToU8('\x7fELF'),
    });
    const out = parseSkillImport('skill-pack.zip', zip);
    expect(out.name).toBe('flaky-test-patterns');
    expect(out.skippedEntries.sort()).toEqual(['bin/tool', 'install.sh']);
    // the executable content must not leak into anything we extracted
    expect(out.body).not.toContain('pwned');
    expect(out.warnings.some((w) => w.includes('never read or executed'))).toBe(true);
  });

  it('prefers SKILL.md over other markdown files, warning about the rest', () => {
    const zip = zipSync({
      'README.md': strToU8('# Readme\nnot the skill'),
      'nested/SKILL.md': strToU8(MD_PLAIN),
    });
    const out = parseSkillImport('pack.zip', zip);
    expect(out.name).toBe('Secret scanning rules');
    expect(out.skippedEntries).toEqual(['README.md']);
    expect(out.warnings.some((w) => w.includes('2 markdown files'))).toBe(true);
  });

  it('rejects an archive with no markdown file', () => {
    const zip = zipSync({ 'run.sh': strToU8('echo hi') });
    expect(() => parseSkillImport('pack.zip', zip)).toThrow(ValidationError);
  });

  it('rejects a corrupt archive cleanly', () => {
    expect(() => parseSkillImport('bad.zip', strToU8('this is not a zip'))).toThrow(
      ValidationError,
    );
  });

  it('never inflates entries beyond the byte budget (zip-bomb guard)', () => {
    // 20MB of zeros deflates to ~20KB — a compliant upload that would expand
    // far past IMPORT_MAX_FILE_BYTES if entries were decompressed eagerly.
    const bomb = new Uint8Array(20 * 1024 * 1024);
    const zip = zipSync({ 'BOMB.md': bomb, 'SKILL.md': strToU8(MD_PLAIN) });
    const out = parseSkillImport('pack.zip', zip);
    // the in-budget SKILL.md is used; the oversized entry is only LISTED
    expect(out.name).toBe('Secret scanning rules');
    expect(out.skippedEntries).toContain('BOMB.md');
  });
});
