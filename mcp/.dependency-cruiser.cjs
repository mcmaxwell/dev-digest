/**
 * Boundary rules for devdigest-mcp.
 *
 * This package is a DRIVING ADAPTER that lives in its own process: an MCP host
 * calls it, and the only way it can reach the DevDigest domain is HTTP to the
 * local API. The rules below are what keeps that true - see AGENTS.md.
 *
 * Run: pnpm arch:check   (requires Node >= 22 - dependency-cruiser uses
 * `util.styleText`, which older Node versions do not export)
 */
module.exports = {
  forbidden: [
    {
      name: 'mcp-is-standalone',
      comment:
        'The MCP server reaches DevDigest over HTTP, never by importing another ' +
        'package. An import from server/ or client/ would also drag zod 3 ' +
        'contracts into a zod 4 process.',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^\\.\\./(server|client|reviewer-core|e2e)' },
    },
    {
      name: 'mcp-has-no-db-or-framework',
      comment:
        'No database, HTTP framework, git or GitHub client in this process. It ' +
        'has exactly two runtime dependencies (the MCP SDK and zod) and holds ' +
        'no secrets; anything below belongs behind the API.',
      severity: 'error',
      from: { path: '^src' },
      to: {
        path: '^(node_modules/)?(drizzle-orm|drizzle-kit|postgres|pg|fastify|octokit|@octokit|simple-git)',
      },
    },
    {
      name: 'tools-go-through-the-api-port',
      comment:
        'A tool handler talks to the `ApiClient` PORT (src/api/index.ts), never ' +
        'to the fetch wrapper or the response parsers directly. That is what ' +
        'lets every handler test pass a plain fake object instead of mocking a ' +
        'module path.',
      severity: 'error',
      from: { path: '^src/tools' },
      to: { path: '^src/api/', pathNot: '^src/api/index\\.ts$' },
    },
    {
      name: 'no-circular',
      comment: 'Circular imports make the DI wiring in src/server.ts unreadable.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
