import type { SkillType } from '@devdigest/shared';

/**
 * Built-in skills used by the seed (L02). A skill's DESCRIPTION is its
 * interface — a directive one-liner the user (and the skills list) reads;
 * the BODY is the markdown block appended to the agent's prompt.
 *
 * Like seed-prompts.ts: the DB row is the source of truth at run time;
 * editing here only affects freshly seeded workspaces.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description: 'Hold every finding to the quality rubric: concrete defect, cited line, actionable fix.',
    type: 'rubric',
    body: `# PR quality rubric

Before reporting a finding, hold it to this rubric — drop anything that fails:

1. **Concrete** — names the exact defect, not a vibe ("this may be fragile").
2. **Cited** — points at a real file:line in the diff.
3. **Consequential** — describes what actually goes wrong in production and when.
4. **Actionable** — the suggestion tells the author what to change, not "consider improving".
5. **Proportionate** — the severity matches the consequence you described.

If two findings share a root cause, merge them and cite the root cause once.`,
  },
  {
    name: 'no-then-chains',
    description: 'Flag new .then()/.catch() chains — this codebase is async/await only.',
    type: 'convention',
    body: `# No .then() chains

This codebase uses async/await exclusively.

- Flag any NEW \`.then(\` / \`.catch(\` promise chain added by the diff (WARNING).
- Suggest the equivalent async/await form with try/catch.
- Exceptions: a single trailing \`.catch(() => undefined)\` used as a fire-and-forget
  guard, and \`Promise.all/allSettled\` composition — do not flag those.
- Do not flag pre-existing chains the diff merely moves.`,
  },
  {
    name: 'secret-leakage-gate',
    description: 'Treat any credential-shaped literal added by the diff as a CRITICAL leak.',
    type: 'security',
    body: `# Secret leakage gate

Scan added lines for credential-shaped literals:

- API keys and tokens: \`sk_live_\`, \`sk-\`, \`ghp_\`, \`gho_\`, \`AKIA\`, \`xox[bpo]-\`,
  \`service_role\`, long high-entropy strings assigned to *KEY*/*TOKEN*/*SECRET* names.
- Private keys: \`-----BEGIN ... PRIVATE KEY-----\`.
- Connection strings with inline passwords (\`postgres://user:pass@\`).
- \`NEXT_PUBLIC_\`-prefixed env vars carrying anything secret (they ship to the browser).

Any real match is **CRITICAL** — a committed secret is compromised even if the line
is later removed; the fix must include rotation, not just deletion. Placeholders
(\`sk_live_xxx\`, \`<YOUR_KEY>\`, obvious test fixtures) are not findings.`,
  },
  {
    name: 'lethal-trifecta',
    description: 'Flag flows where untrusted content, private data and an exfil path meet in one agent.',
    type: 'security',
    body: `# Lethal trifecta

Watch for the AI-agent data-exfiltration pattern: one flow that combines

1. **Untrusted content** entering an LLM/agent (PR body, web page, file, tool output),
2. **Private data** the same agent can read (secrets, DB rows, internal APIs),
3. **An exfiltration path** (outbound HTTP, tool call, attacker-readable output).

Only report it when you can cite a concrete file:line for ALL three legs of the flow.
A normal authenticated endpoint returning data to its user is NOT a trifecta — when
one leg is missing, report the real issue (access control, data exposure) instead.`,
  },
  {
    name: 'phantom-api-gate',
    description: 'Flag calls to endpoints, functions or config keys that nothing in the repo defines.',
    type: 'security',
    body: `# Phantom API gate

When the diff CALLS something, verify the callee is real:

- An HTTP call to an internal route the repo does not define.
- An import or method that exists in no dependency or source file in view.
- A config/env key that is read but never documented or defaulted.

These are often hallucinated or copy-pasted APIs; at runtime they 404/throw.
Report as WARNING (CRITICAL when on the primary path of the feature), and say
explicitly in the rationale when repo context is too limited to be sure.`,
  },
  {
    name: 'test-coverage-nudge',
    description: 'Nudge for a missing test when the diff changes behaviour without touching any test file.',
    type: 'custom',
    body: `# Test coverage nudge

If the diff changes runtime behaviour (new branch, changed condition, new error
path) and touches NO test file, add one SUGGESTION finding naming the single most
valuable missing test: the input, the expected observable outcome, and the file
where it belongs. One nudge per review — pick the highest-risk gap, don't list
every untested line. Skip the nudge for pure refactors, docs, config or generated
files.`,
  },
  {
    name: 'uncovered-branches',
    description: 'For every new conditional in the diff, verify some added test exercises BOTH sides.',
    type: 'rubric',
    body: `# Uncovered branches

For each conditional the diff adds or changes (\`if\`/\`else\`, ternary, \`switch\`,
early return, \`??\`/\`||\` fallback, try/catch):

1. Find an added/changed test that exercises EACH side of it.
2. If a side has no test, report it — cite the production file:line of the branch
   and name the concrete input that would drive execution down the untested side.
3. Boundary conditions count as sides: exactly-at-limit, empty collection, zero,
   null/undefined — the classic corner cases live on the untested side.

A changed branch with no test on its failure/edge side is a WARNING; if that side
can corrupt data or crash the service, CRITICAL.`,
  },
  {
    name: 'overmocking-and-flakes',
    description: 'Flag tests that mock away the behaviour under test or depend on time, order, or randomness.',
    type: 'convention',
    body: `# Over-mocking and flakiness

Over-mocking — flag when:
- The unit under test itself (or its core dependency whose behaviour IS the test's
  subject) is mocked, so the assertion can never fail.
- A test only asserts that mocks were CALLED when an observable result was available.
- Every collaborator is stubbed and the test restates the implementation.

Flakiness — flag when a test:
- Sleeps or uses real timers/wall-clock time instead of fake timers.
- Depends on execution order, shared mutable state, or unseeded randomness.
- Hits the network or filesystem from a unit test.

Cite the test file:line and propose the sturdier form (real collaborator, fake
timers, behavioural assertion).`,
  },
  {
    name: 'api-contract-breaking-changes',
    description: 'Flag caller-visible contract breaks: removed/retyped fields, changed routes, statuses, or newly-required inputs.',
    type: 'convention',
    body: `# API contract breaking changes

Compare every route/schema/shared-type change against what an EXISTING caller sends
and expects:

- Removed or renamed route, field, or enum value → CRITICAL.
- Field type/nullability/casing change in a response → CRITICAL.
- Previously-optional request field now required, or stricter validation rejecting
  previously-valid payloads → CRITICAL.
- Changed status code or error envelope callers branch on → WARNING or CRITICAL.
- Same shape, different semantics (units, timezone, sort order, id kind) → WARNING.

Additive changes (new optional field, new route) are fine — do not flag them.
For each break, name the caller expectation that dies and suggest the compatible
path (additive field, versioned route, deprecation window).`,
  },
  {
    name: 'api-response-schema',
    description: 'Flag response-shape changes: renamed, retyped, newly-nullable or unit-changed fields.',
    type: 'convention',
    body: `# Response schema changes

The response body is a contract. Every caller has already written code that reads
these fields by name and assumes their type. Inspect each changed response schema,
serializer, DTO or shared contract type and report:

- **Renamed or removed field** → CRITICAL. Every caller reading it now gets \`undefined\`.
- **Type change** (\`string\` → \`number\`, scalar → object, object → array) → CRITICAL.
- **Nullability widened** (\`T\` → \`T | null\`) → CRITICAL: callers do not null-check
  a field that was never null. Nullability NARROWED (\`T | null\` → \`T\`) is safe.
- **Required → optional** → CRITICAL for the same reason.
- **Casing or unit change** (\`created_at\` → \`createdAt\`, seconds → ms, cents → dollars)
  → CRITICAL. The shape still validates; the values silently mean something else.
- **Enum value removed or renamed** → CRITICAL; a new value ADDED is a WARNING
  (exhaustive switches on the caller side break).

A NEW OPTIONAL field is additive — never flag it.

If the project vendors its contracts in more than one place, a schema changed on
one side only is CONTRACT DRIFT — report it even when both sides still compile.

## Bad — a silent break

\`\`\`ts
// before:  { user_id: string, created_at: number }   // seconds
// after:
return { userId: row.id, createdAt: row.createdAt.toISOString() };
\`\`\`

Three breaks in one line: \`user_id\` renamed, \`created_at\` renamed, and its type
changed from epoch-seconds to an ISO string. Every caller breaks at runtime while
the code and the types compile cleanly.

## Good — additive, with a migration path

\`\`\`ts
return {
  user_id: row.id,
  created_at: row.createdAtSeconds,      // kept, still seconds
  userId: row.id,                        // new preferred name
  createdAtIso: row.createdAt.toISOString(),
};
\`\`\`

Old callers keep working; new callers get the better shape; the old fields can be
removed after a deprecation window.`,
  },
  {
    name: 'api-semver-discipline',
    description: 'Judge which version bump a contract change forces, and flag a breaking change shipped without one.',
    type: 'convention',
    body: `# Semver discipline

Decide the bump the diff REQUIRES, then check whether the diff actually ships it
(version field, route prefix, package version, changelog entry, migration note).

- **MAJOR** — anything an existing caller cannot survive: removed/renamed route,
  field or enum value; a retyped or newly-nullable response field; a
  previously-optional request field becoming required; stricter validation that
  rejects previously-valid payloads; a changed status code or error envelope.
- **MINOR** — purely additive: a new endpoint, a new OPTIONAL request field, a new
  response field, a new enum value on an output-only enum.
- **PATCH** — no contract surface changes: internal refactor, performance, docs,
  a bug fix that makes the code match its documented behaviour.

Report a finding when a MAJOR-level change ships without a major bump, a new
version route, or a documented migration path — that is the actual defect. Cite
the specific change that forces the bump.

A bug fix that changes documented behaviour is still a break for callers relying
on the old behaviour: call it out as a WARNING with the compatibility note.

## Bad

\`\`\`ts
// package.json: "version": "2.4.1"  →  "2.4.2"
- app.get('/v1/orders/:id', ...)
+ app.get('/v1/orders/:orderId', ...)   // param renamed, path unchanged
\`\`\`

A patch bump on a route-signature change. Nothing warns the caller.

## Good

\`\`\`ts
// package.json: "version": "2.4.1"  →  "3.0.0"  + CHANGELOG "BREAKING:" entry
app.get('/v2/orders/:orderId', handler);
app.get('/v1/orders/:id', deprecatedHandler);   // kept for the deprecation window
\`\`\``,
  },
];

/**
 * Agent name → its seeded skills, in prompt order.
 *
 * The API Contract Reviewer's set is deliberately INCOMPLETE: its fourth skill,
 * `api-deprecation-policy`, ships as `docs/skills-examples/api-deprecation-policy.md`
 * and is added through Skills → Add Skill → Import from file, so the import path
 * (preview → disabled → vet → enable → link) gets exercised on a skill that
 * actually matters to an agent rather than on a throwaway.
 */
export const SEED_AGENT_SKILLS: Record<string, string[]> = {
  'General Reviewer': ['pr-quality-rubric', 'no-then-chains'],
  'Security Reviewer': ['pr-quality-rubric', 'secret-leakage-gate', 'lethal-trifecta'],
  'Performance Reviewer': ['pr-quality-rubric', 'no-then-chains'],
  'Test Quality Reviewer': ['uncovered-branches', 'overmocking-and-flakes', 'test-coverage-nudge'],
  'API Contract Reviewer': [
    'api-contract-breaking-changes',
    'api-response-schema',
    'api-semver-discipline',
    'phantom-api-gate',
  ],
};
