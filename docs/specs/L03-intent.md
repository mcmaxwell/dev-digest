# L03 — Intent Layer

## Goal

Stop reviewing a PR as if it were a context-free blob of diff.
A cheap, separate LLM call reads only the PR's **metadata** — title, body, linked issue, referenced spec, and the changed-file list with hunk headers — and returns a structured statement of what the PR is *for*.
That statement is persisted per PR, shown to the user before the review results, and injected into the reviewer prompt so out-of-scope noise can be suppressed deterministically.

The whole feature is built around one non-negotiable: **a CRITICAL finding is never dropped, whatever the intent says.**

## Scope

1. **`intent` server module** — owns the `pr_intent` table (which has existed unused since `0000_init.sql`) and the classifier call.
   Source resolution, prompt assembly, persistence, and a two-route API.
2. **Data sources with status** — every source the classifier saw is recorded as `ok` / `absent` / `unreachable` and travels into the prompt, the row, and the UI.
   Nothing is silently missing.
3. **No diff bodies, ever** — `modules/intent/hunk-map.ts` reduces a `UnifiedDiff` to a file list with reconstructed `@@` headers.
   It is the single chokepoint that guarantees no `+`/`-` line reaches the classifier.
4. **Reviewer prompt slot** — `PromptParts.intent` is a pre-rendered block the server builds, so `reviewer-core` never learns the `PrIntent` shape.
   It renders as `## Derived intent` between `## PR description` and `## Skills / rules`.
5. **Deterministic scope filter** — `reviewer-core/src/review/scope.ts` drops findings the model marked `out_of_scope` **only** when they are below the severity threshold.
   It runs after grounding and before scoring.
6. **Intent card** — the PR page's Overview tab shows the summary, IN SCOPE / OUT OF SCOPE columns, RISK AREAS chips, a confidence badge, a stale badge, a missing-context notice, and a re-run control.

Out of scope: Blast Radius, PR Brief composition, Smart Diff, the separate `risk_brief` feature (the card *section* ships, the feature does not), arbitrary-URL fetching, pino-level log redaction as infrastructure, and a user-editable intent.

## Data flow

`POST /pulls/:id/review` → the run executor loads the diff once → reads
`container.intentRepo.get(prId)`; when it is missing or its `head_sha` no longer
matches the PR's, `IntentService.classify` runs inline (one flash call, no
`JobRunner`, no `agent_runs` row) → sources are resolved through the existing
`GitHubClient` / `GitClient` ports, each with a status → the prompt wraps every
source in `wrapUntrusted` → `completeStructured({ schemaName: 'Intent' })` →
confidence is capped **server-side** → the row lands in `pr_intent` with its
sources, provider, model, head SHA and full trace → the executor renders the
block, counts its tokens (`intent_tokens`), and passes it to
`reviewPullRequest({ intent })` → `assemblePrompt` emits `## Derived intent` →
findings come back carrying a per-finding `scope` → `groundFindings` →
`applyScopeFilter` → `scoreFromFindings` over the survivors.

`GET /pulls/:id/intent` and `POST /pulls/:id/intent` serve the card directly, so
intent can be detected without running a review.

## Decisions

- **Linked plans/specs are GitHub-domain only.**
  Resolved through the existing `GitHubClient` / `GitClient` ports — no raw `fetch`, no new port, no SSRF surface.
  A non-GitHub URL is recorded as `external_url` with status `unreachable` and is never dereferenced.
- **A path the PR body names is always recorded; a standing spec candidate is only recorded when it exists.**
  This narrows the plan's "every source carries a status" rule for exactly one subset, on purpose.
  A path the author wrote down is a claim about intent, so its absence is a real gap and is recorded `unreachable`.
  The `SPEC_FILE_CANDIDATES` list is a guess the system makes on every PR, and reporting five `absent` rows each time would bury the genuine gaps in the "Missing context" notice.
- **A CRITICAL is never filtered.**
  An out-of-scope critical finding surviving as an ordinary grounded finding *is* the "serious out-of-scope problem" signal.
  Nothing is synthesized and the grounding gate is untouched.
- **Confidence is capped by code, not trusted from the model.**
  Verbalized LLM confidence is systematically overconfident, so: no PR body → `low`; any source `unreachable` → at most `medium`.
  Same rule the conventions extractor already applies to an unmeasured probe: cap confidence, never drop the item.
- **The classifier gets no `agent_runs` row.**
  That would pollute `/pulls/:id/runs`, the run-history UI, and `total_cost_usd`.
  Its cost lives in `pr_intent.trace.cost_usd`.
- **`stale` is derived, not stored.**
  The server compares the row's `head_sha` against `pull_requests.head_sha` on read.
- **The drizzle property is `summary`, the SQL column stays `intent`.**
  `drizzle-kit generate` turns interactive when one table both gains and drops columns; keeping the column name makes migration `0015` purely additive and non-interactive.
- **`confidence` has no DB CHECK.**
  Drizzle's `text(col, { enum })` is TypeScript-only. Accepted, repo-wide precedent.
- **`brief.ts`'s `Intent`/`PrBrief` and `review-api.ts`'s `PrIntentRecord` are untouched**, so the future PR Brief lesson keeps its seam.
  `modules/intent/helpers.ts`'s `toBriefIntent()` is the single conversion point it will need.
- **`INJECTION_GUARD` is not edited.**
  It already names "derived intent/scope" and already states that stated intent can never turn a real defect into zero findings.
- **`review_intent` defaults flip** from `openai` / `gpt-4.1` to `openrouter` / `deepseek/deepseek-v4-flash`, matching `onboarding` and `conventions`.
  Settings → Models already renders the row; no client change is needed for the setting itself.

## Acceptance criteria

- The PR page's Overview tab shows an Intent card: empty state with a "Detect intent" button on a PR that has no row, then summary, both scope columns, risk chips and a confidence badge once detected.
- A review run shows two distinct LLM calls in the Live Log — the flash model with `schemaName: 'Intent'`, then the agent's model with `schemaName: 'Review'` — and creates exactly one `agent_runs` row.
- The run trace's `prompt_assembly` carries `intent` and `intent_tokens`, and `## Derived intent` sits between `## PR description` and `## Skills / rules`.
- The classifier's stored prompt contains no diff body lines.
- A PR with a blank body yields `confidence: 'low'`; a body referencing a missing issue yields a `sources` row with `status: 'unreachable'`, a capped confidence, a "Missing context" line on the card, and no invented issue content anywhere.
- An out-of-scope `SUGGESTION` is dropped by `applyScopeFilter`; an out-of-scope `CRITICAL` is not.
  When anything was dropped, the persisted review summary gains one sentence and the run trace records `scopeDropped`.
- Contract changes (`contracts/intent.ts`, `PromptAssembly.intent`/`intent_tokens`, `FindingShape.scope`, the `review_intent` registry default) land in BOTH vendored copies of `@devdigest/shared`, plus `client/src/lib/feature-models.ts` for the registry.
- `pnpm arch:check` passes in `server/` and `reviewer-core/` with no new allowlist entry.
