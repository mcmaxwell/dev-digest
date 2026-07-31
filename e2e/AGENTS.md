# @devdigest/e2e — deterministic browser flows

Vercel agent-browser (Rust + CDP CLI) driven by `run.ts`. No Playwright, no
LLM, no API keys. A flow = `specs/NN-name.flow.json`, a JSON list of
agent-browser commands run in order against one shared session.

## Commands

```sh
../scripts/e2e.sh   # HERMETIC (recommended): isolated seeded stack on
                    # :5433/:3101/:3100, runs flows, tears down
npm test            # against your running stack — ONLY safe if the dev DB
                    # contains nothing but the seeded repo
```

## Rules

- Locators must stay deterministic: `--url`, `--text`, `find role|text|label`.
  NEVER use the AI `chat` command — it breaks determinism and needs keys.
- Assertions ARE the waits: `wait --text` / `wait --url` exit non-zero on
  timeout and fail the step. Optional `"assert": {"stdoutIncludes": …}`.
- Flows target read-only seeded data only (repo `acme/payments-api`, PR #482,
  seeded agents) — nothing may trigger a model call or mutate state.
- `{BASE}` in specs is replaced with `E2E_BASE_URL`.

## Gotchas

- Flows 02/04/05 follow the home redirect to the FIRST repo — they require a
  freshly-seeded DB where the demo repo is the only one. That's why the
  hermetic runner exists; a dev DB with imported repos makes them fail.
- NEVER `docker compose down -v` to reset the dev DB — it deletes the
  `devdigest_pgdata` volume with all real imported data.
- Failure screenshots land in `test-results/` (git-ignored, uploaded by
  `.github/workflows/e2e-web.yml`).
- One-time local setup: `npm i -g agent-browser && agent-browser install`.

## Read when…

- …spec format, env knobs, coverage table → `README.md`
- …overall test strategy → `../TESTING.md`
- …before starting a task here → `INSIGHTS.md`
  (note: `specs/` here holds the flow JSONs, not feature specs — feature specs
  live in `../docs/specs/`)
