# @devdigest/mcp - local MCP server (stdio)

Exposes DevDigest to an editor agent as five tools: `list_agents`,
`run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`.
Reaches the domain over HTTP to `http://localhost:3001` and nothing else.

It also ships a second binary, `bin/devdigest` (`devdigest review --mode
working`): the pre-push CLI. Separate entry file, separate stdout contract -
see `src/cli/main.ts`.

## Read this first: the SDK is v2, and most tutorials are v1

`@modelcontextprotocol/sdk` is the OLD line (v1).
This package uses the new split packages: `@modelcontextprotocol/server` and
`@modelcontextprotocol/client`, both `^2.0.0`, both on **zod 4**.

| v1 (what a blog post will show you) | v2 (this package) |
|---|---|
| `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'` | `import { McpServer } from '@modelcontextprotocol/server'` |
| `server.tool(name, schemaShape, cb)` | `server.registerTool(name, config, cb)` |
| `inputSchema` is a raw shape `{ a: z.string() }` | `inputSchema` is a real `z.object({ a: z.string() })` |
| `new StdioServerTransport()` + `await server.connect(t)` | `serveStdio(() => createServer(...))` |
| `import { z } from 'zod'` (zod 3) | `import * as z from 'zod'` (zod 4) |

If you copy v1 code in here it will type-check against nothing and fail at
runtime. The lockfile is committed and the range is pinned to `^2.0.0` for that
reason. Backwards compatibility exists in the other direction only:
`serveStdio` defaults to `legacy: 'serve'`, so a 2025-era client still works.

## The asymmetry that shapes every text in this package

**A tool description is taxed on every session of every user.** A host loads
`tools/list` into the system prompt before the first message; seven ordinary MCP
servers cost ~67k tokens that way. **An error body is taxed only when it
fires.**

So:

- Tool and parameter descriptions are short, approved, and locked by a test.
  Changing one is a deliberate decision plus a `pnpm budget` re-run, never a
  side effect of a refactor. `test/tools-list.test.ts` holds an independent
  transcription of the approved wording; drift fails there.
- Long, teaching text lives in `src/format/errors.ts` and in the RESULT BODIES
  the renderers build (`src/format/render.ts`) - for instance the paragraph
  `get_blast_radius` prints when a repository has no index. It costs nothing
  until it fires, and that is where a model most needs prose. (Until L04 landed
  this sentence pointed at the `get_blast_radius` STUB body; the stub is gone.)
- The whole `tools/list` payload has a hard budget of **2500 tokens** (warn band
  2200), measured with `pnpm budget` and enforced in CI by the same counter.

## Commands

```sh
pnpm dev          # run the server on this terminal's stdio (rarely useful directly)
./bin/devdigest review --mode working   # the pre-push CLI (see src/cli/)
pnpm typecheck
pnpm arch:check   # dependency-cruiser boundaries
pnpm test         # hermetic: no network, no Docker, no keys
pnpm test:it      # opt-in; spawns the real process, wants ./scripts/dev.sh
pnpm budget       # per-tool token table for tools/list
pnpm inspect      # MCP Inspector against bin/devdigest-mcp
```

## Rules

- **stdout is the JSON-RPC channel.** No `console.log`, anywhere, ever - one
  stray write breaks `initialize`. The CLI is the ONE thing that writes to
  stdout, which is exactly why it has its own entry file and its own launcher,
  and why `cli-does-not-import-the-mcp-server` keeps the two apart. Diagnostics go to `console.error`, one line
  per HTTP call, and **never a response body**: `GET /agents` carries
  `system_prompt` and `GET /repos` carries `clone_path`.
- **`createServer(deps: { api: ApiClient })` takes the HTTP client as an
  argument.** Only `src/index.ts` builds a real one. Every handler test hands
  over a plain object; nothing is mocked by module path. The depcruise rule
  `tools-go-through-the-api-port` keeps `src/tools/**` pointed at
  `src/api/index.ts`.
- **Flat schemas only.** No `anyOf`/`oneOf`/`allOf`/`$ref`, at most 8
  parameters, every parameter `.describe()`d, every optional parameter carrying
  its default in the schema. Cross-field rules (the `run_id` XOR `repo` +
  `pr_number` one in `get_findings`) are checked in the handler and explained in
  prose, because `.refine()` and discriminated unions both emit `anyOf`.
- **Never return a bare throw to the model.** Return `{ isError: true }` with a
  message that names the NEXT ACTION. Every failure text lives in
  `src/format/errors.ts` and is covered by the table in `test/errors.test.ts`.
- **An agent's `system_prompt` and `output_schema` never appear in any output.**
  This is structural, not a convention: `src/api/schemas.ts` does not list those
  keys and zod strips what it does not list. `test/list-agents.test.ts` keeps a
  canary in the fixture.
- **No secrets in this process.** It reads three environment variables, none of
  them a key. Reviews are triggered through the API, which owns the provider
  keys in `~/.devdigest/secrets.json`.
- Integration tests end in `*.it.test.ts`, matching the server convention:
  the suffix means "needs a live stack", and `pnpm test` excludes it.

## Why no `@devdigest/shared`

Every other package aliases the vendored zod contracts. This one does not, and
`tsconfig.json` has no `paths` block at all.

The MCP SDK v2 requires **zod 4**; `server/`, `client/` and `reviewer-core/` are
on **zod 3**. The self-pin trick reviewer-core uses (`"zod": ["./node_modules/zod"]`)
works there because both sides are zod 3; across a major it just produces a wall
of type errors inside vendored files nobody here owns.

Instead `src/api/schemas.ts` holds narrow parsers for the handful of fields the
tools read. That is a real cost - a contract change on the server can drift from
this package silently - and a real benefit: a field that is not listed there
CANNOT reach a tool result. The depcruise rule `mcp-is-standalone` makes the
separation mechanical.

## Where this sits in the architecture

`/mcp` is **outside the onion, as a client of its edge**. In the
`onion-architecture` skill's vocabulary the MCP server is a fourth driving
adapter, but it runs in its own process, so it cannot break a layer by
construction: the only route to the domain is HTTP.

The skill's rule 4 ("a new external tool means a full port, atomically") does
NOT apply. That rule is about DRIVEN ports, things we call. An MCP host calls
US. Nothing is added to `server/`: no port, no adapter, no `ContainerOverrides`
field, no `Container` getter.

The skill's rule 3 applies in spirit INSIDE this package: `ApiClient` is the
port, `createApiClient` is the adapter, `createServer({ api })` is the
injection.

`src/format/` is formatting, `src/rules/` is copied business rules,
`src/run-index.ts` is process state. There is deliberately no `src/domain/`:
in this repo "domain" means `reviewer-core/` plus `vendor/shared`, and none of
this is that.

## Mini-map

```
src/index.ts        serveStdio + the ONLY real ApiClient construction
src/server.ts       createServer(deps) -> McpServer with the five tools
src/config.ts       three env vars, parsed once; no secrets
src/api/            index.ts = the ApiClient PORT (the only file tools may import)
                    http.ts = fetch + the four error classes · schemas.ts = narrow parsers
                    resolve.ts = owner/name -> uuid, slug -> uuid, 60s cache
src/wait.ts         poll GET /pulls/:id/runs to a terminal status (not SSE - see the file)
src/run-index.ts    bounded LRU run_id -> { prId, repo, prNumber }
src/rules/          latest-reviews.ts (THIRD copy of a server rule) · severity.ts ·
                    blast-shape.ts (envelope -> get_blast_radius outputSchema)
src/format/         render.ts · errors.ts (all model-facing failure text) · slug.ts · truncate.ts
src/tools/          one file per tool + shared.ts (approved descriptions, ok/fail)
src/cli/            `devdigest review` - main.ts is the ONLY file that prints or
                    exits; args/help/git/modes/render/exit are pure or I/O-only
scripts/token-budget.ts   pnpm budget; exports the counter the gate test uses
```

## Read when...

- ...you want to use or register the server -> `README.md`
- ...before starting a task here -> `INSIGHTS.md`
- ...test strategy across the repo -> `../TESTING.md`
- ...the API surface these tools call -> `../server/README.md`
