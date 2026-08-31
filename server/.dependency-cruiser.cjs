/**
 * Onion-architecture layer rules (see .claude/skills/onion-architecture/).
 * Run: pnpm arch:check   (requires Node >= 22 — dependency-cruiser uses
 * `util.styleText`, which older Node versions do not export)
 */
module.exports = {
  forbidden: [
    {
      name: 'routes-are-transport-only',
      comment:
        'routes.ts is a driving adapter: zod schemas + one service call. It must ' +
        'not know table definitions at all — persistence goes through the module ' +
        'repository, cross-module reads through a Container getter.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^(node_modules/)?drizzle-orm|^src/db' },
    },
    {
      name: 'eval-scoring-is-pure',
      comment:
        'L06: the eval scorer decides whether a finding matches an expectation ' +
        'by comparing a file and two line numbers. The claim that scoring makes ' +
        'no model call is the point of the whole harness, so it is enforced ' +
        'mechanically rather than trusted: scoring.ts may not reach the ' +
        'container, an adapter, the database, or the review engine. If a metric ' +
        'genuinely needs one of those, it is not a scoring rule - it belongs in ' +
        'the service, which already has them.',
      severity: 'error',
      from: { path: '^src/modules/eval/scoring\\.ts$' },
      to: { path: '^src/(platform|adapters|db)/|^\\.\\./reviewer-core|^(node_modules/)?drizzle-orm' },
    },
    {
      name: 'multi-agent-clustering-is-pure',
      comment:
        'L07: the multi-agent comparison groups findings that already exist by ' +
        'file and line range. "The clustering makes no model call" is the ' +
        'central claim of the whole disagreement section, so it is enforced ' +
        'mechanically rather than trusted: multi-agent.ts may not reach the ' +
        'container, an adapter, the database, or the review engine. If a rule ' +
        'genuinely needs one of those, it is not a comparison rule - it belongs ' +
        'in the service, which already has them.',
      severity: 'error',
      from: { path: '^src/modules/reviews/multi-agent\\.ts$' },
      to: { path: '^src/(platform|adapters|db)/|^\\.\\./reviewer-core|^(node_modules/)?drizzle-orm' },
    },
    {
      name: 'queries-live-in-repositories',
      comment:
        'Only a repository builds queries. Any other module file importing the ' +
        'drizzle query builder means persistence leaked into the application ' +
        'layer. Importing db/schema for ROW TYPES stays fine — this rule targets ' +
        'the query builder itself.',
      severity: 'error',
      from: {
        path: '^src/modules/',
        pathNot: '(/repository\\.ts$|/repository/|\\.test\\.ts$)',
      },
      to: { path: '^(node_modules/)?drizzle-orm' },
    },
    {
      name: 'no-cross-module-imports',
      comment:
        'One module must not reach into another module\'s folder. Share through ' +
        'modules/_shared/, the Zod contracts in vendor/shared, or a Container ' +
        'getter. EXCEPTION: a module may construct another module\'s SERVICE ' +
        '(polling → pulls/service) — that is a documented composition seam.',
      severity: 'error',
      from: {
        path: '^src/modules/([^/]+)/',
        pathNot: '\\.test\\.ts$',
      },
      to: {
        path: '^src/modules/',
        // `$1` back-references the module name captured in `from.path`, so a
        // module importing its OWN files never trips this rule.
        pathNot: [
          '^src/modules/$1/',
          '^src/modules/_shared/',
          '^src/modules/[^/]+/(service|types|constants)\\.ts$',
        ],
        // `import type` creates no runtime coupling (e.g. pulls/service reading
        // the `RepoRow` row type), so it is not a layering violation.
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'modules-use-ports-not-clients',
      comment:
        'Modules reach I/O only through Container getters typed as port ' +
        'interfaces. Concrete clients (and mocks) are wired exclusively in ' +
        'platform/container.ts. Pure helpers under adapters/ (diff-parser, ' +
        'astgrep/codeindex extraction) stay importable.',
      severity: 'error',
      from: { path: '^src/modules', pathNot: '\\.test\\.ts$' },
      to: {
        path: '^src/adapters/(github/octokit|git/simple-git|llm/(openai|anthropic)|secrets/local|auth/local|codeindex/ripgrep|embedder/openai|mocks)\\.ts$',
      },
    },
    {
      name: 'platform-independent-of-modules',
      comment:
        'platform/ is shared kernel + composition root; only container.ts (the ' +
        'composition root) may know about concrete module classes.',
      severity: 'error',
      from: { path: '^src/platform', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^src/modules' },
    },
    {
      name: 'db-independent-of-modules',
      comment:
        'db/ is infrastructure: schema, migrations and seed data. It may not ' +
        'reach outward into application code — seed rows carry precomputed ' +
        'values (see seed-conventions.ts ruleKey) instead of calling a module ' +
        'helper, and a test asserts they stay in step.',
      severity: 'error',
      from: { path: '^src/db' },
      to: { path: '^src/modules' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
