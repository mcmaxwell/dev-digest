# Routing: change-set files → skills

Only groups with matching files run. A file can belong to several groups.
Adding a new skill = one row here.

| # | Files in the change-set (glob) | Skills to load | Group |
|---|---|---|---|
| 1 | `client/app/**`, `client/src/**/*.tsx`, `client/src/lib/hooks/**` (excl. `client/src/vendor/**`) | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | UI |
| 2 | `client/**/*.test.ts(x)` | `react-testing-library` | UI tests |
| 3 | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/src/**` | `onion-architecture` | Backend architecture |
| 4 | `server/src/**/routes*.ts`, `server/src/app.ts`, `server/src/plugins/**` | `fastify-best-practices` | HTTP |
| 5 | `server/src/db/**` (excl. `migrations/`) | `drizzle-orm-patterns`; schema files additionally `postgresql-table-design` | DB |
| 6 | `**/vendor/shared/**`, files defining `z.object` schemas | `zod` | Contracts |
| 7 | Any route with input handling, auth, file upload, secrets usage, `child_process`/`exec` (UI **and** backend) | `security` | Security |
| 8 | `mcp/src/**`, `mcp/scripts/**`, `mcp/bin/**`, `scripts/mcp.sh` | `security`, `zod`; rules from `mcp/AGENTS.md` | MCP server |

Group 8 exists because rows 1-7 miss this package almost entirely: it is not
`client/`, not `server/src/`, not `reviewer-core/`. Rows 6 and 7 would catch
some of it by content, but only by accident, and neither knows the invariants
that actually matter here. `mcp/AGENTS.md` is the rule source for that group
the way a skill is for the others: stdout is the JSON-RPC channel, flat schemas
only, no bare throws to the model, no `system_prompt` in any result.

Not routed (not review skills): `engineering-insights`, `mermaid-diagram`,
`typescript-expert`.

## Critical criteria — the ONLY things that may be `critical`

A finding is `critical` iff it matches one of these; everything else is at
most `major`.

**Deterministic layer** (checked by `scripts/pr-self-review-checks.sh run`):
1. Changes under do-not-touch paths (`server/clones/**`,
   `client/src/vendor/ui/**`, `.env*` except `.env.example`).
2. Hand-edited generated migrations (migrations changed, schema untouched).
3. Vendored `@devdigest/shared` drift: file touched in one copy, counterpart
   not updated.
4. Secret-shaped strings in added lines.
5. Hand-parsed request body in server code (`JSON.parse(req.body…)`).
6. DB-backed server test without the `*.it.test.ts` suffix.
7. `pnpm arch:check` (dependency-cruiser) violations.

**LLM layer:**
8. Onion dependency-rule violation not caught by depcruise (e.g. domain code
   importing an adapter type, business logic in a route handler).
9. reviewer-core purity break: DB / fs / GitHub imports, or LLM use outside
   the injected `LLMProvider`.
10. Route without schema-first validation (missing zod schema on
    body/params/query).
11. Exploitable security issue from the `security` skill's OWASP set
    (injection, authz bypass, path traversal, SSRF, unsafe upload).
12. Client component fetching/mutating server data outside the established
    hook layer (`src/lib/hooks/*`) in a way that breaks the app's data flow
    (per `frontend-ui-architecture`).
13. An MCP tool result renders text that originated in a reviewed repository
    without flattening it. Finding titles, file paths, review summaries and
    scan/run errors are LLM output derived from somebody else's diff, and no
    contract bounds their length or newlines: rendered raw into a
    newline-delimited result they forge lines - a fake CRITICAL, a fake
    verdict - in the reading agent's context. Pass them through `clip()`.
    (Also: a 5xx body is never relayed to the model; outside production the
    API sends the raw `e.message`, which can carry a filesystem path.)

## PR-hygiene checklist (orchestrator, no subagent)

- Schema changed → migration present (deterministic layer reports it as MAJOR).
- New/changed business logic → are there tests touching it? If none: MAJOR.
- Both `vendor/shared` copies updated together when contracts changed.
- No stray files: editor configs, `.DS_Store`, debug scripts, large binaries.
- Lockfile changed → was a dependency actually added/updated on purpose?
- An `mcp/` tool description or input schema changed → `cd mcp && pnpm budget`
  re-run and still under budget? Those strings are loaded into the system
  prompt of every session, so growing one is a deliberate decision, never a
  side effect of a refactor.

## Subagent prompt template

```
Load the <skill> skill and review ONLY these files from a local branch diff
(pre-PR self-review). Judge only changed lines; unchanged code is context.

Files: <list>
Diff hunks:
<hunks>

Critical criteria (a finding may be marked critical ONLY if it matches one):
<relevant subset of the numbered list above>

Return findings as a JSON list:
[{severity: "critical"|"major"|"minor", file, line, rule: "<rule name from the
skill>", why: "<one sentence>", fix: "<minimal concrete change>"}]
Return [] if the changed lines are clean. Do not invent findings to seem
useful; an empty list is a valid, good result.
```

## Quick mode (41–150 files)

Subagents receive only the critical criteria (8–13) and check nothing else;
PR-hygiene checklist still runs; report must state that major/minor depth was
skipped.
