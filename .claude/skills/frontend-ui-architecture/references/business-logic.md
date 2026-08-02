# Business logic placement & component design

## The layered model (Fowler/Qiu — "Modularizing React Applications")

```
view (component, mostly JSX)
  → custom hook (state + side-effect orchestration)
    → service / api client (network, external systems)
      → domain model / pure functions (business rules)
```

- **Pure business rules** (calculations, validation, formatting, decisions):
  plain functions/domain objects with no React or UI awareness — testable
  without rendering. Hooks orchestrate; they don't compute business rules
  inline.
- **Custom hooks** are the canonical logic layer (react.dev): "Custom Hooks
  let you share stateful logic but not state itself." Extract a hook whenever
  an Effect appears in a component. Name hooks after purpose
  (`useChatRoom`, `useReviewRun`), not mechanism (`useEventListener`); avoid
  generic lifecycle hooks (`useMount`). "The code of your components
  expresses your intent, not the implementation."
- **Services/API clients**: network and external-system access lives in api
  modules (bulletproof-react: `features/*/api` — request schema + inferred
  type + fetcher + query hook in one file, contract colocated with the call
  site).

## Container/Presentational: obsolete as a component pattern

- Dan Abramov's note added to his own original article (2019): "I don't
  suggest splitting your components like this anymore… I've seen it enforced
  without any necessity and with almost dogmatic fervor far too many times."
- Hooks replaced the mechanism: a component calls a custom hook and stays
  presentational by construction — no wrapper-component layer
  (patterns.dev).
- React Query removes the data-passing rationale too: `useQuery` hooks can be
  called anywhere in the tree (cache dedupes), so container/presenter splits
  purely for passing data down are unnecessary (TkDodo).
- The *idea* (separate logic from looks) survives — as hooks and headless
  components.

## Headless components (Fowler/Qiu)

- A hook (or context/render-prop) owns state, keyboard handling, a11y, and
  events; consumers own 100% of the markup (e.g. `useDropdown`).
- Production examples: React ARIA, Headless UI, Downshift, TanStack Table.
- Use for reusable interactive primitives; over-engineering for simple
  one-off components.

## When to split a component

- Start from the UI/data hierarchy: one component ≈ one concern ≈ one piece
  of the data model; extract a child when a part grows complex (Thinking in
  React).
- Don't split preemptively (Kent C. Dodds, "When to Break Up a Component"):
  split on a real trigger — re-render scope, reuse, state complexity,
  testing, collaboration, wrapping third-party/imperative code. "Duplication
  is far cheaper than the wrong abstraction" (Sandi Metz). A large component
  is cheaper to maintain than a premature abstraction with prop drilling.
- **Split by state, not by condition** (TkDodo, "Component Composition Is
  Great Btw"): when a component represents mutually exclusive states
  (pending/empty/error/data), use early returns per state instead of stacked
  ternaries and conditional props. Extract shared layout into a
  `children`-accepting component and accept small duplication across branches
  — clarity of "what does the user see in state X" beats DRY. Growing
  combinations of boolean props signal wrong component boundaries.
- **Composition over configuration**: nested declarative children over
  prop-bag APIs. Compound components (the `<select>`/`<option>` model) share
  implicit state via context + hooks (Kent C. Dodds). Pass composed
  components as props/`children` to eliminate prop drilling through
  intermediate layers.

## State placement

- Colocate state at the lowest point in the tree where it's used; lift only
  to the closest common parent when actually shared; regularly push state
  back down (Kent C. Dodds, "State Colocation").
- Lifting state + composition + context + custom hooks cover most needs
  before reaching for a state library — "React is a state management
  library" (Dodds).
- Minimal state (Thinking in React): store only what can't be computed and
  isn't passed as props; derive the rest during render.
- Effects are for synchronizing with external systems ONLY (You Might Not
  Need an Effect): derived data → compute in render; user-triggered logic →
  event handlers; state reset on prop change → `key`; data fetching → a
  library or framework loader, raw Effects last resort.

## Server state ≠ client state (TkDodo)

- Server data is *borrowed* — a snapshot owned by the backend, with its own
  problem set (staleness, revalidation, dedup). Client state (modals, form
  inputs) is *owned*. Different tools: TanStack Query/SWR vs
  `useState`/`useReducer`/Zustand.
- Never copy server data into local state — it forks the source of truth and
  disables background updates.
- Wrap `useQuery` in feature-level custom hooks that centralize query keys,
  types, and config; components consume the hook, not the query directly.
