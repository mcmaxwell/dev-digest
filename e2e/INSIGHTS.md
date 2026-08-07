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

## Session Notes

## Open Questions
