# Behavioural cases for `dependency-audit`

`trigger.json` measures whether the description makes the model *reach* for this
skill. These four cases measure whether the skill, once reached, produces the
right audit. Definitions live in `evals.json`.

## What each case is for

| id | Case | Defects it plants | What it protects against |
| --- | --- | --- | --- |
| 10 | `unused-and-phantom-deps` | a declared-but-unimported dep, and an imported-but-undeclared one | an audit that only reads `package.json` and never the imports, or only the entry point and never the rest of `src/` |
| 11 | `two-lockfiles-one-package` | two lockfiles in one package, and a `packageManager` that disagrees with one of them | an audit that reports package *contents* and never package *hygiene* |
| 12 | `documented-drift-vs-real-drift` | two undocumented version drifts, next to one the repo's own `AGENTS.md` declares deliberate | the failure that matters most here: flagging a split the team already decided on, which is how an audit loses its reader |
| 13 | `devdependency-reaches-shipped-code` | a devDependency imported from code that ships | an audit that treats every package as private and never asks whether the dev/prod split is load-bearing |

**Every case carries traps as well as defects.** A skill that flags everything
scores the same as one that flags nothing, so each fixture contains adjacent
facts that look like defects and are not: a `@types/*` package with no import, a
package legitimately on npm, a documented zod 3/4 split, `vitest` imported only
from `test/`. A run that reports a trap is a worse result than one that misses a
defect, because it is the failure a reader stops trusting.

## What is automated, and what is not

`scripts/eval-matrix.sh check skill:dependency-audit` runs on every PR that
touches this skill and verifies the things that need no model: `evals.json`
parses, every declared fixture resolves, no fixture comment gives away its own
planted defect, `trigger.json` is well formed, and every `*.py` compiles.

**The behavioural verdicts are not automated.** There is no agent-quality runner
in this repo - `scripts/eval-trigger.py` says so in its own docstring, and
inventing a green job that measures nothing would be worse than the gap. Running
these four cases is the manual `iteration-*/` flow the earlier full-audit eval
already uses: run the skill against each fixture, drop the report under
`iteration-N/eval-<id>-<name>/`, and grade the machine-summary block with
`grade.py`.

## The gate was watched failing before it was trusted

Three deliberate breaks, each caught, each reverted:

| Break | What the gate said |
| --- | --- |
| pointed case 12's fixture at a renamed directory | `FAIL fixture missing: fixtures/case-c-renamed-away` |
| added `// this is the bug: …` to case 13's fixture | `FAIL a fixture comment gives away its planted defect` |
| truncated `evals.json` mid-array | `FAIL evals.json does not parse` |

A gate nobody has seen go red is a gate nobody knows is wired up.
