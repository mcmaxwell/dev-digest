# @devdigest/web — Next.js 15 studio (:3000)

UI for repos, PRs, reviews, agents. App Router + React 19; all data via
TanStack Query hooks over the Fastify API (`NEXT_PUBLIC_API_BASE`, default
`http://localhost:3001`).

## Commands

```sh
pnpm dev         # :3000
pnpm test        # vitest + jsdom, fetch mocked — no API needed
pnpm typecheck
pnpm lint        # architecture boundaries + react-hooks (eslint.config.mjs)
```

## Mini-map

```
src/app/**/page.tsx        routes: / · /repos/:id/pulls · /pulls/:number ·
                           /agents(/:id) · /settings/:section · /onboarding
src/app/**/_components/    feature logic, colocated with its *.test.tsx
src/components/app-shell/  nav, breadcrumbs, g-then-key shortcuts
src/lib/api.ts             API base + fetch layer
src/lib/hooks/*            EVERY data hook lives here
src/vendor/ui/             vendored @devdigest/ui — do not edit
src/vendor/shared/         client's COPY of @devdigest/shared contracts
messages/<locale>/*.json   next-intl strings — no hardcoded UI text
```

## Conventions

- Pages stay thin; feature logic goes in a colocated `_components/<Name>/`
  folder with its own `*.test.tsx`.
- Data access only through `src/lib/hooks/*` → `src/lib/api.ts` — no raw fetch
  in components. Query KEYS belong to the hook file too (see `reviewsKeys` in
  `lib/hooks/reviews.ts`); never hand-write a key in a component.
- User-facing strings go through next-intl (`messages/<locale>/*.json`).
- Cross-folder imports use the `@/` alias; imports INSIDE `src/app` stay
  relative. One feature must not import a sibling feature's `_components` —
  promote the shared piece to the nearest common ancestor segment (that
  ancestor import stays relative) or to `src/components/`. `pnpm lint` enforces
  this, plus layer direction (`lib` ⇍ `components` ⇍ `app`) and no cycles.

## Gotchas

- `src/vendor/shared` is a COPY — the canonical contracts live in
  `../server/src/vendor/shared`. A contract change must land in both.
- Component tests mock fetch (jsdom); real browser journeys belong to
  `../e2e` flows, not vitest.

## Read when…

- …route map / which API each screen calls → `README.md`
- …contract shapes → `src/vendor/shared` (and keep the server copy in sync)
- …tests → `../TESTING.md`; browser flows → `../e2e/README.md`
- …before starting a task here → `INSIGHTS.md`; specs → `specs/`
