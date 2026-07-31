# L01 — Run cost

## Goal

Surface the USD cost of LLM review runs so users can see what a review — and a
PR's whole review history — actually costs.

## Scope

Three screens:

1. **Pull Requests list** — a `Cost` column showing the PR's **total spend**:
   the sum of `cost_usd` over ALL agent runs on that PR (re-reviews accumulate).
2. **PR detail → Agent runs timeline** — each settled run row shows
   `<total tokens> tok · $<cost>` under its timestamp.
3. **Run Trace drawer** — a `COST` stat tile between TOKENS and FINDINGS.

Out of scope: findings breakdown on the PR list, severity filter (the other
half of L01), multi-agent/eval/CI cost rollups (later lessons), Anthropic
cache-token accounting.

## Data flow

`reviewer-core` already returns `ReviewOutcome.costUsd` — the OpenRouter
provider reports the **real** API cost (`usage.cost`); OpenAI/Anthropic
estimate from the static pricing table (`server/src/adapters/llm/pricing.ts`,
live PriceBook for OpenRouter models). The server persists it to
`agent_runs.cost_usd` at run completion and exposes it via:

- `RunSummary.cost_usd` (`GET /pulls/:id/runs`) — timeline
- `RunTrace.stats.cost_usd` (`GET /runs/:id/trace`) — trace drawer
- `PrMeta.total_cost_usd` (`GET /repos/:id/pulls`) — list column, computed on
  read as `SUM(cost_usd)` grouped by PR (NULL-cost runs skipped)

## Decisions

- **PR list = total spend**, not latest-run cost (unlike the `score` column,
  which is latest-review).
- **Unknown costs**: sum the runs whose cost is known; render `—` only when no
  run has a known cost. A run's cost is NULL when the model has no pricing
  (static table miss + no API-reported cost) or the run failed before the LLM.
- **No backfill**: pre-existing runs keep `cost_usd = NULL` → `—`. Only new
  runs are priced.
- Within one run, cost is a **null-poisoning fold** (reviewer-core): one
  unpriced chunk makes the whole run's cost NULL — an honest `—` beats an
  understated `$`.

## Acceptance criteria

- A completed run persists `agent_runs.cost_usd` (real OpenRouter cost when
  reported, else pricing-table estimate, else NULL).
- Failed/cancelled runs persist NULL cost; unknown pricing renders `—`
  everywhere — never `$0.00`.
- Trace drawer shows the COST tile; timeline rows show `N tok · $X`; PR list
  shows the summed cost per PR with `—` fallback.
- Formatting: `$` + 2 significant digits below $1 (`$0.06`, `$0.014`,
  `$0.0013`), 2 decimals above ($1.23), via `client/src/lib/format.ts`.
- Contract change (`RunStats`, `RunSummary`, `PrMeta`) lands in BOTH vendored
  copies of `@devdigest/shared`.
