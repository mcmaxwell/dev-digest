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
  `components/app-shell/`) — `/` (home) and the add-repository screen were NOT
  hoisted since they sit as siblings directly under `src/app/`, so a root
  layout would wrap the add-repo screen too; that needs route groups (not done
  — bigger/riskier diff for a nav-remount perf nit).
  - [2026-08-13] L06 moved the add-repository screen from `/onboarding` to
    `/repos/new` and gave `/repos/:repoId/onboarding` to the Onboarding Tour,
    which DOES get a `layout.tsx` mounting `ShellLayout`. So "`/onboarding` is
    deliberately outside the shell" is no longer the whole truth: the shell-less
    screen is `/repos/new`, and it is still a direct sibling under `src/app/`
    for the same reason.

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

- [2026-08-13] Adding an editor tab is THREE edits, not two: the `TABS` array in
  the editor's `constants.ts`, the conditional branch in `<XEditor>`, AND the
  `VALID_TABS` allowlist in the ROUTE PAGE (`app/agents/[id]/page.tsx:16`,
  `app/skills/[id]/page.tsx:15`), which normalises any unlisted `?tab=` value
  back to `"config"`. Miss the third and the tab renders in the bar, sets the
  query param, and then silently shows the Config tab — typecheck, lint and the
  component test all pass, because the component test renders `<XEditor>` with
  `tab` as a prop and never goes through the page. Only `./scripts/e2e.sh`
  caught it (L05's Context tab).
  - [2026-08-31] It happened a SECOND time, to L06's CI tab, with this entry
    already written. Documenting a duplication does not stop it; deleting the
    duplication does. `VALID_TABS` is now DERIVED - `TABS.map((t) => t.key)` -
    and lives in `AgentEditor/constants.ts` next to TABS, not in the page,
    because a Next App Router `page.tsx` may export nothing but the route
    contract (exporting a const from it fails typecheck with "Property
    'VALID_TABS' is incompatible with index signature ... not assignable to
    type 'never'" in `.next/types/app/.../page.ts`). `AgentEditor.test.tsx`
    pins `VALID_TABS` against `TABS`. NOT yet done for the skills editor:
    `app/skills/[id]/page.tsx` still hand-writes its allowlist and is the one
    remaining instance of this trap.

- [2026-08-14] A fixture whose ARRAY ORDER was written to match what the
  component happens to render is a test that cannot fail. `PrBriefCard.test.tsx`
  asserted "the brief history renders newest first" against a `commits` fixture
  hand-ordered newest-first, so it passed against a `BriefHistory` that simply
  mapped the prop in place — and production, which is oldest-first, rendered the
  oldest brief at the top. For any assertion about ORDER, copy the fixture's
  order from the PRODUCER (here `adapters/github/octokit.ts`, which returns
  `pulls.listCommits` untouched), never from the consumer, then confirm the
  assertion goes red before fixing the component.

## Codebase Patterns

- [2026-08-14] The order of a PR's `commits` array is not a contract anywhere in
  this stack: GitHub returns `pulls.listCommits` oldest-first,
  `adapters/github/octokit.ts` neither reverses nor sorts it, and
  `pulls/repository.ts#getCommits` has no `orderBy` at all. Any surface that
  needs a particular order must establish it itself (`RunHistory.tsx` sorts by
  `ts` desc; `PrBriefCard`'s `commitsNewestFirst` does the same). When the sort
  key is nullish — `PrCommit.committed_at` is, and the mock platform returns
  null for every commit — decide it ONCE for the whole list rather than per row:
  a per-row `committed_at ?? somethingElse` fallback sorts the timestamped rows
  into one block and the rest into another, which is exactly the interleaving
  the feature needed (a commit with no brief must keep its place in the
  sequence).

- [2026-08-13] `repoIdFromPath` in `lib/repo-context.tsx` matches
  `^/repos/([^/]+)` with NO exclusion for static segments, so adding any static
  route under `/repos/` makes `useActiveRepo()` report that segment as the
  active repo id — L06's `/repos/new` yields `repoId === "new"` and
  `activeRepo === null`. Harmless there only because the add-repository screen
  renders no `ShellLayout` and reads neither value. Any FUTURE page under
  `/repos/<static>/…` that uses `useActiveRepo` (or any nav href resolving
  `:repoId`) will silently address a repository called `new`; fix it at
  `repoIdFromPath` with a static-segment denylist, not at the call site.
- [2026-08-14] A card that renders SEVERAL sibling lists must give each `<ul>` an
  `aria-label`, or its own test cannot address them and neither can a screen
  reader. `PrBriefCard` renders risks, review focus, prior PRs and the brief
  timeline as four unlabelled `<ul>`s at first, and
  `getByRole("link", { name: … })` then failed with "multiple elements" because
  the same path is legitimately cited by both a risk and a focus entry.
  `getByText(label).parentElement!.parentElement!` is the tempting escape and is
  worse: it encodes the DOM shape, so any wrapper `<div>` added later breaks a
  test that has nothing to do with layout. Label the list, then scope with
  `within(screen.getByRole("list", { name }))`.

- [2026-08-10] Two vendored primitives silently render a `<button>` where a
  caller may not want one, and `src/vendor/ui/**` is frozen, so the workaround
  belongs in the FEATURE: `MonoLink` without an `href` is an inert button with
  `cursor: pointer` (looks clickable, does nothing), and `Chip` is a `<button>`
  even when it is only displaying a number. `CallerRow.tsx` renders a `<span>`
  with a `title` when it has no link target, and `BlastRadiusCard/styles.ts`
  defines its own stat pill instead of using `Chip`. The regression test is
  `getAllByRole("button")` - assert the card's ONLY buttons are the ones that do
  something.

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

- [2026-08-13] To hold a document steady while a background refetch returns new
  content ("don't swap the text under the reader"), keep the shown snapshot in
  `useState` and adjust it DURING RENDER
  (`if (data && current?.path !== data.path) setCurrent(...)` — React's
  "information from previous renders" pattern), never in a `useRef`. A ref makes
  the "not swapping" half work and the "adopt the new version" button a no-op,
  because mutating a ref schedules no re-render — the banner appears and its
  button does nothing. Caught by the client test, not by typecheck
  (`repos/[repoId]/context/.../DocViewer.tsx`).

- [2026-08-26] A `var(--token, 42px)` read with NO definition anywhere is a
  hard-coded value wearing a contract's clothes, and it reads as configurable
  in review, so grep for the definition before believing the comment above it.
  `components/diff-viewer/styles.ts` documented "a page with different chrome
  sets its own offset" via `scrollMarginTop: var(--sticky-header-offset, 132px)`
  and nothing in `client/` ever set that variable - every page silently got the
  PR detail header's height of the day. The rule for sticky chrome: the
  component that OWNS the sticky element publishes its measured height
  (`PrDetailHeader` does this now with a `ResizeObserver` writing the var onto
  `document.documentElement`, cleared on unmount), because the height is never
  a constant - the title wraps, and merged/closed PRs grow a stale banner. A
  shared component must never encode any page's pixel dimensions; the fallback
  is for the no-chrome case only.
- [2026-08-31] A colocated component test that renders with ONLY
  `NextIntlClientProvider` breaks the day its component grows a data hook -
  `useQuery` throws "No QueryClient set". Do NOT wrap the test in a
  `QueryClientProvider`: that turns a render test into a fetch test. Add
  `vi.mock("@/lib/hooks/<file>", ...)` returning the shape the component reads
  (`{ data }`, `{ mutate, isPending }`), which is what `CiTab.test.tsx` and
  `ExportCiWizard.test.tsx` do. The mock must list EVERY hook the component
  imports from that module, or the missing one is `undefined` at call time and
  the failure reads as an unrelated render error.
- [2026-08-31] When two features expose the same agent field (the CI tab and the
  Config tab both write `agents.ci_fail_on`), share the MESSAGE KEYS, not the
  constants module: `no-restricted-imports` forbids reaching into a sibling
  feature's `_components/`, so `CiTab` declares its own four-value list and
  labels the options with `useTranslations("agents")`
  (`config.ciFailOnOptions.*`). One copy of the wording, no cross-feature
  import, and the field itself stays single-sourced because both controls go
  through `useUpdateAgent`.

## Tool & Library Notes

- [2026-08-10] When testing that untrusted text cannot inject into a generated
  SOURCE FORMAT (a mermaid diagram here), `expect(out).not.toContain(payload)`
  is the wrong property and will fail on correct code: an escaped payload
  legitimately survives as inert text inside one quoted label. Assert the SHAPE
  instead - line count, "no line starts with a token the data authored", edge
  count (`toMermaid.test.tsx`). Pair it with synthetic node ids, which is what
  actually makes the injection impossible.

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

- [2026-08-13] jsdom implements neither `Element.prototype.scrollIntoView` nor
  `navigator.clipboard`, so any surface with a "jump to section" control or a
  copy button needs both stubbed in the test file or it throws before the
  assertion: `Element.prototype.scrollIntoView = vi.fn()` and
  `Object.defineProperty(navigator, "clipboard", { value: { writeText },
  configurable: true })` — plain assignment to `navigator.clipboard` is a
  no-op because the property is a getter. `configurable: true` is what lets a
  second test redefine it. Also make the test `async` and `await
  screen.findByRole("button", { name: "Copied" })` after the click: the
  clipboard write is a promise, so the confirmation state lands in a microtask
  and an unawaited click prints an `act(...)` warning
  (`app/repos/[repoId]/onboarding/.../OnboardingTourView.test.tsx`).
  - [2026-08-14] Stubbing it is only half the job when the call is deferred. The
    codebase's "jump to X" controls all wrap the scroll in
    `requestAnimationFrame` so the target's body has mounted
    (`diff-viewer/FileCard`'s `jumpToFirstFinding` and, now, its `focusPath`
    effect), and jsdom runs rAF on a ~16 ms timer — so
    `expect(scrollIntoView).toHaveBeenCalled()` in the same tick fails against
    CORRECT code. Assert it through `await waitFor(...)`. The trap is the
    NEGATIVE case: `expect(...).not.toHaveBeenCalled()` in the same tick passes
    against a broken implementation too, so give it a window it would have fired
    in (`await new Promise(r => setTimeout(r, 50))`) before asserting the
    absence (`components/diff-viewer/DiffViewer/DiffViewer.test.tsx`).

- [2026-08-13] The sidebar's active item carries NO accessible attribute — it
  is `fontWeight`/`background`/an accent bar in `vendor/ui/shell/NavItem.tsx`
  and nothing else — so "the right nav item is highlighted" is NOT assertable
  from an e2e flow (deterministic locators only) or from a rendered-DOM query.
  Assert the seam instead: `activeKeyFor(pathname)` in
  `components/app-shell/helpers.ts` is the single input the highlight derives
  from, and `NAV` from `@devdigest/ui` carries the ordering — see
  `components/app-shell/helpers.test.ts`. Adding `aria-current="page"` to
  `NavItem` would make it observable, but `vendor/ui/**` is frozen except
  `nav.ts` data edits.

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

- [2026-08-28] `client/src/vendor/shared` is a TYPES-ONLY copy in practice: all
  88 existing imports of `@devdigest/shared` are `import type`, which the
  compiler erases. The first RUNTIME value imported from the barrel breaks
  `pnpm build` with a wall of `Module not found: Can't resolve
  './contracts/brief.js'` - Next's webpack does not follow the NodeNext `.js`
  specifiers tsc understands. `pnpm typecheck`, `pnpm lint` and `pnpm test` all
  stay GREEN; only `pnpm build` (and therefore `./scripts/e2e.sh`, which builds)
  catches it, and it surfaces as a 500 on unrelated routes. Cure that needs no
  build-config change: put the runtime values in a contract file that imports
  NOTHING (`contracts/eval-math.ts`) and deep import it -
  `@devdigest/shared/contracts/eval-math` - so webpack resolves exactly one
  module and never enters the barrel.

## Session Notes

- [2026-08-10] L04 Blast Radius card shipped under the Intent card on the PR
  Overview tab: `_components/BlastRadiusCard/` (five states, tree + lazy mermaid
  graph, optional impact summary) and `lib/hooks/blast.ts`. `messages/en/blast.json`
  already existed and was dead - its `stat.*` / `view.*` / `graph.*` keys matched
  the mock exactly, so grepping for a lesson's noun before building remains the
  cheapest first step.

## Open Questions

- [2026-08-14] An `sr-only`/visually-hidden element styled `position: absolute`
  needs a POSITIONED ancestor of its own, or it resolves against the initial
  containing block - the document - and lands at whatever document offset it
  happens to occupy. `CopyButton` rendered its `aria-live` region as a Fragment
  sibling of the button, so three of them sat at document tops 1684/1748/1813
  and stretched `documentElement.scrollHeight` to 1814px against a 577px
  viewport. The page grew an OUTER scrollbar on top of the app shell's internal
  one, so the whole frame scrolled away. Every sibling route keeps
  `docH === winH`; that comparison is the cheap diagnostic.
  jsdom computes no layout, so no component test can see the symptom - assert
  the cause instead (the live region's own parent is positioned).
  Two traps when writing that assertion, both hit here:
  walking up to "some positioned ancestor" passes against the unfixed markup
  because the shell already has positioned ancestors; and jsdom's
  `getComputedStyle().position` returns `""`, not `"static"`, for a property
  never set, so `not.toBe("static")` also passes. Assert an explicit value from
  `["relative","absolute","fixed","sticky"]`, and prove it by reverting the fix.
