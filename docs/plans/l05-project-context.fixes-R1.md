# Fixes - round 1 for l05-project-context

Source: plan-verifier round 1 over the full change-set (`.claude/last-change.json`, 66 entries).

Gate decision by the owner: the **semantics stay as implemented** - a blank document body is a
legal empty document, not an absent one, because AC-13 reads "IF reading a selected document
**fails**" and a successful read of an empty file is not a failure. The accepted finding is
narrower: the server side of AC-13's failure branch has no test that forces it.

Everything else from round 1 was accepted as ADVISORY and is not in scope here.

## Step 1 - force the `readDoc` failure branch in an integration test

- File: `server/src/modules/project-context/context.it.test.ts`
- Finding, verbatim from plan-verifier: "`DocViewer.tsx:66-72` implements this for a thrown
  `readFile`, but `readDoc` (`service.ts:226-251`) never checks for a blank body, so a document
  that has gone unreadable-but-blank (the shape `MockGitClient` actually produces, per
  `server/INSIGHTS.md:250-253`) is served as content `""` - a 200, not the failure state."
- What is actually wrong: not the blank-body semantics, but that no server test drives
  `GET /repos/:id/context/doc` into its failure branch at all. `grep` for `throw` in
  `context.it.test.ts` returns nothing; the throwing-stub path (`git.unreadable`) is exercised
  only in `assembly.it.test.ts:352-387`, on the run path, never on the read path.
- Rule / criterion at stake: **AC-13** - "IF reading a selected document fails, THEN the system
  shall render the failure with the document's path and a retry control, and leave the tree
  selection unchanged." The client half is tested; the server half that produces the failure the
  client renders is not.
- Do:
  - Add one test to `context.it.test.ts` that adds a path to the fixture git client's `unreadable`
    set (the same mechanism `assembly.it.test.ts` already uses - reuse it, do not invent a second
    stub shape) and asserts `GET /repos/:id/context/doc?path=…` returns a failure response for a
    document that IS present in the current scan, rather than a 200 with empty content.
  - Assert the response carries the document's path, since that is what AC-13 requires the client
    be able to render.
  - Clear the `unreadable` set at the end of the test, exactly as `assembly.it.test.ts:385` does,
    so the fixture does not leak into the next test in the file.
- Do NOT:
  - Do not add a blank-is-missing check to `readDoc`. The owner ruled explicitly that an empty
    `.md` renders as an empty document. Changing `service.ts` here would be the opposite of the
    decision this addendum records.
  - Do not touch `assembleForRun`'s blank-is-missing branch - that one is correct and tested.
  - Do not touch any other file. If the test cannot be written without a production change, stop
    and report rather than making one.
- Done when: `cd server && pnpm exec vitest run .it.test --no-file-parallelism` passes with the
  new test present, AND the new test genuinely fails when the `unreadable` line is removed from it
  (verify this once by hand, then restore it) - a test that passes either way tests nothing.
- Verify: `cd server && pnpm exec vitest run .it.test --no-file-parallelism`, and re-run the
  project-context files individually, because the lane's `dockerAvailable()` probe can lose a race
  and silently SKIP whole files - a green lane summary is not proof this file ran.
