/**
 * project-context — path validation table tests. Pure, no I/O.
 *
 * These are the checks that stand between a client-supplied string and a
 * `readFile` on the clone (AC-47, AC-48), so the rejection list is the point.
 */
import { describe, it, expect } from 'vitest';
import { normalizeDocPath, isInsideRoot } from './paths.js';

describe('normalizeDocPath', () => {
  const accepted = [
    'specs/public-api.md',
    'docs/architecture.md',
    'insights/incident-2026-04-checkout.md',
    '.devdigest/rules.md',
    'specs/api/v2/public.md',
    'docs/UPPER.MD',
  ];
  for (const path of accepted) {
    it(`accepts ${path}`, () => {
      expect(normalizeDocPath(path)).toBe(path);
    });
  }

  const rejected: Array<[string, string]> = [
    ['a traversal segment', 'specs/../../../etc/passwd'],
    ['a trailing traversal', 'specs/..'],
    ['a leading traversal', '../specs/public-api.md'],
    ['a single-dot segment', 'specs/./public-api.md'],
    ['an absolute path', '/etc/passwd'],
    ['an absolute path inside a root', '/specs/public-api.md'],
    ['a windows drive', 'C:/specs/public-api.md'],
    ['a backslash', 'specs\\public-api.md'],
    ['a NUL byte', 'specs/public-api.md\0.png'],
    ['a root-level dotfile', '.env'],
    ['a dotfile under no root', '.git/config'],
    ['a path outside the four roots', 'product/roadmap.md'],
    ['a repository README', 'README.md'],
    ['a non-markdown file inside a root', 'specs/public-api.yaml'],
    ['a single segment', 'specs'],
    ['an empty segment', 'specs//public-api.md'],
    ['an empty string', ''],
    ['a bare extension', 'specs/.md'],
  ];
  for (const [why, path] of rejected) {
    it(`rejects ${why}: ${JSON.stringify(path)}`, () => {
      expect(normalizeDocPath(path)).toBeNull();
    });
  }
});

describe('isInsideRoot', () => {
  it('accepts a path that resolves inside the root', () => {
    expect(isInsideRoot('/clones/acme', 'specs/public-api.md')).toBe(true);
    expect(isInsideRoot('/clones/acme/', 'docs/a/b.md')).toBe(true);
  });

  it('rejects an escape, an absolute path and the root itself', () => {
    expect(isInsideRoot('/clones/acme', '../other/secret.md')).toBe(false);
    expect(isInsideRoot('/clones/acme', 'specs/../../other/secret.md')).toBe(false);
    expect(isInsideRoot('/clones/acme', '/etc/passwd')).toBe(false);
    expect(isInsideRoot('/clones/acme', '')).toBe(false);
  });

  it('rejects a sibling directory sharing the root’s prefix', () => {
    expect(isInsideRoot('/clones/acme', '../acme-evil/secret.md')).toBe(false);
  });
});
