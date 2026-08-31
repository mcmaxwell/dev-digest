# Amendment 01 - the Multi-Agent Review landing page

Amends `docs/plans/l07-multi-agent-review.md`, Phase D.
Source: the user, after reading the plan. The gap is real and neither spec nor mockup covered it.

## Why

As planned, `/repos/[repoId]/multi-agent` is the configure screen and nothing else.
That means a user who has just run a multi-agent review and navigates back to the page cannot reach their run again from the UI: the page only ever offers to start another one.
The four mockups only ever showed "configure" and "results", so neither the spec nor the plan's Design review caught it.

This amendment reverses ONE explicit decision in the base plan, Step C4's "does not add a list route". That decision assumed the PR page was the only way back to a run, which is true only for users who came from a pull request.

## Step E1 - server: list a repository's multi-agent runs

- Files: `server/src/vendor/shared/contracts/observability.ts` , `client/src/vendor/shared/contracts/observability.ts` , `server/src/modules/reviews/repository/multi-agent.repo.ts` , `server/src/modules/reviews/service.ts` , `server/src/modules/reviews/routes.ts`
- Does:
  - Adds `MultiAgentRunSummary` to BOTH vendor copies in one edit: `id`, `pr_id`, `pr_number`, `pr_title`, `ran_at`, `agent_count`, `status`, `total_duration_ms` (nullable), `total_cost_usd` (nullable), `total_cost_partial`, `findings_count`.
    It is a header-only shape on purpose: the list must not carry columns or clusters, or the landing page would transfer every finding of every past run.
  - Adds `listMultiAgentRunsForRepo(db, workspaceId, repoId, { limit })` to `multi-agent.repo.ts`, joined through `pull_requests` to scope by repository, ordered `ran_at DESC, id DESC`, default limit 20, aggregating the member `agent_runs` for the count, status, duration, cost and findings total.
  - Adds `ReviewService.listMultiAgentRunsForRepo(workspaceId, repoId, limit)`.
  - Registers `GET /repos/:id/multi-agent-runs` with `params: IdParams` and a zod querystring `{ limit: coerce int 1..50 default 20 }`.
    Status, duration and cost are derived on read by the SAME rules Step C3 already established: `running` if any member run is running, `failed` if every terminal member failed, else `done`; duration is the max; cost is the sum with the partial flag.
- Does not: return columns, clusters or findings on this route; add a status column to `multi_agent_runs`; duplicate the derivation logic - reuse the helpers Step C3 built.
- Skills: `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` , `cd server && pnpm arch:check` , `cd server && pnpm typecheck` , `diff -q server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts`

## Step E2 - client: split the landing page from the configure screen

This REPLACES the routing half of base Step D3. Everything else in D3 - the two steps, the agent rows, the disabled run control, the counter, the estimate, the rejected mockup lines - is unchanged and simply moves to the new path.

- Files: `client/src/app/repos/[repoId]/multi-agent/page.tsx` (rewritten) , `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentLandingView/**` (new) , `client/src/app/repos/[repoId]/multi-agent/new/page.tsx` (new, hosts the configure view) , `client/src/lib/hooks/multi-agent.ts` , `client/messages/en/runs.json`
- Does:
  - `/repos/[repoId]/multi-agent` becomes the LANDING page: a "Recent runs" list, newest first, over `useRepoMultiAgentRuns(repoId)`, plus one primary control that reads "New multi-agent review" and navigates to `/repos/[repoId]/multi-agent/new`.
  - Each row shows the pull request number and title, the number of agents, when the run started, its status, its findings total, and its duration and cost with the partial marker. The whole row is keyboard-activatable and navigates to `/repos/[repoId]/multi-agent/<runId>`.
    A `running` run is shown as running and still navigates - the results screen already polls.
  - With no runs at all, the list area shows an empty state saying no multi-agent review has been run for this repository yet, and the primary control is the only action.
  - `/repos/[repoId]/multi-agent/new` hosts `MultiAgentConfigureView` exactly as base Step D3 specifies it. A static `new` segment resolves before the sibling `[runId]` segment in the App Router, so the two do not collide - but confirm this rather than assuming it.
  - After a run starts, the configure screen navigates to `/repos/[repoId]/multi-agent/<runId>`, so the back destination is the landing list rather than a half-filled form.
  - Adds `useRepoMultiAgentRuns(repoId)` to `client/src/lib/hooks/multi-agent.ts` with its key in the existing `multiAgentKeys` factory. Types come in with `import type` only.
  - Adds the landing strings to `client/messages/en/runs.json`: the section heading, the primary control, the empty state, and the row labels. Plain hyphen only, never an em dash.
- Does not: render columns, clusters or findings on the landing page; auto-redirect to the most recent run (the user must be able to see that older runs exist, and a silent redirect makes the "new run" action unreachable for anyone who lands by clicking the nav item); paginate (the 20-row cap is the whole list); add a delete or re-run control.
- Skills: `next-best-practices`, `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- Verify: `cd client && pnpm test` , `cd client && pnpm lint` , `cd client && pnpm typecheck` , `cd client && pnpm build`

## Step E3 - the nav destination still resolves

- Files: none expected
- Does: confirms `activeKeyFor` still returns `multi-agent` for `/repos/<id>/multi-agent`, `/multi-agent/new` and `/multi-agent/<runId>`, since all three contain `/multi-agent`. If it does not, fix the client-side helper, NOT `client/src/vendor/ui/nav.ts`.
- Verify: `cd client && pnpm test src/components/app-shell/helpers.test.ts`

## Done when

- Navigating to Multi-Agent Review with at least one past run shows that run in a list and offers a control to start another.
- Navigating there with no past run shows an empty state and the same control.
- A row opens that run's results screen.
- The configure screen is reachable only from that control, and starting a run lands on the new run's results.
- The landing request carries no findings.
