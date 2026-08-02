# Folder structure & code organization

## Feature-based vs type-based

- The official React position (legacy FAQ) is deliberately neutral: both
  "group by feature/route" and "group by file type" are valid; don't spend
  more than five minutes choosing; avoid deep nesting (max 3–4 levels);
  expect the structure to evolve.
- The 2024–2026 community consensus for anything beyond a small app:
  **feature-based wins**. Group by business capability, not technical role.
  Top-level `components/`, `hooks/`, `utils/` as the *only* axis stops
  scaling once dozens of components span domains (bulletproof-react, Robin
  Wieruch, Tao of React, profy.dev).
- "Screaming architecture" (Uncle Bob via profy.dev): top-level folder names
  should say what the app *does* (`review`, `billing`, `repos`), not what
  framework concepts exist.
- Credible dissent — Josh Comeau organizes by function (`components/`,
  `hooks/`, `helpers/`, `utils/`, `constants.ts`), arguing feature boundaries
  blur over time. Note: even he gives each component its own folder with
  everything colocated inside. The disagreement is about the top-level axis
  only, not about colocation.
- Practical middle ground most sources land on: `features/` for domain code
  PLUS a small set of shared type-based folders for genuinely cross-cutting
  code.

## Colocation (Kent C. Dodds)

- "Place code as close to where it's relevant as possible."
- Tests next to source (no mirrored `test/` tree), styles with components,
  feature docs (README) inside feature folders, component-specific hooks in
  the component's folder.
- Exception: e2e tests span the system → they live at project root.
- Don't prematurely extract helpers to `utils/` — keep a helper in the file
  that uses it until a second consumer appears, then promote.

## Bulletproof-react reference layout

The most-referenced React architecture template (~30k+ stars):

```
src/
  app/          # routes, app-level providers, router
  assets/
  components/   # shared, domain-free components
  config/       # global config, env exports
  features/
    awesome-feature/
      api/        # fetchers + query/mutation hooks + request schemas
      assets/
      components/
      hooks/
      stores/
      types/
      utils/      # each feature includes ONLY the folders it needs
  hooks/        # shared hooks
  lib/          # preconfigured wrappers over third-party libs
  stores/       # global state
  testing/
  types/        # shared base types
  utils/        # shared pure utilities
```

Rules:

- **Unidirectional imports:** shared modules usable by anything; features may
  import only shared; app may import features + shared. Enforced with ESLint
  `import/no-restricted-paths` (see conventions.md).
- **No cross-feature imports.** Compose features at the app/route level.
- Component hygiene: no nested render functions; limit props — prefer
  composition/children/slots; wrap third-party components in your own
  abstraction.

## Barrel files: don't (in app code)

- TkDodo ("Please Stop Using Barrel Files", 2024): importing a barrel loads
  every module in it — real Next.js case went from 11k to 3.5k modules (−68%)
  after deleting internal barrels; barrels also cause accidental circular
  imports and defeat tree-shaking.
- bulletproof-react used to recommend an `index.ts` public API per feature and
  now explicitly recommends **direct imports** instead (Vite tree-shaking).
- Legitimate barrel: a **library's public entry point** (package.json
  `exports`). Guard with `import/no-cycle`.
- Comeau's per-component `index.ts` (import ergonomics for
  `@/components/Button`) is the defensible minority position — single-
  component granularity only.

## Atomic Design: retired for apps

- Atoms/molecules/organisms classification is ambiguous, has no home for
  business logic, API calls, state, or domain entities, and carries heavy
  folder overhead (dev.to 2025 retrospective, reactarchitecture.org).
- Still viable *inside a pure design-system/UI-kit package*. For apps use
  feature-based structure or FSD.

## Scaling path (Robin Wieruch, updated 2026)

single file → technical folders → **feature folders** → domain folders →
monorepo (`apps/` + `domains/` + `packages/`). At every stage:

- Promote shared code only on second consumer.
- "Code flows in one direction: from shared utilities into features, and from
  features into pages."
- Never nest deeper than ~2 levels inside a feature.

## Feature-Sliced Design (large-scale formalization)

- Layers, top → bottom: `app` → `pages` → `widgets` → `features` → `entities`
  → `shared`. A module imports only from layers **strictly below**; same-layer
  cross-slice imports forbidden.
- Slices = business domains within a layer; segments within slices: `ui`,
  `api`, `model`, `lib`, `config`.
- When overkill: FSD itself says don't adopt it if the current architecture
  works; minimal projects need only app + pages + shared. For small/mid apps
  bulletproof-react's 3 tiers give ~80% of the benefit with far less
  ceremony; FSD pays off with large teams and many domains.
