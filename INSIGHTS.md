# Insights — repo-wide

Append-only lessons that span packages. One bullet each: the gotcha + how to
avoid it. Package-specific lessons go to `<package>/INSIGHTS.md` instead.

- `@devdigest/shared` exists as two vendored copies (`server/src/vendor/shared`
  canonical, `client/src/vendor/shared` for the client) — contract changes must
  be applied to both, there is no sync script.
