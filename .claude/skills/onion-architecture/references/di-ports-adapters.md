# DI, ports & adapters — the composition root

`platform/container.ts` is the composition root: the single place where
port interfaces meet concrete implementations (Palermo's outermost ring;
Synapse "dependency inversion"). This project deliberately uses a
hand-rolled container — do NOT introduce awilix/inversify; the pattern, not
the framework, is the point.

## Anatomy of a port

Every external capability follows the same five-part shape. Example —
`GitClient`:

| Part | Where |
|---|---|
| 1. Interface (the port) | `vendor/shared` (cross-package ports) or `adapters/<x>/index.ts` (server-local, e.g. `DepGraph`, `Tokenizer`) |
| 2. Real adapter | `adapters/git/simple-git.ts` → `SimpleGitClient` |
| 3. Mock | `adapters/mocks.ts` (in-memory fake) |
| 4. Override slot | `ContainerOverrides.git` |
| 5. Lazy getter | `Container.get git()` — override wins, else construct once |

**Adding a new external tool means shipping all five in one change.** A
port without a mock is untestable; a mock without an override slot is
unreachable; an adapter constructed outside the container is invisible to
tests. Reject partial ports in review.

## Getter patterns in `container.ts`

- **Sync, secret-free** (`git`, `codeIndex`, `tokenizer`): lazy `??=` with
  override check first.
- **Async, secret-gated** (`github()`, `llm(id)`, `embedder()`): resolve the
  key through `SecretsProvider` at call time, throw `ConfigError` when
  missing, cache the client, and support `invalidateSecretCaches()` after a
  key change. Secrets never enter `AppConfig` — they flow only through the
  secrets port.
- **Facades** (`repoIntel`): a whole subsystem behind one interface, so
  consumers (reviews, onboarding) depend on `RepoIntel`, not on indexing
  internals. Prefer a facade port when a module exposes >2 entry points to
  other modules.
- **Cross-cutting repositories** (`agentsRepo`, `reviewRepo`): constructed
  here so consuming modules use `container.reviewRepo` instead of importing
  another module's folder.

## Rules for consumers

- Services receive `Container` and read **interface-typed** getters. The
  service must compile against the port type — if it needs a method that
  only the concrete class has, the port interface is incomplete: extend the
  interface, don't downcast.
- Never `new OctokitGitHubClient()` / `new OpenAIProvider()` / read
  `process.env` outside `platform/` and `adapters/`. Config enters through
  `loadConfig`, secrets through the secrets port.
- Pure helpers colocated under `adapters/` (diff parser, astgrep symbol
  extraction) are importable from modules — they are functions, not clients.
  The `arch:check` rule encodes exactly this distinction.
- reviewer-core receives its dependencies (LLMProvider, cost estimator) as
  constructor/function arguments — it must never import from `server/`.

## Why not a DI framework

The container is ~200 lines, fully typed, and greppable; every dependency
edge is explicit in one file. Frameworks (fastify-awilix et al.) buy
auto-wiring at the cost of implicit resolution — wrong trade for a codebase
this size. Revisit only if the container's constructor-ordering burden
actually hurts.
