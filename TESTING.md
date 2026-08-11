# Testing & CI strategy

DevDigest is five independent packages (no workspace), so testing is organised
as **one suite per package**, each with its own CI workflow, runner, and path
filter. A package's suite runs only when that package (or a package it depends
on at type-check time) changes.

## Philosophy — typological, not exhaustive

We do **not** chase line coverage. Each suite covers the *kinds* of things that
can break in that layer — one happy path plus the edge that actually matters per
workflow — and deliberately skips the rest. Concretely:

- **Test behaviour at the seams**, not implementation details. Routes, adapters,
  contracts, the review pipeline, the rendered component.
- **Mock the outside world.** LLMs, GitHub, and git are stubbed via
  `server/src/adapters/mocks.ts` so unit tests are hermetic and key-free.
- **One real integration per data-backed workflow**, against a real Postgres —
  not a mock DB — because the bugs there live in SQL, migrations, and wiring.
- **A few end-to-end browser flows** over the *main* user journeys, on seeded
  data, with no LLM in the loop.

If a test wouldn't catch a class of regression we care about, we don't write it.

## Suite map

| Suite | Package | Kind | Runner | Workflow | Docker? |
|-------|---------|------|--------|----------|---------|
| client | `client/` | component / unit (jsdom) | vitest | `client.yml` | no |
| server-unit | `server/` | unit (hermetic) | vitest | `server-unit.yml` | no |
| server-integration | `server/` | integration (real Postgres) | vitest | `server-integration.yml` | **yes** |
| reviewer-core | `reviewer-core/` | unit (engine) | vitest | `reviewer-core.yml` | no |
| mcp | `mcp/` | unit (tool handlers, hermetic) | vitest | `mcp.yml` | no |
| mcp live stack | `mcp/` | integration (`*.it.test.ts`, opt-in) | vitest | none (manual) | no (needs the API) |
| e2e web | `e2e/` | browser e2e (deterministic) | agent-browser + `run.ts` | `e2e-web.yml` | yes (stack) |

## What each suite covers

**client** — components render and react to interaction (React Testing Library
+ jsdom). `fetch` is mocked; no API, DB, or browser. Covers the PR-review
surface (list, diff, findings, run controls) and the agent editor.

**server-unit** — the DB-free majority: adapters, prompt assembly, grounding,
repo-intel ranking & indexing, pricing, route smoke. The `typecheck` job also
runs on Windows, which doubles as the `@ast-grep/napi` prebuilt gate (install
fails there if the win32 prebuilt is missing).

**server-integration** — the `*.it.test.ts` files. Each starts a real Postgres
(pgvector) via testcontainers, builds the Fastify app, migrates + seeds, and
drives routes end-to-end: reviews + run lifecycle (incl. grounding), agents CRUD,
repo-intel symbol clamping, pulls comments, settings models. They self-skip when
Docker is unavailable.

**reviewer-core** — the pure engine: `toReview` selection, prompt construction,
and a `run` with a stubbed model → grounded findings. No DB / GitHub / FS.

**mcp** - the five MCP tool handlers, driven through a real MCP `Client` over an
in-process handler, so what is asserted is the actual wire result (SDK
validation errors included). Hermetic because `createServer({ api })` takes the
HTTP client as an argument: every test passes a fake `ApiClient` built from
committed fixtures. No network, no Postgres, no key, no spawned process. The
suite also carries a structural gate over `tools/list` (token budget, flat
schemas, description length limits) so a sixth tool cannot quietly break the
conventions.

`cd mcp && pnpm test:it` is the opt-in second lane: it spawns the real binary
over stdio and talks to a running API, so it needs `./scripts/dev.sh
--no-client` in another terminal. It is **not** in CI.

`run_agent_on_pr` end to end is deliberately a **manual** check, at no tier: it
spends real LLM tokens and needs a provider key. Run it by hand against the
seeded `acme/payments-api` PR #482. Same reasoning that keeps `e2e/` free of
LLM calls.

**e2e web** — see `e2e/README.md`. Deterministic agent-browser flows over the
main journeys (boot → PR list → PR detail; agents) against a real seeded stack.
No `chat`, no model key.

## Running locally

```sh
# per package
cd client        && pnpm test           # + pnpm typecheck
cd reviewer-core && npm test
cd mcp           && pnpm test           # + pnpm typecheck, pnpm arch:check

# server — the unit/integration split (see note below)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm exec vitest run .it.test                      # integration, needs Docker
cd server && pnpm test                                          # both

# mcp against a live API (opt-in, not in CI)
./scripts/dev.sh --no-client
cd mcp && pnpm test:it

# browser e2e (needs the full stack + agent-browser CLI)
./scripts/dev.sh
npm i -g agent-browser && agent-browser install
cd e2e && npm install && npm test
```

## Conventions

- **Integration tests end in `*.it.test.ts`.** The unit lane excludes that glob
  (`vitest run --exclude '**/*.it.test.ts'`); the integration lane selects only
  it (`vitest run .it.test`). A DB-backed test that imports `test/helpers/pg.ts`
  must use the `.it.test.ts` suffix. `mcp/` reuses the same convention for the
  opposite dependency: there the suffix means "needs a running API".
- **`server/package.json` is `skip-worktree`** (a local variant diverges from the
  committed file). CI therefore invokes the split with
  `pnpm exec vitest run …` rather than relying on committed `test:unit` /
  `test:integration` scripts.
- **Hermetic by default.** Reach for `src/adapters/mocks.ts` (MockLLMProvider,
  MockGitClient) rather than real network/keys.
- **E2E specs are deterministic batch JSON** (`e2e/specs/*.flow.json`) using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **CI is path-filtered per package.** Cross-package source aliases are encoded
  in each workflow's `paths:` (e.g. `reviewer-core/**` triggers `server-unit`
  because the server type-checks against `../reviewer-core/src`). `mcp.yml`
  carries no such entry on purpose: `mcp/` aliases nothing and reaches the API
  over HTTP, so only `mcp/**` may trigger it.
- **`server/clones/**` is runtime data** (git-ignored) and never collected by
  any suite.
