# Experiment — do the API-contract skills change what the agent catches?

**Question.** The *API Contract Reviewer* agent's system prompt already says
"find changes that break the contract". Do the four linked skills actually change
the review, or are they decoration?

**Method.** One PR, one agent, one model. Run it twice — skills unlinked, then
linked — and compare the findings. Nothing else changes between the runs, so any
difference is attributable to the skill blocks.

> **Status: protocol written, not yet run.** The results tables below are
> deliberately empty. Fill them in from your own runs — do not treat the expected
> outcomes in the last section as observations.

---

## 1. Set up the agent

```sh
./scripts/dev.sh                      # Postgres + API :3001 + web :3000
cd server && pnpm db:migrate && pnpm db:seed
```

Seeding gives *API Contract Reviewer* four skills:
`api-contract-breaking-changes`, `api-response-schema`, `api-semver-discipline`,
`phantom-api-gate`.

The fifth, `api-deprecation-policy`, is **imported by hand** so the import path is
exercised on a skill that matters:

1. **Skills → Add Skill → Import from file**
2. Upload `docs/skills-examples/api-deprecation-policy.md`
3. Confirm the preview → the skill lands **disabled**, source `imported_file`
4. Vet the body, enable it
5. **Agents → API Contract Reviewer → Skills** → check it, drag it after
   `api-semver-discipline`

The agent's version bumps on the link change, so each run below pins the exact
ordered skill set it used (`agent_versions`).

Set a model with real reasoning for both runs (Settings → the agent's Config tab).
Use the **same** model for run A and run B or the comparison means nothing.

## 2. The PR under test

The diff must contain a genuine break that a competent reviewer without the
skills could plausibly wave through. This one carries four, in three files:

```diff
--- a/src/api/orders.ts
+++ b/src/api/orders.ts
-app.get('/v1/orders/:id', async (req) => {
-  const order = await orders.byId(req.params.id);
-  return { order_id: order.id, total: order.totalCents, created_at: order.createdAtSeconds };
+app.get('/v1/orders/:orderId', async (req) => {
+  const order = await orders.byId(req.params.orderId);
+  return { orderId: order.id, total: order.totalDollars, createdAt: order.createdAt.toISOString() };
 });

--- a/src/contracts/order.ts
+++ b/src/contracts/order.ts
 export const Order = z.object({
-  order_id: z.string(),
-  total: z.number(),
-  created_at: z.number(),
+  orderId: z.string(),
+  total: z.number(),
+  createdAt: z.string(),
 });

--- a/src/lib/totals.ts
+++ b/src/lib/totals.ts
-/** Total in cents. */
-export function orderTotal(id: string): number
+export function orderTotalMinor(id: string, currency: string): bigint

--- a/package.json
+++ b/package.json
-  "version": "2.4.1",
+  "version": "2.4.2",
```

The four breaks:

| # | Break | Which skill should catch it |
|---|---|---|
| 1 | Route param `:id` → `:orderId` | `api-contract-breaking-changes` |
| 2 | `order_id`/`created_at` renamed; `created_at` epoch-seconds → ISO string; `total` cents → dollars | `api-response-schema` |
| 3 | `orderTotal` deleted outright, no deprecation | `api-deprecation-policy` |
| 4 | All of the above shipped as a **patch** bump | `api-semver-discipline` |

Break 2's unit change (cents → dollars) is the interesting one: the response
still validates against a `z.number()`, so nothing fails — the values just quietly
mean something else.

Push this as a PR on a repo you control, then **Add repository** in DevDigest and
let the PR import.

## 3. Run A — without skills

Agents → API Contract Reviewer → Skills → uncheck all five → save.
Open the PR → **Run review** → select the agent.

Record from the run's Trace drawer (the `## Skills / rules` block should be
absent and `skills_tokens` zero):

| | Run A (no skills) |
|---|---|
| Run id | |
| Model | |
| Verdict | |
| Findings (CRITICAL / WARNING / SUGGESTION) | |
| Break 1 — route param | |
| Break 2 — response shape + units | |
| Break 3 — deleted export | |
| Break 4 — patch bump | |
| Cost (USD) | |

## 4. Run B — with skills

Re-check all five skills in the agent's Skills tab, keep the order
(breaking-changes → response-schema → semver → deprecation → phantom-api-gate),
save, and re-run the **same** PR.

| | Run B (skills linked) |
|---|---|
| Run id | |
| Model | |
| Verdict | |
| Findings (CRITICAL / WARNING / SUGGESTION) | |
| Break 1 — route param | |
| Break 2 — response shape + units | |
| Break 3 — deleted export | |
| Break 4 — patch bump | |
| Skills tokens (Trace drawer) | |
| Cost (USD) | |

## 5. What to compare

Not the finding *count* — a longer list is not a better review. Compare:

1. **Coverage.** Which of the four breaks each run named at all.
2. **Severity calibration.** A renamed response field is CRITICAL, not a
   SUGGESTION. Run A tends to file real breaks as "consider…" because nothing
   told it where the line is.
3. **Specificity.** Does the finding name the caller expectation that dies
   ("every caller reading `created_at` as epoch seconds now parses an ISO
   string") or just observe that a field changed?
4. **Cost of the difference.** `skills_tokens` from the trace, against the extra
   findings. This is the number that says whether the skills earn their prompt
   space.

Write the conclusion here when you have both runs.

## 6. Expected outcome — a hypothesis, not a result

Stated up front so it can be falsified rather than fitted afterwards:

- Break 1 (route param) is the one Run A is most likely to catch unaided — it is
  the textbook example of a breaking change.
- Break 2's **unit** change is the one Run A is most likely to miss: nothing about
  `totalCents` → `totalDollars` looks wrong in isolation, and the type is
  unchanged. `api-response-schema` names units explicitly.
- Break 3 depends on the imported `api-deprecation-policy` skill. Without it,
  deleting an export with no in-repo callers reads as a clean refactor.
- Break 4 is the most skill-dependent of all: nothing in the base prompt mentions
  version numbers, so Run A has no reason to look at `package.json`.

If Run A catches all four, the skills are not earning their tokens for this
agent — that is a real result and worth writing down. If it does, keep this file
and note it: a negative result on a well-designed experiment is more useful than
a re-run until it agrees.
