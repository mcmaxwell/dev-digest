# Fixes - round 1 for l06-export-ci-next

Source: architecture-reviewer round 1 over the full change-set (`git diff 95b1008`).
One BLOCKING row. Every other round-1 row was accepted by the user and is NOT in scope here.

## Why the reviewer's own fix direction is not the one below

The reviewer proposed moving `reviewDiff` into `modules/_shared/`. That was checked
before writing this and it does not hold: `server/src/modules/reviews/diff-review.ts`
imports `./constants.js` (`DIFF_REVIEW_MAX_FILES`, `DIFF_REVIEW_TASK`,
`REVIEW_STRATEGY`) and `./helpers.js` (`skillToBlock`). Moving the file would make
`modules/_shared/` depend on `modules/reviews/`, which is a shared layer reaching
into a module - worse than the seam being replaced.

`no-cross-module-imports` names three legal ways to share
(`server/.dependency-cruiser.cjs:47-52`): `modules/_shared/`, the vendored Zod
contracts, or a Container getter - plus the stated EXCEPTION, "a module may
construct another module's SERVICE (polling -> pulls/service)". The fix below uses
that exception literally, which is the smallest change that satisfies the rule in
spirit as well as letter, and it moves no files.

## Step 1 - Make the diff review a real `ReviewService` method

- File: `server/src/modules/reviews/service.ts`
- Finding: "the `reviews/service.ts` re-export of `reviewDiff` is the letter of
  `no-cross-module-imports`, not its documented seam. The rule's exception exists
  for one shape - composing another module's stateful service class, the way
  `polling` genuinely reuses `pulls`'s encapsulated sync logic. Here the 'service'
  is a pass-through: a comment admits the re-export exists solely because the regex
  happens to whitelist `service.ts`, not because `ci` is composing `ReviewService`."
- Rule broken: `no-cross-module-imports`, `server/.dependency-cruiser.cjs:47-52` -
  the exception is for CONSTRUCTING another module's service, not for re-exporting
  a free function through it to clear a path regex.
- Do:
  - Add a `diff(...)` method to `ReviewService` that delegates to the existing
    `reviewDiff` function, with the same parameters minus `container` (the service
    already holds one) and the same return type.
  - DELETE the `export { reviewDiff } from './diff-review.js';` line and the
    four-line comment above it that explains the regex workaround
    (`reviews/service.ts:14-17`).
- Done when: `server/src/modules/reviews/service.ts` contains no
  `export { reviewDiff }` and `ReviewService` has a `diff` method.

## Step 2 - `ci` composes the service instead of importing the function

- File: `server/src/modules/ci/service.ts`
- Do:
  - Replace `import { reviewDiff } from '../reviews/service.js';` with
    `import { ReviewService } from '../reviews/service.js';`
  - At the call site (`service.ts:161`), construct and call:
    `await new ReviewService(this.container, logger).diff({...})` - matching how
    `polling` constructs `PullsService` (`modules/polling/*.ts`). Check
    `ReviewService`'s actual constructor signature first and match it; do not
    invent one.
  - Keep the behaviour identical: same input object, same `fail_on` resolution via
    `failOnToSeverity`, same error propagation.
- Done when: `ci/service.ts` imports a CLASS from `reviews/service.js`, not a
  function, and `pnpm arch:check` still passes.

## Step 3 - Leave the existing consumer alone unless it is free to change

- File: `server/src/modules/reviews/routes.ts`
- Do: `routes.ts:10,79` imports `reviewDiff` from `./diff-review.js` directly. That
  is a SAME-MODULE import and breaks no rule, so leave it as it is. Change it only
  if leaving it would make Step 1 impossible.
- Done when: `reviews/routes.ts` is either untouched or switched to the method with
  no behaviour change.

## Constraints

- Write NO new tests and add NO new test case. If an existing test breaks, the fix
  is wrong - report it rather than editing the test to match.
- Touch ONLY `server/src/modules/reviews/service.ts`, `server/src/modules/ci/service.ts`
  and, if unavoidable, `server/src/modules/reviews/routes.ts`. Nothing else.
- Do not move `diff-review.ts`, do not create `modules/_shared/diff-review.ts`, and
  do not add a Container getter - both were considered and rejected above.
- Do not touch `.gitignore` (pre-existing, someone else's work).
- Do not commit, stage or push.

## Stop conditions

- `ReviewService`'s constructor cannot accommodate the call without changing its
  signature for existing callers - STOP and report; that is a design change, not a fix.
- The change requires editing more than the three files listed - STOP and report.
- `pnpm arch:check` fires a new violation - STOP; the placement is wrong, not the rule.

## Verify

```
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'
```
All three must pass, with the server suite still at 47 files / 602 tests.
