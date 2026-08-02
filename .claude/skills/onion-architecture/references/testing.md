# Testing per layer

The onion's payoff is testability: each ring has a natural test style, and
the port boundaries are the mock points. ("With clearly defined ports you
mock dependencies and test domain logic fast" — hexagonal literature;
project strategy in `TESTING.md`.)

## Which test where

| Layer | Test style | File suffix | Doubles |
|---|---|---|---|
| Domain (`reviewer-core`, helpers) | pure unit — call the function | `*.test.ts` | none needed |
| Service | hermetic unit | `*.test.ts` | mock ports via `ContainerOverrides` |
| Repository | integration against real Postgres | `*.it.test.ts` | testcontainers (`test/helpers/pg.ts`) |
| Routes | `app.inject()` through the real plugin chain | `*.test.ts` or `*.it.test.ts` if it hits the DB | mocked container |

Hard project rule: any file importing `test/helpers/pg.ts` MUST be named
`*.it.test.ts` — that suffix is what splits the Docker-free unit run
(`vitest run --exclude '**/*.it.test.ts'`) from the testcontainers run.

## The mock point is the port, not the module

- To test a service, build a container with `ContainerOverrides`
  (`{ git: mockGit, llm: { openai: mockLLM } }` from `adapters/mocks.ts`) —
  never `vi.mock('../adapters/git/simple-git.js')`. Module-path mocking
  couples the test to file layout and silently breaks on refactor; override
  injection couples it to the port interface, which is the contract.
- If a service is hard to test without mocking a *concrete* class, that's a
  design smell: the dependency isn't behind a port. Fix the port (rule 4 in
  SKILL.md), then test.
- reviewer-core tests inject a scripted `LLMProvider` — deterministic
  prompts in, canned completions out. No keys, no network.

## What each layer's tests should assert

- **Domain/helpers**: input → output. No setup beyond arguments.
- **Service**: orchestration — given these port behaviors (including
  failures: missing secret, git error, LLM timeout), the right repository
  writes and enqueues happen, the right `AppError` is thrown. Degradation
  paths (e.g. unindexed repo → diff-only review) are service-level cases.
- **Repository**: real SQL semantics — tenancy scoping actually filters,
  `returning()` shapes, constraint behavior. These are exactly the things
  mocks would lie about, hence testcontainers.
- **Routes**: schema rejection (422 before handler), status mapping, error
  envelope shape. One or two per route — the logic already has service
  tests.

## e2e

`./scripts/e2e.sh` runs deterministic browser flows against an isolated
stack with JSON-spec agents — no LLM, no keys. It validates the wiring of
the whole onion, not business logic; don't move layer-testable assertions
up here.
