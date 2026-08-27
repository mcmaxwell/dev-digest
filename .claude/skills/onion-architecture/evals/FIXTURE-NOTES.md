# Fixture notes — known artifacts (iteration 1)

Case A (`case-a-alerts-module`) leaks defects beyond the 3 planted layering
violations.
These are REAL (verified against the repo), not reviewer hallucinations, and
they inflate the finding count on both arms equally:

- `constants.ts` uses `GITHUB_TOKEN_SECRET = 'github_token'`; the repo's
  canonical value is `'GITHUB_TOKEN'` (`server/src/modules/repos/constants.ts:12`).
- `service.ts` calls `github.createIssueComment(...)`, which exists on neither
  the `GitHubClient` port nor `adapters/github/octokit.ts`.
- `service.ts` calls `container.reviewRepo.getRun(...)` and reads
  `run.findingCount`; `ReviewRepository` has no such method.
- `@devdigest/shared` has no `AlertRule` / `AlertRuleInput` contract, though
  `routes.ts` and `helpers.ts` import them.

Both arms see the same fixture, so the comparison stays fair, but the extra
findings dilute the layering signal the eval is meant to isolate.
Tighten these in iteration 2: point the fixture at APIs that actually exist, so
the only things left to find are the 3 planted layering violations.

Case B (`case-b-cross-package`) leaks the same class of artifact (all verified
against the repo):

- `helpers.ts` and `severity-tuner.ts` use a five-value lowercase severity scale
  (`info|low|medium|high|critical`). The real contract is
  `Severity = z.enum(['CRITICAL','WARNING','SUGGESTION'])`
  (`server/src/vendor/shared/contracts/findings.ts:11`), and `SeverityCounts`
  already exists as the count contract.
- `severity-tuner.ts` keys overrides on `finding.ruleKey`; `Finding` has no
  `ruleKey` field.
- `service.ts` calls `listRecentRuns` / `listFindingsForRuns`, which do not exist
  on `ReviewRepository`.

Useful discovery from this run: `reviewer-core/.dependency-cruiser.cjs` already
carries a `core-has-no-io` rule naming `node:fs`/`node:path`, so B1 is
mechanically checkable and not merely a prose rule.

---

# Iteration 2

Cases A and B were retargeted at APIs that actually exist, and case C (Slack)
was parked - both arms had solved it perfectly, so it only bought a guaranteed
tie at the highest cost per run.
Case D was added on the surface `server/AGENTS.md` does NOT cover.

## Known artifact carried into iteration 2 (case B)

`tuneSeverities` is declared `<T extends { severity: Severity; category: string }>`,
but `reviewsForPull` returns `FindingRow`, whose `severity` column is
`text('severity').notNull()` (`server/src/db/schema/reviews.ts:47`) - i.e.
`string`, not `Severity`.
So the call in `digest/service.ts` does not typecheck.
This is a genuine defect a careful reviewer will (correctly) raise; it is not a
layering violation and was introduced while removing the iteration-1 artifacts.

Fix for iteration 3: relax the constraint to
`<T extends { severity: string; category: string }>`, or have the fixture map
rows to contracts in the service first.
Do NOT edit a fixture while runs are in flight - both arms must read identical
bytes for the comparison to mean anything.

## Why `server/AGENTS.md` matters to the baseline

`server/AGENTS.md:78-80` points the reader AT the onion-architecture skill, and
its "Conventions" section restates most of the skill's hard rules (schema-first
validation, drizzle only in repositories, cross-module reads via a Container
getter, service-owned transactions, the `*.it.test.ts` split).
That is why the iteration-1 baseline scored 100%: it was not guessing, it was
reading the same rules in different words.
Rules NOT covered anywhere outside the skill - and therefore the only
discriminating surface - are: the facade port at >2 entry points, the five-part
atomic port, repositories taking `Db` rather than `Container`, repositories
returning rows rather than DTOs, and routes not branching on business
conditions.

---

# Version history, measured

| Version | Change | Measured effect |
|---|---|---|
| 1.0.0 | baseline (categorical rules 4 and 6) | false positive on read-model returns |
| 1.1.0 | + rule 4 read-model exception, + rule 6 decision test | +0.25 vs 1.0.0 on case E (2 runs/arm) |
| 1.2.0 | + rule 8 (transitive reach) | +0.00 vs 1.1.0 on case F (5 runs/arm) - dead weight |
| 1.3.0 | rolled back rule 8 AND the rule 6 exception | -0.06 vs 1.2.0: trap T2 dropped to 3/5 |
| 1.4.0 | rule 8 stays out; rule 6 exception restored | content-identical to 1.1.0 |

## The lesson the runs paid for

Rule 8 named three "hard" transitive shapes (a transaction spanning a port one
hop down, a downcast hidden behind `import type`, a helper taking `Container`).
All three were found 5/5 by BOTH arms - the model does that traversal unaided,
so writing the procedure down bought nothing and cost 20 lines of always-loaded
context.

The rule 6 exception looked equally redundant: iteration 3 showed v1.0.0
declining to flag the `deleteAllForRepo` shape 2/2, because the agent found the
in-repo precedent itself.
With 5 runs the picture changed - without the written exception the same shape is
flagged as a violation in 2 of 5 runs, and iteration-5 run-3 justified it by
quoting the categorical wording verbatim.

So: n=2 said "redundant", n=5 said "load-bearing 40% of the time".
A rule that prevents an intermittent false positive will look unnecessary at
small n. Size the sample to the effect you are trying to see, and never retire a
precision rule on two runs.
