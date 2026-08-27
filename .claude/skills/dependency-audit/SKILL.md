---
name: dependency-audit
description: Produces a dependency AUDIT of this repo - a written report over all five packages and the internal component graph, with a Mermaid map, per-package weight (disk size and whether the package ships), findings across hygiene, supply chain and architectural boundaries, and a ranked action list. Use when the question is about the dependency SET as a whole and the answer is a report: node_modules bloat, what could be removed, version drift between packages, duplicated or unused packages, two lockfiles in one package, or "what are we actually depending on and what should we fix first". Do NOT use it to carry out package work: installing, removing or upgrading a package, debugging a failing install or an unresolved import, editing a dependency-cruiser config, or chasing a slow build - those are the work itself, not an audit of it.
version: 1.3.0
---

# Dependency audit

Produces one report answering four questions a developer actually acts on:
what do we depend on, what does it cost, what is wrong, and what should we do
first.

## Workflow

1. **Measure, do not eyeball.** Run the collector from the repo root:

   ```sh
   python3 .claude/skills/dependency-audit/scripts/collect.py . > /tmp/deps.json
   ```

   It is offline and deterministic: package manifests, install layout, per
   package sizes, version drift across packages, undeclared script binaries,
   and runtime dependencies nothing imports. It measures; it never judges.

2. **Read the JSON, then judge.** The numbers are the easy half. The
   judgement is separating a real problem from a shape that only looks like
   one, and the collector cannot do that - `runtime_deps_not_imported` is a
   candidate list, never a verdict.

   Verify every candidate against the source before asserting it, and expect
   most of them to survive the check. A package can look unused and be load
   bearing: a framework peer nothing imports directly (`react-dom`), a package
   used for its binary behind a dynamic import (`@vscode/ripgrep`), a
   side-effect import with no `from` clause (`dotenv/config`), or a tool that
   reads like dev-only and is genuinely called at runtime
   (`dependency-cruiser`, in the depgraph adapter). Version drift is the same
   trap: `mcp` sits on zod 4 on purpose. The repo already records these
   decisions - `CLAUDE.md`, each package's `AGENTS.md`, the `.npmrc` files and
   the three `.dependency-cruiser.cjs` configs are where the answers live, and
   reading them beats guessing. Anything you check and reject goes in
   `cleared`, so the next audit does not re-raise it.

3. **Write the report** using the template below. One file, in the order given.

Cover four dimensions: **hygiene** (undeclared, unused, drift, lockfiles),
**weight** (disk size versus what actually ships), **supply chain** (transitive
depth, native and platform-locked packages, install scripts, advisories) and
**boundaries** (the internal component graph, the alias edges, what
`arch:check` does and does not cover).

## Report template

Follow this structure exactly - developers skim it in this order, and the
sections deliberately go from "what is true" to "what to do".

```markdown
# Dependency audit - <YYYY-MM-DD>

## Summary
<3-6 bullets. Each one a decision or a number worth remembering, not a
restatement of the tables. Lead with the single most expensive fact.>

## Map
<Mermaid graph: the five packages, their alias edges, and their runtime
adapters. See "Diagram" below.>

## Weight
<Per-package table, then the heaviest packages that actually ship.>

## Findings
<Grouped by dimension. Each finding: what, where, why it matters here, fix.
Severity in the heading. Skip a dimension with nothing to say - an empty
section is worse than no section.>

## Priority
<Ranked table: action, dimension, effort, payoff. Highest payoff-per-effort
first. Every row traceable to a finding above.>

## Machine summary
<The JSON block below. Last section, always.>
```

## Machine summary

The report ends with one fenced `json` block. It exists because prose cannot be
read back reliably: a package name appears in a report both when you are
accusing it and when you are clearing it, and no keyword search can tell those
two apart. The block states the verdict outright.

````markdown
## Machine summary

```json
{
  "schema": "dependency-audit/1",
  "packages": [
    {"name": "mcp", "disk_mb": 110, "layout": "isolated",
     "declared": 9, "ships": 2, "installed_top_level": 8}
  ],
  "findings": [
    {"id": "fastify-autoload-unused", "subject": "@fastify/autoload",
     "package": "server", "dimension": "hygiene", "severity": "high"}
  ],
  "cleared": [
    {"subject": "react-dom", "package": "client",
     "why": "Next.js peer runtime, never imported by app code"}
  ],
  "not_run": ["advisories", "staleness"]
}
```
````

Three rules make it worth writing:

1. **`findings` are defects you are asserting; `cleared` are candidates you
   checked and rejected.** Anything you considered belongs in one list or the
   other. Silently dropping a rejected candidate is how the next audit
   re-raises it, and how a reader cannot tell "not a problem" from "not
   looked at".
2. **Numbers appear once, unambiguously.** `disk_mb` is an integer of
   megabytes and `ships` counts the runtime dependencies of that package.
   Those two together are the disk-versus-ships split the Weight section
   argues in prose; here they are diffable. Prose may round or format however
   reads best.
3. **`not_run` is not optional.** A check you skipped is a hole in the audit,
   and an empty `not_run` claims you ran everything.

`dimension` is one of `hygiene`, `weight`, `supply-chain`, `boundaries`.
`severity` is one of `critical`, `high`, `medium`, `low`.
Validate before finishing:

```sh
python3 .claude/skills/dependency-audit/scripts/check_report.py <report.md>
```

## Diagram

One Mermaid `graph LR` of the repo's own components - packages, the tsconfig
alias edges between them, and each package's outward adapters. Node labels
carry the size that matters (`server<br/>239M`).

Do not draw the npm dependency tree: 500+ transitive nodes is a picture of
nothing. If a specific subtree is the subject, draw that subtree alone.

## Severity

| Level | Meaning |
|---|---|
| **critical** | Breaks a clean install, a build, or ships a known vulnerability |
| **high** | Real cost today: dead weight that ships, drift that will bite, a boundary already broken |
| **medium** | Correct but fragile: undeclared-but-hoisted, an unpinned native module |
| **low** | Hygiene with no live consequence |

Rank the Priority table by payoff divided by effort, not by severity. A
critical finding needing a migration lands below a high one fixed by deleting
a line.

## What this skill must not do

- **Never install, update, or delete anything.** The audit is read-only. It
  ends with a recommendation, and the human runs the command.
- **Never report a size without saying what kind it is.** "664M" for `client`
  is almost all devDependencies and ships nothing; presented bare it reads as
  a catastrophe and burns the reader's trust in the rest of the report.
- **Never call a dependency unused on the collector's word alone.** Check the
  source, and check what the search actually covered: a file containing a raw
  NUL byte is skipped by grep and ripgrep alike, so its imports are invisible.
- **Never flag version drift without checking whether it is deliberate.**
  `CLAUDE.md` documents some of it - `mcp` is on zod 4 on purpose.
