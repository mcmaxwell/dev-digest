---
name: engineering-insights
description: Captures non-obvious engineering lessons into per-module INSIGHTS.md files and reads them back at task start. Use at the start of every task (read the touched module's INSIGHTS.md first), during any coding task when discovering a gotcha, a failed approach, a tool or library quirk, a recurring error and its fix, or a tradeoff decision; and at the end of a task as a wrap-up check. Also use when the user says wrap up, retro, lessons learned, add to insights, or TIL.
---

# Engineering Insights

A capture-learnings loop: each module keeps its own append-only `INSIGHTS.md`
so the next session in that module starts with its lessons, not from zero.

## The loop

1. **Task start** — read the `INSIGHTS.md` of the module the task touches (plus
   the root one). Treat entries as high-confidence guidance unless told otherwise.
2. **Capture as you go** — the moment something non-obvious surfaces, append it
   (after the quality gates below). Don't trust "I'll remember at the end".
3. **Wrap-up** — before finishing a task, ask: did this session contain a
   problem, a solution, or a discovery that isn't captured yet? If yes, append
   it now. If the task was trivial (no problem/solution/discovery), skip.

## Where to write

| Touched code | File |
|---|---|
| `client/**` | `client/INSIGHTS.md` |
| `server/**` (incl. `src/modules/repo-intel`) | `server/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| cross-cutting (e.g. vendored shared contracts, dev scripts) | root `INSIGHTS.md` |

## What to capture → which section

- Approach or solution that worked → **What Works**
- Dead end / antipattern + why it failed → **What Doesn't Work**
  (skipped most often, worth the most — a "don't do this" saves hours)
- Convention or architecture decision + its reasoning → **Codebase Patterns**
- Dependency/tool quirk (version limits, weird flags, silent failures) → **Tool & Library Notes**
- Error seen more than once + the fix → **Recurring Errors & Fixes**
- Dated one-line summary of a significant session → **Session Notes**
- Unresolved question worth revisiting → **Open Questions**

## Entry format

`- [YYYY-MM-DD] <one insight>`

- One insight per bullet — dense paragraphs get skipped.
- Name the concrete file, symbol, command, or error message (`file:line` where
  possible).
- Abstract the lesson first: record the general rule, not the raw incident.
- Actionable "cold": an agent reading it fresh knows exactly what to do or
  avoid without re-investigating. Lead with why; NEVER/ALWAYS phrasing is fine.

❌ "Promises can be tricky" — noise, not a lesson.
❌ "Be careful with async."
✅ "Promise.all() on the ingest pipeline times out after 30 items — use
   Promise.allSettled() with batches of 10."
✅ "Checkout-flow state always goes through Zustand (cartStore.ts) — the cart
   is shared by 3 components; local state doesn't work here."

## Quality gates — all must pass before writing

1. **Anti-banality**: if it would be obvious to anyone reading the code — don't write it.
2. **5-minute test**: would this save 5+ minutes next session?
3. **Not derivable**: not in the code, README, or AGENTS.md; not generic best practice.
4. **Stable**: not about code actively churning in this very session.

If an entry can't be made that specific yet, hold it in Open Questions instead.

## No duplicates

Before appending, read the target file. If the lesson is already covered,
extend/update that entry with a dated note — do not add a near-duplicate.
Append-only: never delete or rewrite existing entries; correct a wrong entry
with a new dated note under it.

## Limits

When a file grows past ~30 entries, flag it to the user for consolidation —
don't prune automatically.
