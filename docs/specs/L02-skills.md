# L02 — Skills

## Goal

Make review knowledge reusable: a **skill** is a named markdown instruction
block that can be attached to any number of agents. Enabled, linked skills are
appended to the agent's prompt (the existing `## Skills / rules` slot) in the
order the agent defines, and the run trace shows exactly what was injected and
how many tokens it added.

## Scope

1. **Server `skills` module** — CRUD over the existing `skills` table (the DB
   is the source of truth). Editing a skill's body bumps its `version` and
   snapshots the old-new body into `skill_versions` (immutable history).
2. **`/skills` page** — card grid (name, type badge, description, enabled
   toggle); clicking a card opens a side preview drawer with view/edit; an
   "Add Skill" button with **Create** / **Import from file**.
3. **Skill editor** — form: name, description, type, markdown body. The
   description is the skill's *interface* — phrased as a directive; the UI
   says so in the field hint.
4. **Agent editor → Skills tab** — one row per workspace skill; checkbox =
   attached to this agent; drag to reorder attached skills. Order = order of
   blocks in the assembled prompt. Changing links/order bumps the agent's
   config version (snapshot includes the ordered skill ids).
5. **Import** — upload a single `.md` file or a `.zip` archive. The server
   extracts only the markdown core (`SKILL.md` preferred), parses optional
   YAML frontmatter (`name`, `description`, `type`) or derives the name from
   the first heading, and returns a **preview**. Nothing is persisted until
   the user confirms; executable/other archive entries are never processed and
   are listed in the preview as skipped.
6. **Prompt wiring** — the review run loads the agent's linked skills, drops
   globally-disabled ones, and passes bodies (in link order) to
   `reviewPullRequest`. The trace's prompt assembly gets a `skills_tokens`
   count; the Live Log notes how many skills were attached.
7. **Two new seeded agents** — *Test Quality Reviewer* and *API Contract
   Reviewer*, each with linked seeded skills. `docs/skills-examples/` ships an
   importable skill file so the import path can be demoed end to end.

Out of scope: import from URL, community catalog, conventions extractor (the
other half of L02), skill-level evals, plugin export/import (L08), Stats/CI
agent tabs (L06/L07).

## Data flow

`agent_skills` (agent_id, skill_id, order) already exists, as do `skills` /
`skill_versions` and the `Skill` / `AgentSkillLink` contracts. The run
executor resolves `agentsRepo.linkedSkills(agent.id)` → filters
`skill.enabled` → maps to `### Skill: <name>` blocks (bodies from non-`manual`
sources are `wrapUntrusted()`-wrapped) → `reviewPullRequest({ skills })` →
reviewer-core joins them into the `## Skills / rules` prompt section and
records the block in `PromptAssembly.skills` → the server counts its tokens
(tokenizer adapter, chars/4 fallback) into `PromptAssembly.skills_tokens` →
`run_traces` → the Trace drawer renders the skills block + `≈N tok` badge.

## Decisions

- **Checkbox = link.** Attached to an agent ⇔ enabled for that agent; there is
  no per-link enabled flag (schema unchanged). The skill's own global `enabled`
  toggle removes it from every agent's prompt at once without unlinking.
- **Import is upload-based** (`.md` / `.zip`, multipart) with a mandatory
  preview step; source is recorded as `imported_file` (new `SkillSource`
  value — TS-level enum only, no DB migration needed) and the skill starts
  **disabled** until vetted.
- **Trust boundary**: bodies of skills whose source ≠ `manual` are wrapped as
  `<untrusted source="skill:<name>">` in the prompt — a foreign skill is
  someone else's instructions inside your agent's prompt. Manual skills are
  trusted like the system prompt.
- **Skill-link changes version the agent.** `setSkills`/`linkSkill` bump
  `agents.version` and snapshot `agent_versions` when the ordered id list
  actually changes (reproducibility: a run's version pins its skill set).
- **Token count is an estimate** — computed server-side at trace-build time
  with the existing tiktoken adapter (chars/4 on failure), stored as
  `skills_tokens`, rendered as `≈N tok`. No per-block accounting for other
  slots (later lesson).
- **Body edit = new immutable version** (`skill_versions`), matching the
  existing agent-versions pattern.
- The sidebar gains a SKILLS LAB → Skills entry. This touches vendored
  `client/src/vendor/ui/nav.ts` (data-only addition) — the single sanctioned
  exception to the vendored-UI freeze, since the nav registry is not
  extensible from app code.

## Acceptance criteria

- A skill can be created, edited (body change → version+1 + snapshot),
  toggled, and deleted in the UI; the grid + preview drawer match the design.
- Agent editor Skills tab: attach/detach via checkbox, drag-reorder persists,
  "X of Y enabled" count, filter box; order is reflected in the prompt.
- A review run with linked enabled skills shows the block in the trace's
  prompt assembly (with `≈N tok`) and in the Live Log; a disabled or unlinked
  skill never appears.
- Import: uploading a `.md` or `.zip` shows a preview (name/description/body +
  skipped entries); nothing is saved before confirmation; executables in the
  archive are never read as skills; the imported skill lands disabled with
  source `imported_file`.
- Both new agents exist after `pnpm db:seed` with linked skills; the control
  experiment (happy-path-test PR / route-signature PR) is reproducible by
  toggling the agents' skills off/on.
- Contract changes (`SkillSource`, `Agent.skill_count`,
  `PromptAssembly.skills_tokens`, `SkillImportPreview`) land in BOTH vendored
  copies of `@devdigest/shared`.
