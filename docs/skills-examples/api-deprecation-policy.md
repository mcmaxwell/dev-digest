---
name: api-deprecation-policy
description: Require a deprecation window — flag public surface deleted outright instead of marked and phased out.
type: convention
---

# Deprecation policy

Public surface is retired in TWO steps, never one. A diff that deletes a public
route, field, export or enum value in a single change is a finding even when the
repository itself has no remaining callers — the callers you cannot see are the
point.

Step 1 (this release): mark it.

- Annotate the declaration (`@deprecated`, naming the replacement and the removal date).
- Keep it working and returning the same values.
- Signal it where callers will actually notice: a `Deprecation` / `Sunset` response
  header, a logged warning, or a documented note.

Step 2 (a later release, after the window has passed): delete it, with the major bump.

Report as **CRITICAL** a deletion with no prior deprecation. Report as
**SUGGESTION** a deprecation marked without a replacement or a removal date —
"deprecated forever" is not a plan, and callers cannot act on it.

## Bad — one-step removal

```ts
- /** Total in cents. */
- export function orderTotal(id: string): number
+ export function orderTotalMinor(id: string, currency: string): bigint
```

The old export is gone in a single change. Every external caller breaks at import
time, with no warning and no window in which to migrate.

## Good — marked, then removed later

```ts
/** @deprecated Use `orderTotalMinor`. Removed in v4.0.0 (2026-09-01). */
export function orderTotal(id: string): number {
  return Number(orderTotalMinor(id, 'USD'));
}

export function orderTotalMinor(id: string, currency: string): bigint { … }
```

Both work; the compiler nudges callers at every remaining call site; the removal
date makes the window real instead of indefinite.

## Same rule at the HTTP layer

```ts
// Bad:  app.get('/v1/orders/:id', …)  simply deleted.
// Good:
app.get('/v1/orders/:id', async (req, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', 'Tue, 01 Sep 2026 00:00:00 GMT');
  reply.header('Link', '</v2/orders/:orderId>; rel="successor-version"');
  return legacyHandler(req);
});
```
