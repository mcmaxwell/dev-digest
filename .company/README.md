# Company Workspace: dev-digest

This directory is the shared, project-specific memory and task record for
company-agents. It belongs in this product repository so every authorized developer
and agent works from the same context. Reusable controller tooling remains in
https://github.com/mcmaxwell/company-agents.

Root agent instructions must direct agents here before they inspect product code.

## Developer setup

Clone the controller once on the workstation, then register this checkout:

```bash
git clone https://github.com/mcmaxwell/company-agents.git
cd company-agents
npm ci
scripts/company-map register dev-digest /absolute/path/to/this-project
scripts/company-map build dev-digest
scripts/company-map validate dev-digest
claude --agent boss
```

The clone of this repository already has everything except the generated
index (`index/` below, git-ignored): the `build` step above rebuilds it in
seconds.

On later days, pull both repositories, run
`scripts/company-map status dev-digest`, use `update` if stale, then launch the
Boss and name project `dev-digest` in the request.

## Start every task

1. Read `memory/project-profile.md`, `memory/features.md`, and
   `memory/modules.md`, then `memory/conventions.md`.
2. Search `memory/decisions/` for relevant accepted decisions.
3. Refresh the company-map index (`scripts/company-map update dev-digest`
   from the controller) and request a bounded context slice.
4. Create the work item under `tasks/active/`; archive it only after QA approval.

## Finish every task

- Update only concise, verified, durable facts in `memory/`.
- Put project-specific decisions in `memory/decisions/`.
- Append the project-local usage record to `costs/ledger.jsonl`.
- Never store secrets, credentials, raw auth output, or machine-absolute paths here.
- Commit accepted memory and task-history updates with the related product work.

## Module memory

Use `memory/modules.md` for stable module boundaries and setup commands. Generated
symbol and edge data lives at `index/` inside this workspace; it is git-ignored and
rebuilt on demand via `scripts/company-map build`/`update`, not duplicated here.
