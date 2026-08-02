---
name: flaky-test-patterns
description: Flag test patterns that make suites flaky — real timers, order coupling, unseeded randomness.
type: convention
---

# Flaky test patterns

Scan added/changed tests for the classic flakiness sources and flag each with the
concrete failure mode it will eventually produce:

1. **Real time** — `setTimeout`/`sleep` waits, `Date.now()` assertions, timeouts
   tuned to "usually enough". Fails on a slow CI runner. Suggest fake timers or
   awaiting the actual condition.
2. **Order coupling** — a test that only passes after another test ran (shared
   fixture rows, module-level mutable state, un-reset mocks). Fails when the
   runner shuffles or filters. Suggest per-test setup/teardown.
3. **Unseeded randomness** — `Math.random()`, random ports, generated ids asserted
   literally. Suggest seeding or asserting shape, not value.
4. **Real network / filesystem in unit tests** — DNS hiccups and tmpdir races.
   Suggest the project's mock adapters instead.
5. **Race-prone async assertions** — asserting immediately after firing an event,
   `.then()` without await in a test body. Suggest awaiting the promise or using
   the framework's async matchers.

Severity: WARNING per pattern; SUGGESTION when the test is unlikely to run in CI.
Cite the test file:line for every flag.
