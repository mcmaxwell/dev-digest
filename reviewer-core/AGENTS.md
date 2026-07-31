# @devdigest/reviewer-core — pure review engine

diff + repo map → `assemblePrompt` → LLM (injected `LLMProvider`) → structured
output → `groundFindings` gate → Review (verdict · score · findings).

## Commands

```sh
npm test           # hermetic vitest, stubbed LLMProvider — no keys, no network
npm run typecheck  # doubles as the build — the package NEVER emits JS
```

## Rules

- PURE package: no DB, no fs, no GitHub, no network imports. The only side
  effect is the injected `LLMProvider` (`llm/openrouter.ts` in prod).
- Server consumes the TS SOURCE via alias `@devdigest/reviewer-core` →
  `../reviewer-core/src` (tsx in dev, vitest in tests) — don't add build steps.
- Grounding is mandatory: findings that don't cite a real diff line are
  dropped; the score is recomputed from survivors — the model's self-reported
  score is always ignored. Never weaken this gate.
- All untrusted content (diff, PR body, comments) goes through
  `wrapUntrusted()` + `INJECTION_GUARD` in `prompt.ts` — the defense is the
  trusted rule, not keyword scanning.
- Contracts (`Review`, `Finding`, `Verdict`, …) come from `@devdigest/shared`
  (aliased to `../server/src/vendor/shared`) — never redefine locally.

## Mini-map

```
src/prompt.ts     assemblePrompt · wrapUntrusted · INJECTION_GUARD
src/grounding.ts  groundFindings · groundingSummary
src/llm/          openrouter provider · structured.ts (Zod→JSON Schema, parse-with-repair)
src/review/run.ts run orchestration (single-pass default) · reduce()
src/output/       toReview CI payload helper (used from L06)
src/index.ts      the whole public API — export new things here
```

Optional prompt slots (`skills`, `memory`, `specs`, `callers`) exist for later
lessons; the starter server passes only diff + system prompt + repo map, and
`assemblePrompt` omits empty sections.

## Read when…

- …pipeline details / public API → `README.md`
- …how the server feeds inputs → `../server/README.md` (Review context section)
- …before starting a task here → `INSIGHTS.md`; specs → `specs/`
