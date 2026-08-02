---
name: pr-self-review
description: Self-review of local branch changes before opening a GitHub PR. Routes the diff to the project's domain skills (UI skills for UI files, backend architecture skills for backend files), runs a fast deterministic check layer first, and blocks `gh pr create`/`gh pr merge` while critical findings remain. Use before opening or merging a PR, when the user says "pr self review", "self-review", "перевір зміни перед PR", or when a `gh pr create` attempt was blocked by the pr-self-review gate.
version: 1.0.0
---

# PR Self Review

Review the current branch's change-set with the project's own skills before a
PR exists, and gate `gh pr create` / `gh pr merge` on the result.

**Change-set** = everything vs `merge-base` with `main`: branch commits +
staged + unstaged + untracked. Get it from the helper script (single source of
truth, shared with the gate hook):

```sh
scripts/pr-self-review-checks.sh files   # changed file list
scripts/pr-self-review-checks.sh hash    # change-set fingerprint
```

State lives in two files under `.git/` (never committed):
- `.git/pr-self-review.json` — marker read by the gate: verdict + diff hash.
  Written ONLY via `scripts/pr-self-review-checks.sh marker <VERDICT> [note]`.
- `.git/pr-self-review-cache.json` — per-file review cache + override log,
  maintained by this skill (see Caching).

## Procedure

### 0. Arguments

- no args → full review (below).
- `acknowledge <reason>` → override flow (see Overrides). A reason is
  mandatory; refuse to acknowledge without one.

### 1. Deterministic layer first (no LLM)

```sh
scripts/pr-self-review-checks.sh run
```

Fast, zero-false-positive-by-design checks: do-not-touch paths, generated
migrations, vendored `@devdigest/shared` copy sync, secrets in added lines,
hand-parsed request bodies, `*.it.test.ts` naming, dependency-cruiser
`arch:check`. Output is `SEVERITY<TAB>file<TAB>message`; exit 1 means at
least one CRITICAL.

**If it finds criticals: stop early.** Write the marker
(`… marker BLOCKED "deterministic layer"`), report the findings with concrete
fixes, offer to apply them, and do NOT spend tokens on the LLM layer yet.
MAJOR findings alone do not stop the run — carry them into the final report.

### 2. Scale policy

Count changed files (excluding do-not-touch paths and lockfiles):

- **≤ 40 files** — full review.
- **41–150 files** — quick mode: subagents check ONLY the critical criteria
  from `references/routing.md`; say explicitly in the report that minor/major
  depth was skipped and why.
- **> 150 files** — refuse the review and recommend splitting the PR. Never
  truncate silently: if anything is skipped, the report must name it.

### 3. Route files to skills

Use the routing table in `references/routing.md`. Only skill groups that have
matching files in the change-set run at all. PR-hygiene checklist items in the
same file are checked by the orchestrator directly (cheap list checks, no
subagent).

### 4. Caching — review only what changed

Read `.git/pr-self-review-cache.json` (if present). For each routed file
compute `git hash-object -- <file>`; if the hash matches the cached entry and
the same skill set applies, **reuse the cached findings instead of re-reviewing
the file**. After the run, write the cache back: per file — hash, applied
skills, findings. This makes the fix-one-critical-and-rerun loop cost only the
files that actually changed.

### 5. LLM layer — one subagent per skill group

Spawn subagents in parallel (single message, multiple Agent calls), one per
routed skill group, prompt template in `references/routing.md`. Each gets: the
skill to load, its file list, the relevant diff hunks, and the critical
criteria. Findings come back as structured items:
`severity (critical|major|minor) · file:line · rule (from the skill) · why · minimal fix`.

Severity discipline: subagents propose, the orchestrator assigns the final
severity — a finding is `critical` ONLY if it matches a critical criterion in
`references/routing.md`. Findings on lines outside the diff are demoted to
informational notes.

### 6. Verify criticals before blocking

Every LLM-layer critical goes through one skeptic subagent
("try to refute this finding; default to refuted if not reproducible from the
diff"). Refuted → demote to major with a note. Deterministic-layer criticals
skip this (they are mechanical).

### 7. Verdict, marker, fixes

- ≥ 1 surviving critical → `… marker BLOCKED` and the gate will stop
  `gh pr create` / `gh pr merge`.
- otherwise → `… marker PASS`.

For every critical, present the minimal fix and **offer to apply all critical
fixes now** — then re-run from step 1 (the cache keeps this cheap). The skill
should feel like a fixer, not just a barrier.

### 8. Report

Verdict first, then findings grouped by skill, ordered by severity, each with
`file:line` and the rule it violates. End with: unresolved MAJOR/minor items,
anything skipped by scale policy, and cache stats (N files reused).

**On PASS, also draft the PR description** (the diff has already been read —
use it): what changed and why, which skills reviewed it, which minor findings
remain deliberately unfixed. Offer it for `gh pr create --body`.

## Overrides (`acknowledge`)

For false positives or consciously accepted risk:

1. Require a non-empty reason from the user.
2. Append to `overrides` in `.git/pr-self-review-cache.json`:
   `{at, finding, reason}`.
3. `… marker ACKNOWLEDGED "<reason>"` — the gate lets the PR through.
4. The override MUST appear in the PR description draft ("Acknowledged
   findings: …") so it is visible to reviewers, not buried locally.

## Honest limits

- The gate intercepts `gh pr create`/`gh pr merge` run through the agent's
  Bash tool. Commands typed in the user's own terminal and the GitHub UI merge
  button are NOT covered — real merge protection needs a CI required status
  check + branch protection (planned phase 2; `scripts/pr-self-review-checks.sh run`
  is CI-ready as-is).
- The marker binds to the change-set hash: any edit, commit, or new untracked
  file invalidates it, and the gate demands a re-run. That is intentional.
