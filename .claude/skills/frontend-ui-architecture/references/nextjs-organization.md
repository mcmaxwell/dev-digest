# Next.js App Router — project organization

## What's safe where (official docs)

- Next.js is deliberately unopinionated, but a route becomes public only when
  `page.tsx`/`route.ts` exists — so **colocating project files inside route
  segments is safe by default**.
- **Private folders** `_folder`: opt a folder (and subfolders) out of routing.
  Not required for colocation, but recommended to separate UI logic from
  routing logic and to avoid collisions with future Next.js file conventions.
- **Route groups** `(group)`: organize routes without affecting URLs — split
  by section (`(marketing)`, `(shop)`), opt route subsets into a layout,
  scope a `loading.tsx`, or create multiple root layouts.
- `src/` directory: optional; separates app code from root config.

## Three sanctioned strategies — pick ONE, stay consistent

1. All project files outside `app/` (app = pure routing).
2. Top-level shared folders inside `app/`.
3. **Hybrid (the common recommendation):** globally shared code at the root
   (or `src/`), route-specific code colocated in the segment that uses it.

Recommended hybrid in practice:

```
src/components/           # global reusable UI
src/lib/ (or features/)   # shared logic
app/
  (group)/
    dashboard/
      page.tsx
      _components/        # route-specific components
      _lib/               # route-specific logic:
        x.loader.ts       #   server data fetching (React cache())
        x.actions.ts      #   Server Actions ('use server')
        x.service.ts      #   testable business logic
        x.schema.ts       #   zod schemas shared by actions/services
```

(The `_lib` breakdown is Makerkit's production SaaS pattern.)

- Anti-pattern: global `components/`/`utils/` as dumping grounds — as the app
  grows, prefer feature folders (`app/` = routing only, `src/features/*` =
  business code; Robin Wieruch's model, and FSD's "app/ as thin routing
  runtime re-exporting from src/pages").
- Promotion rule applies: route-local until a second route needs it.

## Server/client boundary as architecture

- Layouts and pages are Server Components by default. Add `"use client"` to
  small interactive **leaf islands**, not large UI regions — a layout stays
  server while only the `<Search />` inside it is client.
- `"use client"` marks a module-graph boundary: everything the client file
  imports joins the client bundle. One directive at the top of an island
  covers its subtree — don't sprinkle it everywhere.
- **Interleaving**: Server Components passed as `children`/props to a Client
  Component still render on the server — the sanctioned way to keep server
  rendering inside client shells (`<ClientModal><ServerCart/></ClientModal>`).
- Context providers must be client — render them as deep as possible (wrap
  `{children}`, not `<html>`).
- Wrap third-party client-only components in your own one-line `"use client"`
  re-export file.
- Poisoning prevention: `import 'server-only'` in server modules → build-time
  error if a Client Component imports them (`client-only` for the inverse).
- FSD phrasing of the discipline: "Server Components own data reads and
  composition; Client Components own interactivity and local UI state."

## Where data fetching lives

- Default: fetch in Server Components (via `fetch` or ORM/DB client directly).
  Identical `fetch` calls are memoized per render pass — fetch in the
  component that needs the data instead of prop-drilling.
- Do NOT call your own Route Handlers from Server Components — query the
  source directly. Route Handlers are for client-initiated requests and
  external consumers.
- Client-side fetching is the secondary path: React `use()` under
  `<Suspense>`, or SWR/TanStack Query for interactive client data.
- Share request-scoped data via `React.cache()`-wrapped functions, not
  prop-drilling or refetching.
- **DAL (data access layer)** — Vercel's recommendation for new projects
  where Next.js is the backend: all data access + authorization in one
  `server-only` internal library; every function takes the current user and
  authorizes before returning; return DTOs with client-safe fields only;
  only the DAL reads `process.env`; memoize `verifySession()` with
  `React.cache()`. Auth checks belong close to the data (DAL), NOT in
  layouts (they don't re-render on partial navigation); middleware is only an
  optimistic cookie pre-filter.
- Three data-handling models (Markbåge): HTTP APIs (existing orgs / separate
  backend), DAL (new Next-as-backend projects), component-level DB access
  (prototypes only). Pick one, don't mix.
  - Note for dev-digest: the client talks to a separate Fastify API — that's
    the "HTTP APIs" model; the in-process DAL guidance doesn't apply here.

## Server Actions organization

- Dedicated `actions.ts` files with file-level `'use server'`, colocated per
  route or feature (`app/posts/actions.ts`); inline `'use server'` closures
  only for one-offs.
- Keep actions thin: validate input → call service → revalidate. "Longer than
  20 lines = doing too much" (Makerkit). Business logic goes in a colocated,
  framework-free service file.
- Treat every action as a **public untrusted POST endpoint**: authenticate and
  authorize inside the action; zod validates shape only — still re-check
  ownership from the session; pass IDs, not whole objects; return only what
  the UI renders.
- Actions dispatch sequentially per client — don't design UI that relies on
  parallel action calls.
