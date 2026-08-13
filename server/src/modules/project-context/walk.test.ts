/**
 * project-context — discovery walk unit tests.
 *
 * No DB, no git: builds a fixture tree with `mkdtemp` and asserts the filter
 * set (four roots only, EXCLUDED_DIRS, `.md` only, 256 KB skip, 500 cap,
 * category = first segment, symlinks not followed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { walkDocs } from './walk.js';
import { MAX_DOC_BYTES, MAX_DOCS } from './constants.js';

async function writeAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('walkDocs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-walk-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps only markdown under the four discovery roots, sorted by path', async () => {
    await writeAt(root, 'specs/public-api.md', '# API');
    await writeAt(root, 'docs/architecture.md', '# Arch');
    await writeAt(root, 'insights/incident.md', '# Incident');
    await writeAt(root, '.devdigest/rules.md', '# Rules');
    // Outside the roots, or not markdown — all absent.
    await writeAt(root, 'README.md', '# root readme');
    await writeAt(root, 'product/roadmap.md', '# roadmap');
    await writeAt(root, 'docs/diagram.png', 'binary-ish');
    await writeAt(root, 'src/docs/notes.md', '# nested elsewhere');

    const result = await walkDocs(root);
    expect(result.docs.map((d) => d.path)).toEqual([
      '.devdigest/rules.md',
      'docs/architecture.md',
      'insights/incident.md',
      'specs/public-api.md',
    ]);
    expect(result.skippedTooLarge).toBe(0);
    expect(result.bounded).toBe(0);
  });

  it('sets category to the first path segment', async () => {
    await writeAt(root, 'specs/api/v2/public.md', '# deep');
    await writeAt(root, '.devdigest/rules.md', '# rules');

    const result = await walkDocs(root);
    expect(result.docs.map((d) => [d.path, d.category])).toEqual([
      ['.devdigest/rules.md', '.devdigest'],
      ['specs/api/v2/public.md', 'specs'],
    ]);
  });

  it('excludes the indexer’s excluded directories', async () => {
    await writeAt(root, 'docs/node_modules/pkg/docs/api.md', '# vendored');
    await writeAt(root, 'docs/.git/hooks.md', '# git');
    await writeAt(root, 'docs/dist/build-notes.md', '# built');
    await writeAt(root, 'docs/real.md', '# real');

    const result = await walkDocs(root);
    expect(result.docs.map((d) => d.path)).toEqual(['docs/real.md']);
  });

  it('skips a document over 256 KB and counts it', async () => {
    await writeAt(root, 'docs/huge.md', 'x'.repeat(MAX_DOC_BYTES + 1));
    await writeAt(root, 'docs/edge.md', 'x'.repeat(MAX_DOC_BYTES));
    await writeAt(root, 'docs/small.md', '# small');

    const result = await walkDocs(root);
    expect(result.docs.map((d) => d.path)).toEqual(['docs/edge.md', 'docs/small.md']);
    expect(result.skippedTooLarge).toBe(1);
  });

  it('bounds the set at 500 in path order and reports the remainder', async () => {
    const total = MAX_DOCS + 3;
    for (let i = 0; i < total; i += 1) {
      await writeAt(root, `docs/${String(i).padStart(4, '0')}.md`, `# doc ${i}`);
    }

    const result = await walkDocs(root);
    expect(result.docs).toHaveLength(MAX_DOCS);
    expect(result.bounded).toBe(3);
    expect(result.docs[0]!.path).toBe('docs/0000.md');
    expect(result.docs[MAX_DOCS - 1]!.path).toBe(`docs/${String(MAX_DOCS - 1).padStart(4, '0')}.md`);
  });

  it('never follows a symlink, neither a file nor a discovery root', async () => {
    await writeAt(root, 'outside/secret.md', '# secret');
    await writeAt(root, 'docs/real.md', '# real');
    await symlink(join(root, 'outside/secret.md'), join(root, 'docs/link.md'));
    await symlink(join(root, 'outside'), join(root, 'specs'));

    const result = await walkDocs(root);
    expect(result.docs.map((d) => d.path)).toEqual(['docs/real.md']);
  });

  it('records size and an approxTokens estimate per document', async () => {
    await writeAt(root, 'docs/a.md', 'x'.repeat(400));

    const result = await walkDocs(root);
    expect(result.docs[0]).toMatchObject({
      path: 'docs/a.md',
      sizeBytes: 400,
      tokens: 100, // ceil(400 / 4)
    });
  });

  it('returns an empty set for a clone with no discovery roots', async () => {
    await writeAt(root, 'src/index.ts', 'export {}');

    const result = await walkDocs(root);
    expect(result).toEqual({ docs: [], skippedTooLarge: 0, bounded: 0 });
  });
});
