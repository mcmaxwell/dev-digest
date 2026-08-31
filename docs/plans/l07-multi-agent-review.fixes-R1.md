# Fixes - round 1 for l07-multi-agent-review

Source: UI fidelity pass, round 1, driven against a live stack on real data
(API :3001, web :3100, a multi-agent run assembled in the dev DB from five real
agent runs on PR #66). Findings are design-fidelity and layout defects; none of
them breaks a written boundary rule, and `arch-evidence`, `architecture-reviewer`
and `plan-verifier` all came back clean.

Scope fence: these six steps are the whole of this round. Nothing here changes a
contract, a route, a query, the schema, or any acceptance criterion. If a fix
appears to need one of those, stop and report instead.

## Step 1 - the score ring is missing on both multi-agent views

- File: `client/src/app/repos/[repoId]/multi-agent/[runId]/_components/MultiAgentResultsView/MultiAgentResultsView.tsx:171,287,302`
- Finding: "Кільця score немає ніде на екранах мультиагента. У макеті це домінантний елемент (38/64/72/58 у кольоровому кільці). У реалізації - дрібний сірий моноширинний текст `score 100`."
- Rule broken: none - design fidelity against the two results mockups, plus internal inconsistency: the pull request page already renders a ring for the same number.
- Do: use the EXISTING `CircularScore` primitive, already exported from `@devdigest/ui` (`client/src/vendor/ui/primitives/index.ts:11`) and already used at `VerdictBanner.tsx:52` (`size={52} stroke={5}`), `RunHistory.tsx` and `PRRow.tsx`. Render it in the columns view's column header and in the tabs view's summary card. Nothing is promoted and nothing is written from scratch - this is an import.
- Do not: build a new ring; change `CircularScore`; edit anything under `client/src/vendor/ui/`; remove the numeric score text (it is what carries the value to a screen reader).
- Done when: a column header and the tabs summary card each show a `CircularScore` for an agent whose score is not null, and an agent with a null score still renders without one.

## Step 2 - agents have no colour identity

- Files: `client/src/app/repos/[repoId]/multi-agent/[runId]/_components/MultiAgentResultsView/**` , `client/src/app/repos/[repoId]/multi-agent/new/_components/MultiAgentConfigureView/**`
- Finding: "Макет дає кожному агенту свій колір - Security червоний, Performance бурштиновий, Junior Mentor синій, Customer-Facing фіолетовий, Architecture бірюзовий - на плитці іконки, верхній рамці картки, кільці вибраного рядка, підкресленні таба. У реалізації все сіре, а вибір усюди однаково синій. Саме колір робить макет читабельним з одного погляду; без нього п'ять колонок виглядають однаково."
- Rule broken: none - design fidelity against all four mockups.
- Do: add a fixed palette to the results view's `constants.ts` and assign a colour BY INDEX in the run's stable agent order - the same order Step C2 already defines (agent name ascending, then agent-run id). Because that order is deterministic, an agent keeps its colour across reloads and between the configure and results screens. Apply it to the agent's icon tile, the column card's top border, the selected row's ring on the configure screen, and the active tab's underline.
- Do not: add a colour column to `agents` or any contract - the palette is presentational and lives in the client; derive colour from a hash of the agent id (unstable-looking and collides); let colour become the ONLY carrier of any meaning - every agent name, severity and stance stays in text, per the accessibility requirement the specs already set.
- Done when: five agents in one run render in five distinguishable colours, the same agent shows the same colour on the configure and results screens, and turning colour off still leaves every agent, severity and stance readable as text.

## Step 3 - the columns view overflows at five agents

- File: `client/src/app/repos/[repoId]/multi-agent/[runId]/_components/MultiAgentResultsView/MultiAgentResultsView.tsx` (the columns strip)
- Finding: "Виміряно: `scrollWidth 1548` проти `clientWidth 1278` - 270px ховається за горизонтальним скролом на екрані 1600px, п'ятий агент обрізаний посеред слова."
- Rule broken: the main spec's Edge cases - "the columns view falls back to the tabs view rather than compressing" - which the implementation keys to viewport width alone, so a wide screen with five agents still overflows.
- Do: make the fallback depend on whether each column can get a readable minimum width in the space actually available, not on the viewport alone. When `agentCount x minColumnWidth` exceeds the container, render the tabs view instead. Keep one minimum-width constant in `constants.ts` with a comment saying what it is for.
- Do not: shrink columns below the readable minimum to force a fit; hide agents; introduce a horizontal scrollbar as the answer - the spec chose the tabs fallback precisely to avoid it.
- Done when: five agents at 1600px render without horizontal overflow, no agent is clipped, and a component test asserts the fallback fires on agent count and not only on width.

## Step 4 - the landing page inherited the configure screen's subtitle

- Files: `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentLandingView/MultiAgentLandingView.tsx` , `client/messages/en/runs.json`
- Finding: "Landing успадкував підзаголовок конфігуратора: 'Pick a pull request and choose which agents to fan out…' описує дію, якої на цій сторінці зробити не можна. Протекло, коли доповнення E2 розділило маршрути."
- Rule broken: none directly, but it contradicts amendment 01's own split - the landing lists past runs and the configure screen is what picks a pull request.
- Do: give the landing its own subtitle describing what the page is (this repository's multi-agent reviews, and where to start a new one). Leave the existing sentence on `/new`, where it is correct. New strings go through next-intl like every other; plain hyphen only, never an em dash.
- Do not: delete the sentence from the configure screen; invent copy for any other screen.
- Done when: the landing and the configure screen each carry a subtitle that describes the screen the reader is on.

## Step 5 - the tabs summary card is a wall of text

- File: `client/src/app/repos/[repoId]/multi-agent/[runId]/_components/MultiAgentResultsView/MultiAgentResultsView.tsx:296-297`
- Finding: "Картка підсумку в Tabs - стіна тексту на 6 рядків. Макет припускав однорядковий вердикт, реальний `Review.summary` це абзац."
- Rule broken: none - a design assumption that real data breaks. AC-35 requires the persisted summary VERBATIM, so the text may be clamped visually but never truncated in the DOM or rewritten.
- Do: clamp the summary to two lines with an expand control that reveals the rest in place. The full string stays in the DOM and reachable, so AC-35 still holds.
- Do not: truncate the string in JavaScript; summarise it; send it through a model; hide it behind a link away from the page.
- Done when: a six-line summary renders clamped with a working expand, and a test asserts the full text is present in the DOM while collapsed.

## Step 6 - raw timestamps with seconds

- Files: `client/src/lib/format.ts` , `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentLandingView/MultiAgentLandingView.tsx` , `client/src/app/agents/[id]/_components/AgentEditor/_components/RunsTab/RunsTab.tsx`
- Finding: "Сирі таймстемпи - `8/28/2026, 8:55:16 PM` із секундами, дефолтний `toLocaleString`."
- Rule broken: none - polish. Note for the implementer: the app has NO relative-time helper today (the repo switcher renders a bare "synced", and the mockup's "synced 2m ago" was never built), so do not go looking for one.
- Do: add one shared formatter to `client/src/lib/format.ts`, beside the existing `formatUsd`, that renders a run timestamp without seconds, and use it in the landing rows and the Runs tab rows.
- Do not: build a relative-time ("2m ago") system - that is a product decision nobody made; change `formatUsd`; change the trace drawer's own time rendering.
- Done when: both surfaces render a run's time without seconds, through one shared function, covered by a unit test.

## Verification for the whole round

- `cd client && pnpm test`
- `cd client && pnpm lint`
- `cd client && pnpm typecheck`
- `cd client && pnpm build`
- No server, contract, schema or route file is touched: `git status --short server/` shows nothing new beyond what round 0 already changed.

## Noticed, deliberately NOT in this round

`formatUsd` returns the em dash character for an unknown cost (`client/src/lib/format.ts:11`, and its doc comment names it). That reaches the new multi-agent screens through the partial-cost path, and it contradicts the user's standing rule against that character. It is pre-existing, and changing it also changes the pull request list and the timeline, so it is reported rather than fixed here.
