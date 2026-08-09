# Insights — client

Append-only lessons specific to this package, kept in fixed sections — append
into the matching one, never rewrite old entries. Cross-cutting lessons go to
the root INSIGHTS.md. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

- [2026-07-31] To fix a `useState(agent.x)` derived-state-from-props reset
  effect (stale-frame flash on prop-id change), prefer `key={agent.id}` at the
  call site over an effect that re-syncs every field — see
  `AgentEditor.tsx` → `<ConfigTab key={agent.id} .../>` and the deleted reset
  effect in `ConfigTab.tsx`. Remount replaces N `useEffect(() => setX(...), [id])`
  lines with one prop.
- [2026-07-31] Hoisting `AppShell` (nav/shortcuts/command-palette) out of a
  page and into a segment `layout.tsx` works, but the layout can't read the
  page's `crumb` prop directly — bridge it with a small client context
  (`src/lib/shell-crumb.tsx`: `CrumbProvider` + `useSetCrumb`). The layout
  renders `<AppShell crumb={ctx.crumb}>`, pages call `useSetCrumb(crumb)`
  instead of rendering `<AppShell>` themselves. Wired for
  `repos/[repoId]/pulls/`, `agents/`, `settings/` (each got its own
  `layout.tsx` using the shared `ShellLayout` component in
  `components/app-shell/`) — `/` (home) and `/onboarding` were NOT hoisted
  since they sit as siblings directly under `src/app/`, so a root layout would
  wrap onboarding too; that needs route groups (not done — bigger/riskier
  diff for a nav-remount perf nit).

## What Doesn't Work

- [2026-07-31] Don't reuse `AppShell`/`AppFrame` itself as a root `<Suspense>`
  fallback. `AppFrame` requires `ShellContext` from `Providers`
  (Theme/Repo/QueryClient), and a Suspense fallback renders in place of — not
  nested inside — the tree that suspended, so `Providers` isn't mounted yet
  either. Build a fully static, provider-free approximation instead (see
  `AppShellSkeleton.tsx`: hardcoded sidebar/topbar dimensions, no data).

- [2026-07-31] Anything the ROOT `layout.tsx` reaches WITHOUT crossing a
  `"use client"` boundary is evaluated during SSR for every route — so a
  server-rendered Suspense fallback must import nothing heavy. Importing the
  `@devdigest/ui` barrel from `AppShellSkeleton.tsx` dragged in
  `vendor/ui/charts/LineChart.tsx` (recharts, not RSC-safe) and every page 500'd
  with `TypeError: Super expression must either be null or a function`. Keep
  that component's markup inline (inline SVG instead of `<Icon.*>`, plain divs
  instead of `<Skeleton>`). NOTE: `pnpm build` did NOT catch this — only
  `./scripts/e2e.sh` (real dev server) did, so run e2e after touching the root
  layout or anything it imports.

- [2026-08-04] Don't key a "fetch server draft → setState form fields" effect on
  an array the parent derives inline (`acceptedOf(candidates)` returns a new
  identity every render): any unrelated parent re-render (poll tick, toast)
  re-fires the effect and the re-fetched draft silently overwrites everything
  the user already typed. Key the effect on a joined-id STRING and memoize the
  parent derivation — see `CreateSkillFromConventionsModal.tsx` (`idsKey`),
  regression-tested by "requests the skill draft once" in
  `ConventionsView.test.tsx`.

## Codebase Patterns

- [2026-08-07] A control that TWO sibling features under the same `_components/`
  both render must be promoted to their common ancestor's `_components/`, not
  imported across — `pnpm lint`'s `no-restricted-imports` rejects
  `../SmartDiffViewer/_components/OrderToggle` with "Don't import a sibling
  feature's _components", and `pnpm typecheck` passes happily, so this only
  surfaces at lint. Move the component's `constants.ts`/`styles.ts` with it;
  leaving them behind just re-creates the same cross-import one file down.
  (`DiffTab` + `SmartDiffViewer` both needed the Smart/Original toggle →
  `pulls/[number]/_components/OrderToggle/`.)
- [2026-08-07] To give a shared `src/components/**` component a new capability
  for one caller, add OPTIONAL props and keep the old default — never fork it.
  `FileCard` gained `defaultOpen?` (overriding, not replacing, its
  `AUTO_EXPAND_MAX_LINES` heuristic) and `flags?: ReadonlyMap<number, Severity>`;
  `CodeLine` gained `flag?`. Every existing `DiffViewer` call site kept
  compiling and rendering identically, and the two viewers cannot drift because
  there is still one implementation. Export the inner piece from the package
  barrel (`diff-viewer/index.ts` now exports `FileCard`) rather than letting the
  new caller deep-import it.
- [2026-08-02] Adding a top-level page to the sidebar REQUIRES editing vendored
  `src/vendor/ui/nav.ts` (`Sidebar.tsx` renders the `NAV` const directly; there is
  no app-side extension point) — the one sanctioned exception to the vendored-UI
  freeze, data-only. Everything else is automatic once the entry exists: g-nav
  (`useGlobalShortcuts` scans `NAV[].gKey`), the command palette
  (`useShellCommands` + `shell.json` `nav.<key>` label), and the active-key branch
  in `app-shell/helpers.ts` (most keys are pre-wired there already).
  - [2026-08-02] Confirmed adding `/conventions`: only `nav.ts` needed the entry
    (plus its `SHORTCUTS` row for the `?` overlay); `activeKeyFor` already
    branched on `"conventions"` and `shell.json` already had `nav.conventions`.
    The design system ships these keys AHEAD of the lessons — grep
    `helpers.ts`/`shell.json` for your key before writing any wiring.
- [2026-08-02] A repo-scoped page that lives at a NON-repo URL (`/conventions`,
  not `/repos/:id/…`) reads the repo from `useActiveRepo()` and must render a
  "pick a repository" empty state for `activeRepo === null` — the sidebar
  switcher legitimately starts empty on a fresh profile, and the repo-scoped
  hook would otherwise fire with `undefined` in the path
  (`app/conventions/_components/ConventionsView`).
- [2026-08-02] For a list the user works through item by item (accept/reject),
  patch the mutated row into the cache with `qc.setQueryData` instead of
  `invalidateQueries` — an invalidate re-sorts the list under the cursor mid-pass
  and the next card jumps away. See `useUpdateConvention` in
  `lib/hooks/conventions.ts` vs `useUpdateSkill` (which may invalidate freely
  because its grid is name-sorted and stable).
- [2026-07-28] `e2e/specs/04-pr-findings.flow.json` asserts the literal
  substring "2 findings" in the ReviewRunAccordion header — when changing that
  header, APPEND after the `N findings` prefix (as the severity breakdown
  does), never replace it, or the e2e flow breaks.

- [2026-08-07] The run-trace drawer's prompt-assembly section enumerates every
  slot BY HAND (`RunTraceDrawer/_components/TraceBody/TraceBody.tsx:75-100`), so
  adding a field to `PromptAssembly` in `vendor/shared` shows up in the API and
  in the DB but is INVISIBLE in the UI until you add a `<PromptBlock>` there plus
  a colour in `RunTraceDrawer/constants.ts` and a `trace.prompt.*` string in
  `messages/en/runs.json`. Typecheck cannot catch the omission. (`pr_description`
  has been in the contract since A2 and still has no block — that is the failure
  mode, not a deliberate choice.)

## Tool & Library Notes

- [2026-07-31] Every route under `src/app` is a whole-page `"use client"`
  component reading `useSearchParams` directly (no per-hook Suspense
  boundaries), so Next 15 requires a Suspense boundary somewhere above all of
  them — the app satisfies this with ONE boundary at the root
  (`layout.tsx`, wrapping `<Providers>{children}</Providers>`). Consequence:
  whichever fallback that boundary has is the SSR'd HTML for literally every
  route's first paint (it was `fallback={null}` → every route shipped
  completely blank HTML pre-hydration). If you add a genuinely new
  `useSearchParams` usage, it's still covered by this same boundary — no new
  Suspense needed unless you want a *narrower* fallback for just that route.
- [2026-07-31] `next/font/google`'s generated `.className` (e.g.
  `inter.className` applied to `<body>`) wins over `vendor/ui/styles.css`'s
  `body { font-family: "Inter", ... }` element selector purely on CSS
  specificity (class > element) — safe to layer `next/font` on top of that
  vendored rule without editing vendor/ui; no need to match variable names.

- [2026-07-31] `eslint-config-next@15` still ships `@rushstack/eslint-patch`,
  which throws `Failed to patch ESLint because the calling module was not
  recognized` under ESLint 9 flat config — so `eslint.config.mjs` here does NOT
  extend it. Boundaries + `react-hooks` are configured directly against
  `typescript-eslint`'s parser; Next's own checks come from `next build`.
- [2026-07-31] The feature-isolation lint rule must distinguish a SIBLING
  feature's `_components` (forbidden) from an ANCESTOR segment's (the
  sanctioned way to share, e.g. `RunHistory.tsx` → `../../../_components/
  FindingsPopover`). A glob can't tell them apart because `*` also matches
  `..`; `no-restricted-imports` with a `regex` pattern
  (`(^|/)(?!\.\.?/)[^/]+/_components/`) can — it only fires when a NAMED
  segment precedes `_components`. Corollary: never rewrite an intra-`src/app`
  relative import to the `@/` alias, since `@/app/…/_components/…` then reads
  as a sibling import and trips the rule.

## Recurring Errors & Fixes

- [2026-08-05] "invariant expected app router to be mounted" in a jsdom test
  means a component under test (or a CHILD of it) calls `next/navigation`'s
  `useRouter` — there is no global mock in `src/test/setup.ts`, so the test
  file needs `vi.mock("next/navigation", () => ({ useRouter: () => ({ push:
  vi.fn(), replace: vi.fn() }) }))`. Watch the blast radius: adding navigation
  to a shared child (SkillPreviewDrawer's "Open editor" button) broke the
  OTHER feature's existing suite (`SkillsView.test.tsx`), not the new one.

- [2026-07-31] A `useRef` flag that's set `true` on one condition and read
  (but never reset) on another, inside a `useEffect` keyed on a prop callback,
  causes a call-storm if that callback prop is an unmemoized inline arrow from
  the parent: the effect re-fires on every parent re-render (new callback
  identity) and, since the ref is still `true`, calls the callback again —
  which (if the callback invalidates queries / triggers state) causes the very
  re-render that produces the next new identity. Fix at both ends: reset the
  ref inside the branch that consumes it (`RunStatus.tsx`'s `wasRunning.current
  = false` right before calling `onDone()`), AND wrap the callback in
  `useCallback` at its source (`page.tsx`'s `handleRunDone`). Either alone is a
  partial fix; both together close it for good.

## Session Notes

## Open Questions
