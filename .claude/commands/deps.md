---
description: Dependency audit of the repo, saved to docs/audits/ and diffed against the last one
argument-hint: [package, optional - defaults to all five]
---

Run the `dependency-audit` skill (`.claude/skills/dependency-audit/SKILL.md`).

Scope: $ARGUMENTS
When that is empty, audit all five packages. When it names a package, audit
that one and say so in the report's Summary, so a narrow run is never mistaken
for a full one.

Then, in this order:

1. Get today's date with `date +%F` rather than assuming it, and write the
   report to `docs/audits/deps-<that date>.md`.

2. Validate it. The command is
   `python3 .claude/skills/dependency-audit/scripts/check_report.py <the report>`
   and it must exit 0 before you are finished. Fix the report, not the
   validator.

3. Compare against the previous audit. List the files in `docs/audits/`, take
   the most recent one before today, and read its machine summary. Then add a
   short `## Since the last audit` section directly under `## Summary` covering
   only what moved:

   - findings that are gone, and whether they were fixed or dropped without a
     reason
   - findings that are new
   - findings still open, with how many audits they have survived
   - packages whose `disk_mb` changed by more than 10%

   Compare the machine blocks, not the prose - that is what they are for. If
   `docs/audits/` holds no earlier report, write "first audit, no baseline" and
   skip the section rather than inventing a comparison.

Do not install, update or remove any package. The audit is read-only and ends
with a recommendation; the human runs the command.
