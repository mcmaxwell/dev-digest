# Spec: Agent run log - an agent's own runs, and the trace drawer that stops belonging to one route

Spec ID: L07
Status: draft
Supersedes: none

## Problem and user

The user is editing a review agent on `/agents/[id]`.
They have just changed its system prompt, attached a skill, or turned repo intel off, and they want to know what the agent actually sent to the model.

That information exists, in full.
Every run persists its entire trace as one document - configuration, stats, prompt assembly with the per-slot token attribution, tool calls, raw output and the whole log - and the drawer that renders it is already built (`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer`).

The problem is where it lives.
The only way to reach a run's trace is the run history on a pull request page, which means the user must first remember which pull request the agent ran on, navigate to that repository, find that pull request, scroll the timeline past the commits, and click the right row.
From the agent editor - the screen where the question is actually asked - there is no path at all.

The drawer's location is the second half of the same problem.
It sits inside the pulls route's `_components`, and `client/AGENTS.md` states that one feature must not import a sibling feature's `_components`, a rule `pnpm lint` enforces.
So today the agent editor cannot reuse the drawer even if it wanted to; it can only copy it.

The cost is a prompt-tuning loop with a blind spot in the middle: the user edits the prompt, runs the agent, and reads the findings, but never the prompt the run actually assembled.

## Goals and non-goals

### Goals

- Give the agent editor a Runs tab listing that agent's own runs, newest first.
- Open any of those runs into exactly the trace view the pull request page already shows, with nothing added to it and nothing removed.
- Move that drawer to a home no single route owns, so both screens mount one component rather than two copies of one.
- Keep the change small: this is reuse, not a new subsystem.

### Non-goals

- **No new trace content.**
  The drawer's tabs and sections stay as they are.
  If a field is missing from a trace today, it is still missing after this.
- **No aggregates.**
  Accept rate, cost over time, latency trend and the per-agent charts are the Agent Performance screen, a later lesson.
  This tab is a list of runs, not a dashboard.
- **No run control.**
  Nothing on this tab starts, cancels, re-runs or deletes a run.
  Deleting a run stays on the pull request's run history, where it already is.
- **No cross-agent view.**
  The tab shows one agent's runs, because it lives inside that agent's editor.
- **No new persistence.**
  Every field the tab shows is already recorded on the run row or its trace.
- **No change to the pull request page's behaviour.**
  After the move, the pull request page mounts the shared drawer and behaves exactly as it did.

## User stories

1. From the agent I am editing, I see its recent runs without going hunting through pull requests.
2. I open one and read the exact prompt that run assembled, including which skills and which project documents made it in.
3. I can tell at a glance which of its runs failed, and why.
4. When a run came from CI rather than from the studio, it is in the same list and marked as such.

## Module interactions

| Participant | What this feature needs from it | What crosses the boundary | If it is unavailable |
| --- | --- | --- | --- |
| `agents` (client route `/agents/[id]`) | A place for the tab. The editor's tabs are declared in one list and the tab is carried in `?tab=` (`client/src/app/agents/[id]/_components/AgentEditor`). | The agent's identity. | Not applicable: the tab is part of the editor. |
| `reviews` (server) | The runs of one agent, and one run's persisted trace. `agent_runs` and `run_traces` are owned by this module's run repository (`server/src/modules/reviews/repository/run.repo.ts`), which today lists runs only per pull request (`listRunsForPull`). The trace read already exists as `GET /runs/:id/trace`. | A list of run rows for one agent, and one trace document. | The tab shows that the runs could not be loaded and offers a retry; the editor's other tabs are unaffected. |
| `pulls` | The number and title of the pull request each run ran on, for the row label. | A pull request number and title, or nothing when the run's pull request no longer exists. | The row falls back to showing no pull request rather than failing the list. |
| The shared trace drawer (client) | Rendering one run's trace and, for a run still in flight, its live log over SSE. | A run identity, an optional agent name, an optional pull request number, the run's persisted findings, and whether it is running - the props the drawer already takes. | Its own loading and error states, unchanged. |

### The row shape

The existing `RunSummary` contract is shaped for the opposite screen: it carries the agent's identity because the pull request page knows the pull request and needs the agent.
This tab knows the agent and needs the pull request, and it needs one field `RunSummary` does not carry at all.

What a row must carry:

| Field | Where it comes from | Why the row needs it |
| --- | --- | --- |
| Run identity | `agent_runs.id` | Opens the drawer. |
| When it ran | `agent_runs.ran_at` | The list's sort key and the row's primary label. |
| Pull request number and title | The run's pull request | The only thing that tells two runs of the same agent apart at a glance. |
| Status | `agent_runs.status` | Running, done, failed, cancelled. |
| Error | `agent_runs.error` | Shown on the row for a failed run, so the user need not open the drawer to learn the reason. |
| Findings count, blockers and score | `agent_runs.findings_count`, `blockers`, `score` | The run's outcome, derived the same way the pull request timeline derives it. |
| Duration and cost | `agent_runs.duration_ms`, `cost_usd` | What the run cost in time and money. |
| Source | `agent_runs.source` | Distinguishes a studio run from a CI run. Present as a column and defaulted to `local`; nothing writes `ci` today, because `createAgentRun` hardcodes `source: 'local'`. |

### Where the shared drawer belongs

`client/AGENTS.md` fixes this: feature logic is colocated in a route's `_components/<Name>/`, and "one feature must not import a sibling feature's `_components` - promote the shared piece to the nearest common ancestor segment or to `src/components/`", enforced by `pnpm lint` along with the layer direction `lib` <- `components` <- `app`.

The pull request page and the agent editor share no route ancestor other than the app root, so the nearest common ancestor is not a segment - it is `client/src/components/`.
That folder is already the home for exactly this kind of piece: `eval-case-modal`, `diff-viewer`, `context-doc-list`, `doc-markdown` and `mermaid-diagram` all sit there and are mounted from more than one route.
The drawer moves there, keeping its own folder with its component, `_components`, `constants`, `helpers`, `styles`, `index` and its test, and it goes on reaching data the same way it does now - through `src/lib/hooks/*`, never a raw fetch.

The exact folder name is the plan's to choose; the constraint is that after the change no route's `_components` folder contains it and both screens import the same one.

## Acceptance criteria (EARS)

**AC-1**
The system shall offer a Runs tab in the agent editor, after the Evals tab.
Observed at: the agent editor's tab strip.

**AC-2**
WHEN the Runs tab is selected, the system shall carry that selection in the page's `tab` query parameter, as the editor's other tabs do.
Observed at: the URL after selecting the tab, and the tab shown after reloading that URL.

**AC-3**
WHILE the Runs tab is shown, the system shall list only runs of the agent being edited.
Observed at: the listed runs, compared against the agent runs recorded for that agent.

**AC-4**
The system shall order the list by the time each run started, newest first.
Observed at: the order of the rows.

**AC-5**
The system shall include a run in the list regardless of whether its source is a studio run or a CI run.
Observed at: a list containing one run of each source.

**AC-6**
The system shall show on each row when the run started, the pull request it ran on, its status, its findings count, its score, its duration, its cost and its source.
Observed at: one row of the list.

**AC-7**
IF a run failed, THEN the system shall show that run's recorded error on its row.
Observed at: the row of a failed run.

**AC-8**
IF a run has no pull request, THEN the system shall show the row without one rather than omitting the row.
Observed at: the row of a run whose pull request was deleted.

**AC-9**
IF the agent has no runs, THEN the system shall state that the agent has not run yet and where a run is started from, instead of an empty list.
Observed at: the Runs tab of a newly created agent.

**AC-10**
WHEN a row is activated, the system shall open the run trace drawer for that run.
Observed at: the drawer, showing that run's identity.

**AC-11**
The system shall show in that drawer the same trace sections the pull request page shows - configuration, stats, prompt assembly, tool calls, raw output and the run log.
Observed at: the drawer opened from the Runs tab and from the pull request page for the same run.

**AC-12**
IF a run has no persisted trace, THEN the system shall show the drawer with a statement that no trace was recorded for this run, instead of an error.
Observed at: the drawer opened for a run whose trace read returns nothing.

**AC-13**
WHILE the opened run is still in flight, the system shall show its live log, as the drawer already does for a running run.
Observed at: the drawer opened from the Runs tab for a run in progress.

**AC-14**
WHEN the drawer is closed, the system shall return keyboard focus to the row that opened it.
Observed at: the focused element after closing the drawer.

**AC-15**
The system shall mount one and the same trace drawer component on the pull request page and on the Runs tab.
Observed at: the import path used by both screens, and the absence of the drawer from any route's `_components` folder.

**AC-16**
The system shall leave the pull request page's trace behaviour unchanged by the move.
Observed at: the pull request page's existing trace drawer tests, which pass without modification to their assertions.

**AC-17**
The system shall load the list in one request.
Observed at: the network activity when the Runs tab is opened, which contains no per-run request.

**AC-18**
The system shall request a run's trace only when that run's drawer is opened.
Observed at: the network activity while the list is shown with no drawer open.

## Edge cases

| Case | Behaviour |
| --- | --- |
| A brand new agent | The empty state (AC-9). |
| An agent with one run | A single row; no pagination control. |
| An agent with 500 runs | The 50 most recent are listed with a control to load more; the list is never unbounded. |
| A run still in flight when the tab is opened | Shown as running, and opening it shows the live log (AC-13). |
| A cancelled run | Shown with its cancelled status; its trace opens if one was written, otherwise AC-12 applies. |
| A run whose pull request was deleted | AC-8: the row survives, without a pull request. |
| A run recorded before the agent's current version | Listed normally; the drawer shows the configuration that run recorded, not the agent's current one. |
| A 200-character pull request title | Truncated on the row, in full in the drawer's title context. |
| Two runs at the same timestamp - the ordinary case after a multi-agent run of the same agent, or two runs started in the same second | Both listed; the order between them is stable across reloads. |
| The trace request fails with a network error rather than a missing trace | The drawer shows a retry, distinct from the "no trace recorded" state of AC-12. |
| Keyboard-only user | Every row is reachable by tab and activates with Enter or Space; the drawer traps focus and returns it on close (AC-14). |
| Narrow viewport | The row's secondary fields - cost, duration, source - wrap onto a second line rather than being dropped; the drawer keeps its own width behaviour. |

## Non-functional requirements

- **One request per tab open**, returning at most 50 rows (AC-17).
- **No model call anywhere in this feature.**
  Every value shown is read from a recorded row or a recorded trace.
- **No new persisted data.**
  No table gains a column for this tab.
- **The list renders within 200 ms of its response arriving**, at the 50-row cap, because a row is a formatting pass over fields that are already scalar.
- **The move is behaviour-preserving.**
  The pull request page's existing drawer tests are the regression check (AC-16).

## Inputs and provenance

| Input | Source | Absence means |
| --- | --- | --- |
| The agent's identity | The route the editor is on | Not possible: the tab only exists inside an agent's editor. |
| The agent's runs | Recorded `agent_runs` rows for that agent | No runs means the empty state (AC-9). |
| Each run's pull request number and title | The pull request the run recorded | The row shows no pull request (AC-8). |
| Each run's source | The run row's source field, defaulted to `local` | Cannot be absent; it has a non-null default. |
| One run's trace | The persisted trace document | The drawer says no trace was recorded (AC-12). |
| A running run's live events | The existing run event stream | The drawer falls back to whatever trace exists, as it already does. |

## Untrusted inputs

This feature introduces **no new untrusted input** and no new trust boundary.
It is a second way to reach data the product already stores and already renders.

| Untrusted input | Where it comes from | What it may never be allowed to do |
| --- | --- | --- |
| The raw model output shown in the drawer's raw-output section | The provider | Execute or render as markup. It is displayed as text in the existing drawer, unchanged by this spec, and copied to the clipboard as text. |
| The prompt assembly shown in the drawer, which embeds the diff, the pull request body and any project documents | Third parties, through the run that assembled it | Be re-sent anywhere. It is a record of a past run, displayed read-only; nothing on this tab feeds it back into a prompt. |
| A pull request title shown on a row | The pull request author | Break the row's layout or render as markup. It is truncated (see Edge cases) and rendered as text. |
| A run's recorded error message | The provider or the runtime | Render as markup, or carry a secret. It is displayed as text, and the existing run pipeline is what decides what goes into that field; this spec adds nothing to it. |

## Design review

| Line | State | Detail |
| --- | --- | --- |
| No mockup was provided for the Runs tab | **accepted** | The tab is stated in prose in the request. Its row content is fixed by AC-6 rather than by a picture, and the drawer it opens is an existing screen. |
| No mockup was provided for the empty state | **accepted** | Covered by AC-9. |
| No mockup was provided for a failed row | **accepted** | Covered by AC-7. |
| No mockup was provided for a run with no trace | **accepted** | Covered by AC-12, and separated from a failed trace request in Edge cases. |
| The row could show the run's model and provider | **open** | An agent's model can change between runs, and two runs of "the same agent" on different models are not comparable. Cost of not showing it: the user compares two traces before noticing the model changed. |
| The row could show the grounding summary | **open** | It is already recorded on the run row and is the single best one-glance signal of a prompt that started hallucinating locations. Cost of not showing it: the user opens each trace to find it. |
| The tab could offer a source filter | **open** | Deferred until CI runs exist; with every row reading `local` a filter is a control with one setting. Cost of not doing it: once CI runs exist, a busy agent's list mixes two kinds of run with only a badge to tell them apart. |

## Open questions

1. **Nothing writes a CI-sourced run today.**
   `agent_runs.source` exists with a `local` default, and the only writer, `createAgentRun`, hardcodes `source: 'local'`.
   AC-5 is written as "the list does not filter by source", so a CI run appears the moment such rows exist, and AC-6 shows the source on the row from the first day.
   The spec assumes CI-sourced runs are produced by a later lesson and that no part of this one creates them.

2. **Where the per-agent run list is served from.**
   `agent_runs` is owned by the `reviews` module's run repository, while the screen asking for it is the agent editor.
   The spec assumes the read stays with the module that owns the table and says nothing about the route it is exposed on; that placement is the plan's decision, constrained only by the repository's own layering rules.

3. **The 50-row cap and its load-more control.**
   Chosen so that the first paint is bounded rather than by measurement of a real agent's run count.
   If a course exercise produces agents with hundreds of runs, the number is the thing to change.
