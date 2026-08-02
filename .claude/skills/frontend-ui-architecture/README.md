# frontend-ui-architecture

**Version 1.0.0** · 2026-07-31

Claude Code skill: React/Next.js frontend **architecture and code
organization** — where components, hooks, business logic, constants, utils,
and types live; how to layer logic; how to enforce import boundaries.

Deliberately scoped to avoid overlap with sibling skills:
`react-best-practices` (hook semantics, state anti-patterns, performance) and
`next-best-practices` (RSC runtime/data patterns, file conventions).

## Files

| File | Contents |
|---|---|
| `SKILL.md` | Core principles + decision guides (entry point) |
| `references/folder-structure.md` | Feature-based vs type-based, colocation, bulletproof-react, barrels, Atomic Design, FSD |
| `references/business-logic.md` | view → hook → service → domain layering, component splitting, state placement |
| `references/nextjs-organization.md` | App Router organization, server/client boundary, data fetching placement, Server Actions |
| `references/conventions.md` | Constants, utils/helpers/lib, types, path aliases, ESLint enforcement |

## Sources

All content in this skill is compiled from the sources below (researched
2026-07-31). Items marked `*` were verified to exist via search but not fully
fetched during research.

### Official documentation

- [Thinking in React](https://react.dev/learn/thinking-in-react) — React docs. Canonical component decomposition, minimal state, one-way data flow.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — React docs. Separating derived data, event logic, and true external-system effects.
- [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — React docs. Custom hooks as the logic-extraction mechanism; naming rules.
- [File Structure (FAQ)](https://legacy.reactjs.org/docs/faq-structure.html) — React legacy docs. The official neutral baseline: feature vs type grouping, max 3–4 nesting levels, "don't overthink it."
- [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) — Next.js docs. The canonical page: colocation safety, `_folder`, `(group)`, `src/`, the three organization strategies.
- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — Next.js docs. Boundary semantics, client islands, children interleaving, providers-deep, `server-only`.
- [Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data) — Next.js docs. Where fetching belongs; `React.cache` sharing; client-side secondary path.
- [Authentication guide](https://nextjs.org/docs/app/guides/authentication) — Next.js docs. The DAL + DTO pattern; why auth doesn't belong in layouts/middleware.
- [Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions) — Next.js docs. `actions.ts` organization, actions-as-public-endpoints security model.
- [Data Security](https://nextjs.org/docs/app/guides/data-security)\* — Next.js docs. Companion guide for DAL and action security.
- [How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — Sebastian Markbåge (Vercel/React core). Origin of the DAL recommendation; three data-handling models.
- [Enums → Objects vs Enums](https://www.typescriptlang.org/docs/handbook/enums.html) — TypeScript Handbook. "You may not need an enum when an object with `as const` could suffice."
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) — Google. CONSTANT_CASE only for deeply-immutable module-level constants.

### Reference architectures

- [bulletproof-react: Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — Alan Alickovic. The de-facto reference: features layout, unidirectional shared→features→app imports.
- [bulletproof-react: Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) — `@/*` aliases, ESLint + file-naming enforcement.
- [bulletproof-react: Components and Styling](https://github.com/alan2207/bulletproof-react/blob/master/docs/components-and-styling.md) — colocation, no nested render functions, props limits.
- [bulletproof-react: reference ESLint config](https://github.com/alan2207/bulletproof-react/blob/master/apps/react-vite/.eslintrc.cjs) — the actual `import/no-restricted-paths` zones.
- [Feature-Sliced Design: Overview](https://feature-sliced.github.io/documentation/docs/get-started/overview) — FSD docs. Layer/slice/segment model, downward-only import rule.
- [Feature-Sliced Design: Layers](https://fsd.how/docs/reference/layers) — FSD docs. Shared-layer segments; "lib is not helpers/utilities"; which layers are skippable.
- [The Ultimate Next.js App Router Architecture](https://feature-sliced.design/blog/nextjs-app-router-guide) — FSD blog (2026). FSD layers mapped to App Router; `app/` as thin routing runtime.
- [Atomic Design Methodology](https://atomicdesign.bradfrost.com/chapter-2/)\* — Brad Frost. Primary source for what Atomic Design prescribes.

### Practitioner articles

- [Colocation](https://kentcdodds.com/blog/colocation) — Kent C. Dodds. The foundational "place code as close to where it's relevant as possible."
- [State Colocation Will Make Your React App Faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — Kent C. Dodds. State at the lowest point; push state back down.
- [Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react) — Kent C. Dodds. Lifting/colocation, composition + context before libraries, server-cache vs UI-state.
- [When to Break Up a Component](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — Kent C. Dodds. Concrete split triggers; cost of the wrong abstraction.
- [Compound Components with React Hooks](https://kentcdodds.com/blog/compound-components-with-react-hooks) — Kent C. Dodds. Composition-over-configuration API design.
- [Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files) — Dominik Dorfmeister (TkDodo). The definitive case against app-internal barrels (−68% module count).
- [Practical React Query](https://tkdodo.eu/blog/practical-react-query) — TkDodo. Server state as borrowed data; wrap queries in feature hooks.
- [React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager) — TkDodo. Server cache is global async state; kills container-for-data-passing.
- [Component Composition Is Great Btw](https://tkdodo.eu/blog/component-composition-is-great-btw) — TkDodo (2024). Split by state, not by condition; early returns per UI state.
- [Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) — Dan Abramov. Primary source for the pattern AND his 2019 retraction.
- [Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) — patterns.dev. Modern assessment: hooks superseded the pattern.
- [Modularizing React Applications with Established UI Patterns](https://martinfowler.com/articles/modularizing-react-apps.html) — Juntao Qiu on martinfowler.com. The view → hook → service → domain layering.
- [Headless Component](https://martinfowler.com/articles/headless-component.html) — Juntao Qiu on martinfowler.com. The headless-pattern writeup (React ARIA, Downshift).
- [Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) — Josh Comeau. The best-argued function-over-feature dissent; utils vs helpers distinction; `constants.ts` scope.
- [React Folder Structure Best Practices [2026]](https://www.robinwieruch.de/react-folder-structure/) — Robin Wieruch. Evolution stages; promote-on-second-consumer rule; unidirectional flow.
- [Feature-based React Architecture](https://www.robinwieruch.de/react-feature-architecture/) — Robin Wieruch (2024). Feature folders for RSC apps: per-feature components + queries.
- [Tao of React](https://alexkondov.com/tao-of-react/)\* — Alex Kondov. "Group by route/module from the start"; type-grouping as anti-pattern. (Site blocks automated fetching; widely cited.)
- [Popular React Folder Structures and Screaming Architecture](https://profy.dev/article/react-folder-structure)\* — Johannes Kettmann (profy.dev). Structures at growing scale; screaming architecture for React.
- [Screaming Architecture — Evolution of a React folder structure](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25)\* — Johannes Kettmann. Migrating from technical folders to feature folders.
- [Next.js App Router Project Structure: The Definitive Guide](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) — Makerkit (2024). Production `_components` + `_lib` (loader/actions/service/schema) pattern; thin actions.
- [How to structure scalable Next.js project architecture](https://blog.logrocket.com/structure-scalable-next-js-project-architecture/)\* — LogRocket. `src/`, route groups, scalable layouts.
- [Inside the App Router: Best Practices (2025 Edition)](https://medium.com/better-dev-nextjs-react/inside-the-app-router-best-practices-for-next-js-file-and-directory-structure-2025-edition-ed6bc14a8da3)\* — Melvin Prince. Hybrid feature+colocation; dumping-ground warning.
- [How to Build a Professional React Project Structure in 2025](https://www.netguru.com/blog/react-project-structure)\* — Netguru. Feature-based preference; consistency over dogma.
- [Atomic Design and its relevance in frontend in 2025](https://dev.to/m_midas/atomic-design-and-its-relevance-in-frontend-in-2025-32e9) — m_midas. Why Atomic Design lost favor for apps.
- [Stop Trusting Your API: Bulletproof Frontend with Zod and React Query](https://joshkaramuth.com/blog/tanstack-zod-dto/)\* — Josh Karamuth. Zod schema as single source of truth; `z.infer` with TanStack Query.
- [Stop blindly replacing enum with as const](https://dev.to/kelvynthai/stop-blindly-replacing-enum-with-as-const-56o8)\* — Kelvyn Thai (2026). When enums still beat `as const`.
- [How to Replace Barrel Files with Better Import Strategies](https://jsdev.space/howto/stop-using-barrel-files/)\* — jsdev.space. Practical barrel-removal migration.

### Tooling

- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)\* — Javier Brea. Declarative layer/element dependency matrices for enforcing architecture.

## Changelog

- **1.0.0** (2026-07-31) — initial version, compiled from 4-track deep
  research (folder structure · business-logic layering · Next.js App Router
  organization · shared-code conventions).
