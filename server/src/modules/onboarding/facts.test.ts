import { describe, it, expect } from 'vitest';
import {
  composeServices,
  declaredStack,
  envKeys,
  extractFacts,
  makeTargets,
  packageScripts,
} from './facts.js';
import type { FactFile } from './types.js';

/**
 * L06 — the deterministic fact pass, against the spec's own criteria.
 *
 *   AC-6  the declared stack, the runnable scripts, the container composition
 *         and the environment-variable names come from the clone's manifests,
 *         task-runner files, compose files and `.env.example`, and each run
 *         step cites the file it was taken from.
 *   AC-7  `.env.example` yields variable NAMES and no `.env` value is ever read.
 *
 * Plus the spec's "a read that fails drops that one fact; generation continues
 * with the facts it has" rule, which for `MockGitClient` means a BLANK read, not
 * a thrown one.
 */

const ENV_EXAMPLE = [
  '# Copy to .env and fill in',
  'DATABASE_URL=postgres://user:hunter2@localhost/db',
  '',
  'export STRIPE_SECRET_KEY=sk_live_EXAMPLE_NOT_A_REAL_KEY',
  'NOT_A_LINE',
  '=novalue',
  'PORT=3000',
].join('\n');

/** Every VALUE the example env file holds. None may survive into the facts. */
const ENV_VALUES = [
  'postgres://user:hunter2@localhost/db',
  'hunter2',
  'sk_live_EXAMPLE_NOT_A_REAL_KEY',
];

const PACKAGE_JSON = JSON.stringify({
  name: 'payments-api',
  scripts: { dev: 'tsx watch src/server.ts', test: 'vitest run', broken: 42 },
  dependencies: { fastify: '^5.0.0' },
  devDependencies: { vitest: '^2.0.0' },
});

const MAKEFILE = [
  '.PHONY: all',
  'VAR := 1',
  'up:',
  '\tdocker compose up -d',
  'seed: up',
  '\tpnpm db:seed',
  '%.o: %.c',
  '\tcc -c $<',
].join('\n');

const COMPOSE = [
  'version: "3.9"',
  'services:',
  '  postgres:',
  '    image: pgvector/pgvector:pg16',
  '    ports:',
  '      - 5432:5432',
  '  redis:',
  '    image: redis:7',
  'volumes:',
  '  pgdata:',
].join('\n');

describe('L06 facts — environment variables (AC-7)', () => {
  it('reads variable NAMES from an example env file and never a value', () => {
    const keys = envKeys(ENV_EXAMPLE);

    expect(keys).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY', 'PORT']);
    for (const value of ENV_VALUES) {
      expect(keys.join('\n')).not.toContain(value);
    }
  });

  it('carries no value from the example env file anywhere in the collected facts', () => {
    // The whole struct is what gets logged, serialised and handed to prompt
    // assembly, so the guarantee has to hold over the WHOLE struct, not just
    // over the field that was meant to hold names.
    const facts = extractFacts([
      { path: 'package.json', content: PACKAGE_JSON },
      { path: '.env.example', content: ENV_EXAMPLE },
      { path: 'README.md', content: '# payments-api' },
    ]);

    expect(facts.envKeys).toContain('STRIPE_SECRET_KEY');
    const serialised = JSON.stringify(facts);
    for (const value of ENV_VALUES) {
      expect(serialised).not.toContain(value);
    }
  });

  it('never reads a `.env` file: it is not among the files the pass collects', async () => {
    const { FACT_FILES } = await import('./constants.js');
    expect(FACT_FILES).toContain('.env.example');
    expect(FACT_FILES).not.toContain('.env');
    expect(FACT_FILES.filter((p) => /^\.env(\.local|\.production)?$/.test(p))).toEqual([]);
  });
});

describe('L06 facts — runnable commands and their source (AC-6)', () => {
  it('takes every command from a named file and reports that file as its source', () => {
    const scripts = packageScripts(PACKAGE_JSON);
    expect(scripts).toEqual([
      { name: 'dev', command: 'npm run dev', source: 'package.json' },
      { name: 'test', command: 'npm run test', source: 'package.json' },
    ]);

    const targets = makeTargets(MAKEFILE, 'Makefile');
    expect(targets.map((t) => t.name)).toEqual(['up', 'seed']);
    expect(targets.every((t) => t.source === 'Makefile')).toBe(true);
  });

  it('keeps two identical commands distinguishable by the manifest they came from', () => {
    // The spec's monorepo case: two `dev` scripts from different manifests are
    // only telling apart by their cited source.
    const api = packageScripts(PACKAGE_JSON, 'services/api/package.json');
    const web = packageScripts(PACKAGE_JSON, 'services/web/package.json');

    expect(api[0]).toMatchObject({ command: 'npm run dev', source: 'services/api/package.json' });
    expect(web[0]).toMatchObject({ command: 'npm run dev', source: 'services/web/package.json' });
  });

  it('collects the declared stack and the container composition', () => {
    const files: FactFile[] = [
      { path: 'package.json', content: PACKAGE_JSON },
      { path: 'go.mod', content: 'module example.com/x' },
    ];
    expect(declaredStack(files)).toEqual(expect.arrayContaining(['Node.js', 'Go', 'fastify']));

    expect(composeServices(COMPOSE)).toEqual(['postgres', 'redis']);
  });

  it('collects scripts, services, stack and prose in one pass over the fixed file list', () => {
    const facts = extractFacts([
      { path: 'package.json', content: PACKAGE_JSON },
      { path: 'Makefile', content: MAKEFILE },
      { path: 'docker-compose.yml', content: COMPOSE },
      { path: '.env.example', content: ENV_EXAMPLE },
      { path: 'README.md', content: '# payments-api\n\nRate-limited public API.' },
    ]);

    expect(facts.scripts.map((s) => `${s.command}|${s.source}`)).toEqual([
      'npm run dev|package.json',
      'npm run test|package.json',
      'make up|Makefile',
      'make seed|Makefile',
    ]);
    expect(facts.services).toEqual(['postgres', 'redis']);
    expect(facts.stack).toContain('Node.js');
    expect(facts.readme).toContain('Rate-limited public API.');
    expect(facts.present).toEqual([
      'package.json',
      'Makefile',
      'docker-compose.yml',
      '.env.example',
      'README.md',
    ]);
  });
});

describe('L06 facts — a fact that cannot be read drops only itself', () => {
  it('treats a blank read as an absent file and keeps every other fact', () => {
    // `MockGitClient.readFile` resolves a MISSING path to '' rather than
    // rejecting, so "blank" is the shape a missing file actually arrives in.
    const facts = extractFacts([
      { path: 'package.json', content: '   \n\n' },
      { path: 'Makefile', content: MAKEFILE },
      { path: 'README.md', content: '' },
    ]);

    expect(facts.present).toEqual(['Makefile']);
    expect(facts.scripts.map((s) => s.source)).toEqual(['Makefile', 'Makefile']);
    expect(facts.stack).not.toContain('Node.js');
    expect(facts.readme).toBeNull();
  });

  it('drops one unparseable manifest without losing the rest of the pass', () => {
    const facts = extractFacts([
      { path: 'package.json', content: '{ "scripts": { "dev": ' },
      { path: 'Makefile', content: MAKEFILE },
    ]);

    // No scripts from the broken manifest, but the file still declares Node.js
    // and the Makefile's targets survive untouched.
    expect(facts.scripts.filter((s) => s.source === 'package.json')).toEqual([]);
    expect(facts.scripts.map((s) => s.name)).toEqual(['up', 'seed']);
    expect(facts.stack).toContain('Node.js');
  });

  it('renders no run steps at all when there is no manifest and no task runner', () => {
    // The spec's "No package manifest and no task runner" edge case: the
    // section is empty, not absent — which is `skeleton.ts`'s job, and this is
    // the fact half of it.
    const facts = extractFacts([{ path: 'README.md', content: '# just prose' }]);
    expect(facts.scripts).toEqual([]);
    expect(facts.services).toEqual([]);
    expect(facts.stack).toEqual([]);
  });
});
