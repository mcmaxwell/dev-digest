# Insights — e2e

Append-only lessons specific to this package, kept in fixed sections — append
into the matching one, never rewrite old entries. Cross-cutting lessons go to
the root INSIGHTS.md. Format and quality gates:
`.claude/skills/engineering-insights/SKILL.md`.

## What Works

## What Doesn't Work

- [2026-08-04] `{"cmd": ["click", "--text", "Label"]}` is NOT valid
  agent-browser: `click` takes a SELECTOR (CSS/XPath/`@e1` ref) and has no
  `--text` flag, so the step dies with "Command failed: agent-browser click
  --text …" no matter what the page renders. Clicking by visible label is
  `["find", "role", "button", "click", "--name", "Label", "--exact"]` (or
  `["find", "text", "…", "click"]`) — check `agent-browser <cmd> --help`, and
  never copy a step shape from another framework. `--exact` matters when one
  label is a prefix of another ("Accept" vs "Accepted"). Bit flow
  `08-conventions`, which passed review and only failed on its first CI run.

- [2026-08-13] A flow can never assert the ABSENCE of anything: every step is a
  command whose non-zero exit fails the flow, so there is no "expect this to
  time out". An acceptance criterion phrased as "offers NO generate control" or
  "highlights nothing" therefore belongs to the client suite, and the flow's
  `description` should say which criterion it is NOT carrying and where that
  lives — otherwise the next reader assumes the browser lane covered it
  (`specs/12-onboarding-tour.flow.json`, AC-37's "no Generate control" half).

## Codebase Patterns

- [2026-08-04] A flow that WRITES (accept, dismiss, toggle) must undo itself in
  its last steps and re-assert the pre-state, or it only passes against a
  freshly-seeded DB — `scripts/e2e.sh` reseeds every run, so CI stays green
  while the flow is silently single-use against any persistent stack. Flow
  `08-conventions` accepts a candidate, then closes the modal and clicks
  "Deselect all" before re-asserting "0 of 3 accepted". Prove it by running the
  suite TWICE against one stack (patch `scripts/e2e.sh`'s `(cd e2e && npm test)`
  line into `… && …` and fix `ROOT` if you copy the script elsewhere) — a single
  `e2e.sh` run can never detect this, because teardown hides it.

## Tool & Library Notes

- [2026-08-07] `agent-browser wait --text` matches the RENDERED `innerText`, so
  it sees `text-transform` applied. Any assertion on text inside a
  `SectionLabel` (which uppercases via CSS) must be written UPPERCASE —
  `wait --text "Reviewer-ordered diff"` times out while
  `wait --text "REVIEWER-ORDERED DIFF"` passes, even though the JSX and the
  `messages/en/*.json` string are title-case. Same trap for any `filesCount`-style
  ICU plural rendered inside one (`"FILES CHANGED · 9 FILES"`). Failure looks
  like a missing element, not a case mismatch, so check the CSS before the copy.
- [2026-08-09] A control that has scrolled ABOVE the fold is not reliably
  clickable by `find text|role … click`: agent-browser scrolls it to the top of
  the viewport, where the app's sticky header sits over it, and the click lands
  on the header instead — silently, because the `find … click` step still exits
  0. Symptom: a click step passes but nothing changed, and the failure
  screenshot in `test-results/` shows a header dropdown open. `scroll up 4000`
  first does NOT reliably fix it. Order the flow so controls are exercised while
  they are on screen (assert the toggle before a tab round-trip, not after), and
  when a click step "passes" but the next assertion fails, read the screenshot
  before touching the app — this looked exactly like an app bug and was not one.
- [2026-08-07] Seeded PR metadata and seeded `pr_files` are independent: PR #482
  reports `files_count: 9` but materialises 4 file rows, so a header driven by
  `pr.files_count` says "9 files" above 4 cards. Assert whichever number the
  component actually reads — don't count the rendered cards and assume.
- [2026-08-04] `next dev` is NOT safe to run twice from one directory with
  different `NEXT_PUBLIC_*` values: those vars are inlined at COMPILE time and
  the build cache is keyed by directory alone, so the e2e stack baked
  `NEXT_PUBLIC_API_BASE=http://localhost:3101` into `client/.next` and the dev
  server on :3000 kept serving it ("Cannot reach the DevDigest engine at
  http://localhost:3101"). Fix is a separate `distDir`
  (`next.config.mjs` reads `NEXT_DIST_DIR`; `scripts/e2e.sh` exports
  `.next-e2e`). Symptom to recognise: `grep -rl localhost:3101 client/.next`
  returns files; cure is `rm -rf client/.next` + restart.
- [2026-08-04] `next dev` also REWRITES two tracked files to match its distDir —
  `next-env.d.ts` (the `/// <reference path>`) and `client/tsconfig.json` (adds
  a `<distDir>/types` include and reformats the whole file). Any script that
  runs `next dev` with a non-default distDir must snapshot both before and
  restore them in its teardown, or every e2e run leaves a dirty working tree and
  points `pnpm typecheck` at a directory that only exists after e2e has run
  (`restore_snapshot` in `scripts/e2e.sh`).

- [2026-08-31] `find text "<entity name>" click` on a detail page is AMBIGUOUS:
  the app's header breadcrumb carries the same name, `find` takes the first
  match, and clicking a breadcrumb crumb navigates nowhere - the step reports
  `Done` and the following `wait --url` is what fails, pointing at the wrong
  place. Locate a card by a string only that card has: `13-export-ci.flow.json`
  clicks the agent's DESCRIPTION ("Flags secrets, injection, SSRF and the
  lethal trifecta before merge.") instead of "Security Reviewer". Agent cards
  are plain `div`s with an `onClick`, so `find role button` is not available
  for them.

## Recurring Errors & Fixes

- [2026-08-13] `specs/11-project-context.flow.json` failed one run at step 4
  with `✗ repo-scoped context route reached — Command failed: agent-browser wait
  --url /context`, and passed on an immediate re-run of the same tree (11/12
  then 12/12, no code change in between). The preceding step is
  `find text "Project Context" click`, which exits 0 even when the click lands
  on nothing (see the above-the-fold entry), so the failure surfaces one step
  later on the URL wait. `specs/12-onboarding-tour.flow.json` clicks the SAME
  sidebar entry and passed in both runs, so it is the click, not the route.
  Re-run once before investigating a change; treat it as real only if it
  reproduces twice for the same flow.
- [2026-08-14] **Root cause of the entry above, and it was not the click.**
  Repeating the suite under load reproduced it as 7/12, with a DIFFERENT flow
  failing each run and `Project Context` passing on the run where
  `Onboarding Tour` failed. The failures were all `agent-browser open …` or
  `wait --url …` on routes nobody had visited yet: `/skills`,
  `/settings/api-keys`, `/conventions`, `/repos/new`, `/repos/:id/onboarding`.
  `scripts/e2e.sh` waited only for `/` to answer before starting the flows, and
  `next dev` compiles a route on its FIRST request - so every other route paid
  its compile inside the first flow that opened it, racing that command's own
  timeout. On an idle machine the compile wins and the suite is green; under
  load it loses. That is the whole "flake".
  Fixed by warming every route the specs visit after the readiness loop, with a
  180 s per-route budget. Dynamic segments compile per PATTERN, so a placeholder
  uuid compiles `/repos/[repoId]/…` for every repo. 12/12 restored.
  The general lesson: a readiness check that proves ONE route serves proves
  nothing about the others under a lazily-compiling dev server, and the symptom
  it produces looks exactly like a selector or timing bug in whichever flow drew
  the short straw.
- [2026-08-14] **Killing an e2e run poisons the next one's baseline.**
  `scripts/e2e.sh` snapshots `client/next-env.d.ts` and `client/tsconfig.json`
  before `next dev` rewrites them for `.next-e2e`, and `cleanup()` restores them
  on exit. Kill the run hard enough that the trap does not complete and both
  files stay pointing at `.next-e2e` - and the NEXT run snapshots that dirty
  state as its "original", so no later run can ever restore the committed
  version. It looks like the script stopped cleaning up.
  After an interrupted run, check `git status` for those two files and
  `git checkout --` them before doing anything else. They are the only tracked
  files the suite writes to.

- [2026-08-31] A single flow failing with `Command failed: agent-browser find
  ... click` on a DIFFERENT step each run is the 60 s `E2E_STEP_TIMEOUT`, not a
  regression. `scripts/e2e.sh` warms the routes against `next dev`, and on a
  cold machine `/repos/[repoId]/pulls/[number]` alone compiles for 16-18 s
  (6800 modules); the first interaction inside it can then exceed the default.
  Two runs failed flows 04 and 05 at three different steps; `E2E_STEP_TIMEOUT=120000
  ./scripts/e2e.sh` went 12/12. Diagnose by re-running: a REAL breakage fails
  the same step every time. Do not "fix" the flow spec.


## Session Notes

- [2026-08-31] Intermittent, unreproduced: across four consecutive
  `./scripts/e2e.sh` runs of the SAME tree, run 1 failed only flow 11 at
  `wait --url /context` and run 2 failed only flow 12 at `wait --url
  /onboarding`; runs 3 and 4 passed 13/13. Both failing steps are a sidebar
  click followed immediately by `wait --url`, which suggests a race between the
  click and a client-side navigation rather than a broken flow. Not fixed:
  there was no reproduction to fix against, and the suite is green. If it
  recurs, suspect the click landing before the router is listening, and try
  `wait --load networkidle` between the click and the `wait --url`.
  - [2026-08-31] CORRECTION - it was not a race. It is the SAME ambiguous-locator
    bug recorded above: flow 11 clicked `find text "Security Reviewer"`, which
    also matches the header breadcrumb, and `find` takes the first match in
    document order - so the click hit a crumb, navigated nowhere, reported
    `Done`, and the FOLLOWING `wait --url` was what failed. It looked
    intermittent because whether a crumb carries an agent name depends on where
    the shared browser session had been. Fixed the same way as flow 13: click
    the card's DESCRIPTION, which only the card has. Flows 03 and 09 also name
    "Security Reviewer" but only `wait --text` on it, which is presence, not a
    click, and is safe. General rule: NEVER `find text <entity name> click` when
    that name can also appear in the breadcrumb - locate a card by a string only
    the card has.
  - [2026-08-31] PARTIAL, and the correction above overclaimed. Fixing flow 11's
    locator was right and flow 11 has passed every run since - but the suite is
    STILL intermittently red, so that ambiguity was one cause, not the cause.
    Observed over seven consecutive `./scripts/e2e.sh` runs of the same tree:
    run 1 flow 11 at `wait --url /context`; run 2 flow 12 at `wait --url
    /onboarding`; runs 3, 4, 6 all 13/13; run 5 flow 11 at `wait --url
    /agents/`; run 7 flow 09 at `find role button click --name Statistics`,
    where the `find` ITSELF exited non-zero rather than a following `wait`.
    Roughly 2 runs in 7 fail, each time a different flow and a different click
    or wait step. `13-export-ci.flow.json` passed all seven. Not diagnosed and
    deliberately not guessed at further: the failures scatter across step KINDS
    (sidebar link, card div, role=button tab), which points at element
    readiness in the shared browser session rather than at any one locator.
    Anyone picking this up should start by raising `E2E_STEP_TIMEOUT` (default
    60s) to see whether the failures move, and by checking whether the failing
    step is always the first interaction after a route the warm-up did not
    compile.

## Open Questions
