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

## Session Notes

## Open Questions
