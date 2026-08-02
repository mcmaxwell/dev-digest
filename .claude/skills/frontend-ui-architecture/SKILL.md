---
name: frontend-ui-architecture
description: React/Next.js frontend architecture and code organization. Use when deciding where components, hooks, business logic, constants, utils, or types should live; structuring or restructuring a React/Next.js project; splitting a component; organizing an App Router app; or setting up import boundaries between features. Covers folder structure, colocation, logic layering (view → hook → service), and shared-code conventions. Architecture only — NOT performance, hook correctness (react-best-practices), or Next.js runtime/data patterns (next-best-practices).
version: 1.0.0
---

# Frontend UI Architecture

Code organization and architecture rules for React + Next.js apps. Every rule
here is sourced; full source list in `README.md`, details per topic in
`references/`.

**Scope boundary:** this skill answers "where does this code live and how is it
layered." For hook semantics, state anti-patterns, and rendering behavior use
`react-best-practices`; for RSC data fetching, caching, and file conventions
use `next-best-practices`.

## Five core principles

1. **Colocation.** Place code as close to where it's used as possible: tests
   next to source, styles/hooks/types next to their component, state at the
   lowest tree point that needs it. (Kent C. Dodds)
2. **Promotion rule.** Code starts inside the feature (or file) that uses it.
   Promote to a shared layer only when a **second** consumer appears — never
   preemptively. (Wieruch, Dodds)
3. **Unidirectional imports.** `shared → features → app`. Features NEVER import
   other features — compose them at the app/route level. Enforce with ESLint.
   (bulletproof-react)
4. **Feature-based top level.** Group by business domain (`features/review`,
   `features/repos`), not by technical role. Type-based folders
   (`components/`, `hooks/`, `utils/`) survive only as a small *shared* layer.
   (bulletproof-react, Wieruch, Kondov)
5. **Logic out of components.** Layering: view (JSX) → custom hook
   (orchestration) → service/api client (I/O) → pure domain functions
   (business rules). Components express intent, not implementation.
   (Fowler/Qiu, react.dev)

## Folder structure — decision guide

| App size | Structure |
|---|---|
| Small (< ~10 screens) | Flat `components/` + `hooks/` + `lib/` is fine; don't over-engineer |
| Growing | `features/<domain>/` + small shared layer (`components/`, `hooks/`, `lib/`, `utils/`, `types/`) |
| Large / many teams | Feature-Sliced Design layers or monorepo packages |

Canonical mid-size layout (bulletproof-react):

```
src/
  app/          # routes, providers, router — composition only
  components/   # shared, domain-free UI
  features/
    <domain>/   # api/ components/ hooks/ stores/ types/ utils/ — only what it needs
  hooks/  lib/  config/  types/  utils/   # shared layer
```

- Max ~3 levels of nesting; structure evolves — don't overthink upfront.
- No barrel files (`index.ts` re-exports) inside app code — direct imports
  only. Barrels are for library entry points. (TkDodo, bulletproof-react)
- Atomic Design: only for pure design-system packages, not app structure.

Details: `references/folder-structure.md`

## Where business logic lives

- **Pure business rules** (calculations, validation, decisions) → plain TS
  functions/modules, no React imports, testable without rendering.
- **Orchestration** (state + effects + calling services) → custom hooks named
  by use-case (`useReviewRun`), not mechanism (`useFetch`).
- **I/O** (HTTP, storage) → api/service modules per feature; hooks call them.
- **Components** → mostly JSX; call one hook, render.
- Container/Presentational as a component pair is obsolete (Abramov's own
  retraction) — the hook IS the container now.
- Server state ≠ client state: server data lives in the TanStack Query cache
  (wrapped in feature hooks that own the query keys), never copied into
  `useState`.

Details: `references/business-logic.md`

## Component splitting

- Split along the UI/data hierarchy: one component ≈ one concern (Thinking in
  React). But don't split preemptively — split on a real trigger: reuse,
  state complexity, testing, mutually-exclusive UI states.
- "Duplication is far cheaper than the wrong abstraction." A big component
  beats a premature abstraction with prop drilling. (Dodds/Metz)
- Split by state, not by condition: early return per UI state
  (pending/error/empty/data) instead of stacked ternaries; extract shared
  layout as a `children`-accepting component. (TkDodo)
- Composition over configuration: children/slots and compound components over
  prop-bag APIs; pass composed components as props to kill prop drilling.

Details: `references/business-logic.md`

## Next.js App Router organization

- `app/` = routing layer. Recommended hybrid (official "strategy c"):
  globally shared code outside `app/` (or in `src/`), route-specific code
  colocated in the segment — `_components/` (+ optionally `_lib/` with
  loaders, actions, services, schemas).
- Private folders `_folder` opt out of routing; route groups `(group)` organize
  sections/layouts without affecting URLs. Pick ONE strategy, stay consistent.
- Server/client boundary is an architectural decision: default to Server
  Components, push `"use client"` to small leaf islands, pass Server
  Components through client shells as `children`, put context providers as
  deep as possible, guard server modules with `import 'server-only'`.
- Server Actions: colocated `actions.ts` per route/feature; action = thin
  layer (validate → call service → revalidate); treat every action as a
  public untrusted endpoint.

Details: `references/nextjs-organization.md`

## Constants, utils, types

- **Constants:** colocate with the feature; a single small app-wide
  `constants.ts`/`config/` only for genuinely global values (env config,
  design tokens, route paths). UPPER_SNAKE_CASE only for deeply-immutable
  module-level constants. Prefer `as const` objects over enums by default.
- **utils vs lib:** `utils` = pure, project-agnostic functions (`clamp`);
  domain-aware "utils" are feature code — move them into the feature.
  `lib` = configured adapters over third-party deps (axios instance, query
  client). No junk-drawer `utils.ts`.
- **Types:** colocate with usage; global `types/` only for cross-cutting base
  types. API contracts: zod schema is the single source of truth, types via
  `z.infer` — schema colocated with the fetcher.
- **Imports:** one alias (`@/* → ./src/*`), no relative `../../..` climbing.

Details: `references/conventions.md`

## Enforcement

Architecture that isn't lint-enforced erodes. Minimum set (bulletproof-react):

- `import/no-restricted-paths` — two zone groups: (1) each feature cannot
  import other features; (2) shared layer cannot import from `features/` or
  `app/`, features cannot import from `app/`.
- `import/no-cycle` — guards against barrel-induced circular imports.
- Heavier options: `eslint-plugin-boundaries` (declarative layer matrices),
  FSD's `steiger` linter.

Config examples: `references/conventions.md`
