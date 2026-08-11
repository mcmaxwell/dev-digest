# Insights - mcp

Append-only lessons specific to this package, kept in fixed sections - append
into the matching one, never rewrite old entries. Cross-cutting lessons go to
the root INSIGHTS.md. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

- [2026-08-10] Making the HTTP client a CONSTRUCTOR ARGUMENT
  (`createServer({ api: ApiClient })`, `src/server.ts`) is what makes the whole
  hermetic lane possible: every tool test hands over a plain object literal and
  nothing is mocked by module path. Pair it with the depcruise rule
  `tools-go-through-the-api-port` (only `src/api/index.ts` is importable from
  `src/tools/**`) or the seam rots the first time somebody needs a fetch helper
  in a handler. Verify such a rule actually fires before trusting it: drop a
  throwaway `src/tools/_probe.ts` importing `../api/http.js`, run
  `pnpm arch:check`, confirm the error names the rule, delete the probe.
- [2026-08-10] For an async wait loop, inject BOTH `sleep` and `now`
  (`src/wait.ts`, `WaitOptions`) rather than reaching for
  `vi.useFakeTimers()`. The MCP SDK drives handlers through its own async
  machinery and fake timers fight it; a virtual clock whose `sleep` just
  advances a counter runs the full 180-second schedule in microseconds and lets
  a test assert the exact sleep sequence (`test/run-agent-on-pr.test.ts`).

## What Doesn't Work

- [2026-08-10] Do NOT add a `paths` alias to `@devdigest/shared` here. The MCP
  SDK v2 pins zod 4 and `server/`, `client/`, `reviewer-core/` are all zod 3.
  reviewer-core's self-pin trick (`"zod": ["./node_modules/zod"]`) works only
  because both sides there are zod 3; across a major version it produces a wall
  of type errors inside vendored files this package does not own. Narrow local
  parsers in `src/api/schemas.ts` are the intended answer, and
  `mcp-is-standalone` in `.dependency-cruiser.cjs` enforces it.

## Codebase Patterns

- [2026-08-10] The rule "each AGENT's latest review, unioned" now has THREE
  copies: canonical `server/src/modules/smart-diff/helpers.ts:32`
  (`latestReviewFindings`), one in the client, and
  `mcp/src/rules/latest-reviews.ts` (`latestReviewPerAgent`). Change one and you
  must change all three. The copy here is deliberate: importing the server's
  would mean aliasing into `server/src/modules/`, and that file pulls
  `FindingRow` from `db/rows.ts`, i.e. Drizzle row types, which is exactly what
  this package exists not to touch. The shared fixture in
  `mcp/test/latest-reviews.test.ts` is lifted from `server/test/smart-diff.test.ts`
  so a divergence surfaces as a failing test rather than as a PR silently losing
  one agent's findings.
- [2026-08-10] Model-facing text splits by WHEN IT IS PAID FOR, not by topic. A
  tool description is loaded into the system prompt of every session, so it is
  short and locked by a test; an error body only costs tokens when it fires, so
  every teaching paragraph lives in `src/format/errors.ts` or in the
  `get_blast_radius` stub. When a message feels too long for a description, that
  is usually the signal it belongs in a failure path instead.
- [2026-08-10] The description-drift test transcribes the approved wording
  INDEPENDENTLY in `test/tools-list.test.ts` rather than importing the constants
  from `src/tools/`. Importing them would only prove the code equals itself. The
  duplication is the point: it forces a second, deliberate edit for a text that
  every user pays for on every session.

## Tool & Library Notes

- [2026-08-10] `@modelcontextprotocol/sdk` is the OLD v1 line. This package uses
  `@modelcontextprotocol/server` + `@modelcontextprotocol/client` `^2.0.0`, and
  almost every tutorial online shows v1. The deltas that actually break: v2 is
  `registerTool(name, config, cb)` not `server.tool(...)`; `inputSchema` must be
  a real `z.object({...})`, not a raw shape; the stdio entry point is
  `serveStdio(factory)` from `@modelcontextprotocol/server/stdio`, not
  `new StdioServerTransport()` + `server.connect()`; and zod is imported as
  `import * as z from 'zod'` (zod 4), not `import { z } from 'zod'`.
- [2026-08-10] For testing an MCP server in-process, `InMemoryTransport.createLinkedPair()`
  from `@modelcontextprotocol/server` is far simpler than `createMcpHandler` plus
  an HTTP client transport: two lines, and it exercises the real wire result
  including the `isError` payloads the SDK generates for invalid arguments
  BEFORE a handler runs (`test/helpers/client.ts`). There is no such shortcut for
  stdio - proving `bin/devdigest-mcp` speaks the protocol needs a spawned
  process, which is why `mcp-stdio.it.test.ts` is the only opt-in file.
- [2026-08-10] Every schema the SDK emits carries a
  `"$schema": "https://json-schema.org/draft/2020-12/schema"` key (~55 chars),
  and an `outputSchema` also gains `additionalProperties: false`. Budget for it;
  it cannot be stripped. Also, `z.number().int()` emits
  `"maximum": 9007199254740991` into the advertised schema - harmless, but it is
  visible noise in the model's prompt, so prefer an explicit `.max()` when the
  field has a real ceiling.
- [2026-08-10] `pnpm install` in this package reports "Ignored build scripts:
  esbuild". That is fine: `tsx` and `vitest` both work, because esbuild ships its
  binary as a platform-specific optional dependency rather than through the
  postinstall script. Do not "fix" it with `pnpm approve-builds`.

## Recurring Errors & Fixes

- [2026-08-10] A `console.log` anywhere in `src/**` breaks the MCP handshake:
  stdout is the JSON-RPC channel, so the banner lands in front of the
  `initialize` response and the host reports the server as failed to start. The
  cheap check is
  `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | ./bin/devdigest-mcp 2>/dev/null | wc -l`
  - it must print exactly `1`.

## Session Notes

- [2026-08-10] L04 `/mcp` implemented: fifth standalone package, five tools over
  stdio, HTTP-only access to the API, `tools/list` measured at 1571 tokens
  against a 2500 budget. `get_blast_radius` ships as a deliberate stub whose
  error body is the exercise brief. Fixtures under `test/fixtures/` are
  HAND-WRITTEN against the server contracts and should be re-captured from a
  live seeded stack (`curl localhost:3001/agents | jq`) when one is available.

## Open Questions

- [2026-08-10] `get_findings` by `run_id` only resolves runs started in the
  current MCP process, because no API route maps a run to its PR
  (`GET /runs/:id/trace` returns `RunTrace.config` without `pr_id`). Adding
  `GET /runs/:id -> { run_id, pr_id, status }` in
  `server/src/modules/reviews/routes.ts` would delete the whole `src/run-index.ts`
  limitation; it is filed as the optional bonus of the L04 exercise.
