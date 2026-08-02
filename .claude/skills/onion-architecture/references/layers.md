# Layers — mapping the onion to this repo

## The model

Onion Architecture (Palermo, 2008) puts the domain model at the center,
wraps it in application services, and pushes infrastructure and UI to the
outermost ring. The only rule that matters: **dependencies point inward**.
The center never knows how it is stored, transported, or rendered.

Clean Architecture, Hexagonal (Ports & Adapters), and Onion are the same
idea with different vocabulary (Stemmler, Graça). This repo uses the
hexagonal vocabulary for the edges — *driving* adapters call us (HTTP, SSE,
polling schedulers), *driven* adapters are called by us (DB, GitHub, git,
LLM, secrets).

## Ring by ring

### Domain core

- `reviewer-core/` — the review engine: diff + repo map → prompt → LLM →
  grounded findings. Pure TS. No DB, no fs, no GitHub imports; the LLM is an
  injected `LLMProvider`. Never emits JS — consumed as TS source by alias.
- `server/src/vendor/shared/` — Zod contracts AND port interfaces
  (`GitClient`, `GitHubClient`, `LLMProvider`, `SecretsProvider`, …). This is
  the canonical copy; `client/src/vendor/shared` is the client's copy —
  changing a contract means updating BOTH.

The domain owns the interfaces. That is what makes the dependency arrow
point inward: `adapters/github/octokit.ts` imports `GitHubClient` from
shared — never the reverse.

### Application (use cases)

- `modules/<name>/service.ts` — one class per domain feature, constructed
  with `Container`. Orchestrates: loads via repository, calls ports, applies
  domain logic, owns transaction boundaries, throws `AppError` subclasses.
- `modules/<name>/helpers.ts` — pure transforms (URL parsing, DTO mapping).
- `modules/<name>/constants.ts` — literals (job kinds, secret names).

Services know *interfaces and rows*, never wire formats (HTTP req/reply) or
SQL.

### Infrastructure (driven adapters)

- `adapters/<x>/` — one folder per external capability: github (octokit),
  git (simple-git), llm (openai/anthropic; openrouter lives in
  reviewer-core), secrets, auth, codeindex (ripgrep), embedder, astgrep,
  depgraph, tokenizer. Each implements a port interface.
- `adapters/mocks.ts` — in-memory fakes for every port; tests inject them
  via `ContainerOverrides`.
- `modules/<name>/repository*.ts` — persistence adapter per feature; the
  only non-`db/` code importing `drizzle-orm`.
- `db/` — drizzle schema, client, generated migrations.

Pure functions colocated in `adapters/` (e.g. `git/diff-parser.ts`,
`codeindex/extract.ts`, `astgrep` parse helpers) are domain-grade utilities,
not I/O — modules MAY import those directly. Modules may NOT import concrete
clients (`octokit.ts`, `simple-git.ts`, `llm/openai.ts`, `secrets/local.ts`,
`mocks.ts`, …).

### Edge (driving adapters)

- `modules/<name>/routes.ts` — Fastify plugin: zod schemas, context
  resolution, one service call, status mapping.
- `platform/sse.ts` (RunBus) and `modules/polling/` — non-HTTP drivers.

### Composition root

- `platform/container.ts` — constructs every adapter lazily, resolves
  secrets, caches clients, exposes ports as typed getters. The ONE place
  where interfaces meet implementations (Palermo's "outermost ring wires the
  onion"; Synapse "composition root").
- `app.ts` + `modules/index.ts` — plugin order and module registration.

## Known legacy debt (allowlisted in `.dependency-cruiser.cjs`)

These `routes.ts` files import drizzle directly — they predate the layering
and are **frozen exceptions**, not precedent:

- `modules/settings/routes.ts`
- `modules/polling/routes.ts`
- `modules/workspace/routes.ts`
- `modules/pulls/routes.ts`

Rule: when a task touches one of these files beyond a trivial edit, extract
its queries into a `repository.ts` (+ `service.ts` if logic warrants),
remove the file from the allowlist, and run `pnpm arch:check`. Never add a
new file to the allowlist.
