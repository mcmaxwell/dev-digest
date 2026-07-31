# @devdigest/api — Fastify API + Drizzle/Postgres (:3001)

Imports repos + PRs, indexes repos (repo-intel), stores agents, runs reviews
via reviewer-core. Adapters (llm, github, git, astgrep, tokenizer, secrets)
sit behind the DI container in `src/platform/container.ts` — tests swap them
for `src/adapters/mocks.ts`.

## Commands

```sh
pnpm dev                                        # tsx watch, :3001
pnpm db:generate                                # schema.ts change → new migration
pnpm db:migrate && pnpm db:seed                 # NOT run on boot
pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit (no Docker)
pnpm exec vitest run .it.test                   # integration (testcontainers PG)
```

## Mini-map

```
src/modules/<name>/   one plugin per domain: routes.ts + service/repo; registered
                      statically in src/modules/index.ts (one import + register)
src/adapters/         ports + real impls; mocks.ts for tests
src/platform/         config.ts (loadConfig) · container.ts (DI)
src/db/               drizzle schema + generated migrations/
src/vendor/shared/    CANONICAL @devdigest/shared Zod contracts
src/prompts/          system prompts (onboarding)
clones/               runtime repo checkouts — never edit
```

## Conventions

- Routes declare zod `params`/`body` schemas (fastify-type-provider-zod);
  invalid input 422s before the handler — never `Schema.parse(req.body)`.
- Plugins (helmet, cors, rate-limit, SSE, error handler) register before
  modules so modules inherit them. Errors: structured envelope; AppError → status.
- A test importing `test/helpers/pg.ts` MUST be named `*.it.test.ts`.
- Schema change flow: edit `src/db/schema*.ts` → `pnpm db:generate` →
  `pnpm db:migrate`. Never hand-edit `src/db/migrations/`.
- The DB schema already contains EVERY table for all course lessons; unused
  tables sit empty by design — do not "clean them up".

## Gotchas

- Secrets never enter `AppConfig` — they flow through `SecretsProvider`
  (`src/adapters/secrets/local.ts`, `~/.devdigest/secrets.json`, mode 0600,
  env fallback). `GITHUB_TOKEN` canonical, `GITHUB_PAT` accepted.
- Repo-intel context only populates once a repo is indexed — an unindexed repo
  silently degrades the review to diff-only (no error).
- Prompt-injection defense is the shared `INJECTION_GUARD` appended in
  reviewer-core's `assemblePrompt` — never add keyword denylists for untrusted text.
- Rate limit: global 120/min (off when `NODE_ENV=test`), tighter on
  `POST /pulls/:id/review`; SSE and `/health*` exempt.
- Engine reaps orphaned `running` runs on boot.

## Read when…

- …anything non-trivial here → `README.md` (request/DI flow, API map, env table)
- …touching indexing / repo map → `src/modules/repo-intel/README.md`
- …changing prompt assembly or grounding → `../reviewer-core/README.md`
- …test strategy or CI → `../TESTING.md`
- …before starting a task here → `INSIGHTS.md`; specs → `specs/`
