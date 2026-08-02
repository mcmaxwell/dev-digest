/**
 * Purity rules for the review engine (see .claude/skills/onion-architecture/,
 * rule 7). reviewer-core is the domain core: diff + repo map → prompt → LLM →
 * grounded findings. It must not know about persistence, the filesystem, the
 * network, GitHub, or the server.
 *
 * Run: pnpm arch:check   (requires Node >= 22 — dependency-cruiser uses
 * `util.styleText`, which older Node versions do not export)
 */
module.exports = {
  forbidden: [
    {
      name: 'core-has-no-io',
      comment:
        'No filesystem, process, or network I/O in the domain core. Everything ' +
        'the engine needs is passed in; the only side effect is the injected ' +
        'LLMProvider.',
      severity: 'error',
      from: { path: '^src', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^(node:)?(fs|fs/promises|path|os|child_process|http|https|net|dns|worker_threads|cluster)$',
      },
    },
    {
      name: 'core-has-no-db-or-server',
      comment:
        'The engine never touches Drizzle, Postgres, Octokit/GitHub or the ' +
        'server package — those live behind ports on the server side.',
      severity: 'error',
      from: { path: '^src' },
      to: {
        path: '^(node_modules/)?(drizzle-orm|drizzle-kit|postgres|pg|octokit|@octokit|fastify|simple-git)',
      },
    },
    {
      name: 'vendor-sdks-confined-to-llm-adapters',
      comment:
        'The `openai` SDK is a concrete client. It is tolerated ONLY inside ' +
        'src/llm/ (the OpenRouter provider shared with the CI runner); the rest ' +
        'of the engine talks to the injected LLMProvider interface. Anything ' +
        'outside src/llm/ reaching for a vendor SDK is a purity violation.',
      severity: 'error',
      from: { path: '^src', pathNot: '^src/llm/' },
      to: { path: '^(node_modules/)?(openai|@anthropic-ai)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
