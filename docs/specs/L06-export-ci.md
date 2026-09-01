# Spec: Export to CI - an agent as a bundle of files

Spec ID: L06
Status: draft
Supersedes: none

## Problem and user

The user owns a reviewer agent in DevDigest that they have spent real effort tuning.
They have edited its system prompt, attached two or three skills, and watched its accept rate climb on the pull requests they imported.

That agent stops at the edge of their laptop.
DevDigest is local-first: a review happens because this one person imported a pull request and pressed Review.
Every pull request they did not personally open goes unreviewed by the agent, and every teammate gets none of it.

Today the only way out of the studio is by hand.
The user opens the Config tab, selects the system prompt, copies it, opens the Skills tab, copies each skill body, and pastes the lot into some script or wiki page.
That copy is stale the moment the prompt changes, nobody can tell which version of the agent produced which review, and the agent as a whole is not a thing anyone can read, diff, or review in a pull request.

The cost is that a tuned agent is private knowledge.
It cannot be handed to a teammate, it cannot be committed next to the code it reviews, and it cannot be the input to anything that runs on a schedule.

## Goals and non-goals

### Goals

- Turn an agent into a portable bundle of plain files in one action, without leaving the agent editor.
- Make that bundle self-describing: one manifest that states the model, the strategy, the gate policy, and which skills belong to the agent, in a schema that is shared with whatever later reads it.
- Show the user every generated file, in full, before they take it anywhere.
- Get the files onto the user's disk or clipboard with no GitHub credentials and no write access to anything.
- Generate the bundle deterministically, with no model call, so the same agent and the same options produce byte-identical files every time.

### Non-goals

This is a deliberately small first cut.
The team will widen it once there is evidence about what users actually do with the bundle, and each fence below exists so that evidence can be collected cheaply.

- **No CI runner.**
  Nothing in this spec makes a review actually execute inside a pipeline.
  The bundle is configuration, and the generated workflow is a scaffold with a marked placeholder step.
  See the first open question, which is the one that decides whether this feature is finished.
- **No PR opening.**
  The `open_pr` action already described in `CiExportInput` stays unimplemented, and DevDigest never writes to a GitHub repository as part of this feature.
- **No installation state.**
  `ci_installations` gets no rows, and the CI tab never claims an agent is "active in N repos".
- **No CI Runs page and no ingest endpoint.**
  `ci_runs` gets no rows, and `CiResultArtifact` is not consumed by anything.
- **No target other than GitHub Actions.**
  CircleCI, Jenkins and the generic CLI stay in the `CiTarget` enum and stay visibly unavailable in the wizard.
- **No memory export.**
  The `.devdigest/memory.jsonl` file shown in the mockup is out of scope, because persistent memory is a later lesson and there is nothing to export.
- **No editing generated files inside the wizard.**
  The files are copied out and edited wherever they land.
- **No zip archive.**
  Copy and download work one file at a time.

## User stories

- As an agent owner, I want to see exactly what DevDigest would write into my repository, before anything is written anywhere.
- As an agent owner, I want my tuned agent as files I can commit next to the code it reviews, so a teammate can read it and a diff can show what changed.
- As an agent owner, I want to choose which pull-request events the review is meant to run on, and how its results are meant to be posted, and see those choices land in the generated workflow.
- As an agent owner, I want the export to work on an agent that has no skills attached yet, because that is what a new agent looks like.

## Module interactions

### Participants

| Module | Role in this feature |
| --- | --- |
| `server/src/modules/ci` (new) | Owns the generation. `bundle.ts` is a pure function; `service.ts` loads the agent and its skills; `routes.ts` exposes one endpoint. No repository, because nothing is persisted. |
| `server/src/modules/agents` | Read only. Supplies the agent row and its ordered skills through its existing repository. |
| `server/src/vendor/shared` and `client/src/vendor/shared` | Gain `CiBundleInput` and `CiBundle`, added to `contracts/eval-ci.ts` in **both** copies. |
| `client` agent editor | Gains a `ci` tab and the export wizard. No new route, no new page. |

### Flow

```mermaid
sequenceDiagram
    actor U as Agent owner
    participant W as Export wizard (client)
    participant R as POST /agents/:id/ci-bundle
    participant S as CiService
    participant A as Agents repository
    participant B as buildBundle (pure)

    U->>W: Open CI tab, press Export to CI
    U->>W: Pick target, triggers, post-as
    W->>R: CiBundleInput
    R->>S: agentId + options
    S->>A: agent row + ordered enabled skills
    A-->>S: agent, skills[]
    S->>B: agent, skills, options
    B-->>S: CiFile[]
    S-->>R: CiBundle
    R-->>W: files
    W->>U: Preview every file; copy or download each
```

### What crosses the boundary

The request carries only the target, the trigger list and the post-as choice.
It carries no repository name, no branch and no credentials, because in this cut nothing is written to any repository and none of those values would be used.

The response carries `{ files: CiFile[] }` and nothing else.

### Contract

Added to `contracts/eval-ci.ts`, additively, in both vendor copies:

```ts
/** Request body for `POST /agents/:id/ci-bundle` - a pure derivation, no side effects. */
export const CiBundleInput = z.object({
  target: CiTarget.default('gha'),
  triggers: z.array(z.enum(['opened', 'synchronize', 'reopened']))
    .min(1)
    .default(['opened', 'synchronize']),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
});

/** Response of `POST /agents/:id/ci-bundle`. */
export const CiBundle = z.object({ files: z.array(CiFile) });
```

`CiExportInput`, `CiExport` and `CiInstallation` are left exactly as they are.
They describe the export that persists an installation and opens a pull request, which is the next iteration, and this spec deliberately does not reshape them to fit a narrower feature.

### Bundle contents

For target `gha`, the bundle is:

| Path | Contents |
| --- | --- |
| `.devdigest/agents/<agent-slug>.yaml` | The agent as an `AgentManifest`: name, provider, model, system prompt, skill slugs, strategy, `ci_fail_on`. |
| `.devdigest/skills/<skill-slug>.md` | One file per enabled attached skill, carrying that skill's body verbatim. |
| `.github/workflows/devdigest-review.yml` | A workflow triggered on the chosen `pull_request` types, whose review step is a marked placeholder. |

`AgentManifest` is the existing contract and is not modified.
It is the reason the manifest is worth generating even with no runner: the shape the studio writes is the shape a runner will read, and one schema keeps the two ends from drifting.

### When a neighbour is unavailable

There is no neighbour to be unavailable.
Generation touches no model, no network, no clone and no GitHub API, so the only failure modes are "agent not found" and a malformed request body.

## Acceptance criteria (EARS)

### Reaching the wizard

**AC-1.**
The system shall present a `CI` tab in the agent editor, after `Evals`.
Observed at: the agent editor tab strip.

**AC-2.**
WHILE no export has been performed, the system shall show on the CI tab an explanation of what the export produces and a single control that opens the export wizard.
Observed at: the CI tab of any agent.

**AC-3.**
The system shall not display any count of repositories, installation status, or past CI run on the CI tab.
Observed at: the CI tab of any agent.

### Choosing a target

**AC-4.**
WHEN the wizard opens, the system shall preselect GitHub Actions as the target.
Observed at: the wizard, target step.

**AC-5.**
The system shall display CircleCI, Jenkins and the generic CLI as targets in a disabled state that cannot be selected, each labelled as not yet available.
Observed at: the wizard, target step.

**AC-6.**
IF a request names a target other than `gha`, THEN the system shall reject it with a 400 and shall generate no files.
Observed at: `POST /agents/:id/ci-bundle` with `target: "circle"`.

### Configuring

**AC-7.**
WHEN the wizard reaches the configure step, the system shall preselect the triggers `opened` and `synchronize`, and shall leave `reopened` unselected.
Observed at: the wizard, configure step.

**AC-8.**
The system shall prevent the user from advancing past the configure step while no trigger is selected.
Observed at: the wizard, configure step, with every trigger deselected.

**AC-9.**
WHEN the wizard reaches the configure step, the system shall preselect `github_review` as how results are posted.
Observed at: the wizard, configure step.

### Generating

**AC-10.**
WHEN the user requests a bundle, the system shall generate exactly one manifest file, one Markdown file per enabled attached skill, and one workflow file.
Observed at: the response of `POST /agents/:id/ci-bundle`.

**AC-11.**
The system shall write into the manifest the agent's provider, model, system prompt, strategy and `ci_fail_on` as stored on the agent record, and shall not substitute defaults for any of them.
Observed at: the generated `.devdigest/agents/<slug>.yaml`.

**AC-12.**
The system shall list in the manifest's `skills` field the slug of every enabled attached skill, in the order recorded on `agent_skills`, and shall emit one `.devdigest/skills/<slug>.md` for each listed slug.
Observed at: the generated manifest and the generated skill files.

**AC-13.**
The system shall exclude a disabled skill from both the manifest's `skills` field and the generated files.
Observed at: the response for an agent with one enabled and one disabled skill attached.

**AC-14.**
The system shall produce a manifest that parses cleanly against `AgentManifest`.
Observed at: parsing the generated YAML with the `AgentManifest` schema.

**AC-15.**
WHEN the same agent is exported twice with the same options and no intervening edit, the system shall produce byte-identical files.
Observed at: two successive responses of `POST /agents/:id/ci-bundle`.

**AC-16.**
The system shall emit into the workflow's `pull_request.types` exactly the triggers the request carried, in the fixed order `opened`, `synchronize`, `reopened`.
Observed at: the generated `.github/workflows/devdigest-review.yml`.

**AC-17.**
The system shall mark the workflow's review step as a placeholder, in a comment that states the step does not yet run a review and that the manifest is the file a runner will consume.
Observed at: the generated workflow.

**AC-18.**
The system shall generate a bundle for an agent with no skills attached, containing the manifest and the workflow, with the manifest's `skills` field present and empty.
Observed at: the response for a freshly created agent.

**AC-19.**
IF the agent identifier does not resolve to an agent in the caller's workspace, THEN the system shall answer 404 and shall generate no files.
Observed at: `POST /agents/:id/ci-bundle` with an unknown identifier.

### Previewing and taking the files

**AC-20.**
WHEN the bundle has been generated, the system shall list every generated file by path and shall display the full contents of the selected one.
Observed at: the wizard, preview step.

**AC-21.**
WHEN the wizard reaches the preview step, the system shall select the workflow file for display.
Observed at: the wizard, preview step.

**AC-22.**
The system shall offer, for each generated file, a control that copies that file's contents to the clipboard and a control that downloads it under its own base name.
Observed at: the wizard, preview step.

**AC-23.**
The system shall never transmit the generated files to any destination other than the user's own browser.
Observed at: the network activity of the wizard.

## Edge cases

**An agent with no skills.**
Covered by AC-18.
The bundle is two files and the manifest's `skills` is an empty list, which `AgentManifest` already tolerates.

**Two skills whose names slugify identically.**
"Secret Leakage Gate" and "secret-leakage gate" both reduce to `secret-leakage-gate`, and one file would silently overwrite the other.
The system shall disambiguate by appending `-2`, `-3` and so on to the later slug in `agent_skills` order, so that every generated path is unique and the manifest points at the file that actually exists.

**A name that slugifies to nothing.**
An agent or skill named only with emoji or punctuation produces an empty slug.
The system shall fall back to `agent` or `skill` respectively, with the same numeric disambiguation.

**A skill with an empty body.**
The file is generated and is empty.
Nothing is skipped, because a skill that is attached is part of the agent's definition whether or not it currently says anything.

**A disabled agent.**
Export is allowed.
Whether an agent runs in the studio is unrelated to whether the user may read its definition as files.

**A very long system prompt.**
Covered by the size limit under non-functional requirements.

**A concurrent edit.**
The bundle reflects the agent as read at request time.
Nothing is persisted, so there is nothing to go stale and no conflict to resolve.

**A second export.**
Indistinguishable from the first.
Since no installation is recorded, there is no notion of updating an existing one, and the wizard offers no "update" path.

## Non-functional requirements

- Generation performs zero model calls, zero network calls and zero filesystem reads, and costs nothing.
- The endpoint answers in under 100 ms at p95, measured server side, excluding the agent and skill reads.
- A bundle is refused with a 413 if the generated contents exceed 512 KB in total, which at the stated file count means a system prompt or skill body far outside normal use.
- `buildBundle` is a pure function with no DI and no clock, and is covered by hermetic unit tests only, with no `*.it.test.ts` file added by this feature.
- Every string the wizard shows is a `next-intl` message under the `agents` namespace; no literal user-facing English is added to a component.
- The preview pane renders file contents in a monospaced block with horizontal scrolling of its own, so a long line never widens the dialog.

## Inputs and provenance

| Input | Source | Absence means |
| --- | --- | --- |
| agent name, provider, model, system prompt, strategy | `agents` row | Cannot happen; all are `notNull`. |
| `ci_fail_on` | `agents.ciFailOn` | Cannot happen; `notNull` with default `critical`. |
| attached skills and their order | `agent_skills` joined to `skills` | An agent with no attached skills, which is AC-18. |
| skill name, body, enabled | `skills` row | Cannot happen; all are `notNull`. |
| target | wizard, defaulted to `gha` | Defaulted by the schema. |
| triggers | wizard, defaulted to `opened` and `synchronize` | Defaulted by the schema; an explicit empty list is rejected. |
| post-as | wizard, defaulted to `github_review` | Defaulted by the schema. |

No input to this feature comes from GitHub, from a clone, or from a model.

## Untrusted inputs

The system prompt and the skill bodies are the untrusted material here.
Both are free text authored by a user or produced by a model, and both are about to be embedded into files that other tools parse and, eventually, that a pipeline executes near.

- **Into YAML.**
  The system prompt is embedded in `AgentManifest` YAML.
  It shall be emitted as a literal block scalar with an explicit indentation indicator, and any content that cannot be represented that way, such as a string containing a line whose indentation would be ambiguous, shall be emitted as a double-quoted scalar with escaping.
  The generated manifest is re-parsed and validated against `AgentManifest` before the response is returned, so a prompt that would break the file is caught at generation rather than by the person who pasted it.
- **Into Markdown.**
  Skill bodies go into their own `.md` files, verbatim, where there is no enclosing syntax to break out of.
  This is why skills are separate files rather than inline manifest strings.
- **Never into a shell.**
  No generated file interpolates the agent name, a skill name, a prompt or a skill body into a `run:` step, and the export offers no "copy as a shell script" action.
  A bundle is copied file by file precisely so that untrusted text never becomes a command line.
- **Path containment.**
  Every generated path is composed as a fixed prefix plus a slug drawn from `[a-z0-9-]`.
  A name containing `../`, a leading slash, a null byte or a path separator cannot reach the path, because the slug is built by allow-list and not by escaping.
- **Rendering.**
  The preview renders file contents as text, never as HTML or Markdown, so a prompt containing markup is shown and not interpreted.

## Design review

The mockups are four screens covering a wizard, and they leave the following undecided or, in a few places, decided in a way this spec changes.

- **Step order puts Preview before Configure.**
  `accepted` to change.
  As drawn, the user previews files generated from defaults and then edits the triggers, which silently invalidates what they just read.
  The wizard becomes three steps: Target, Configure, then a combined Preview and Install.
- **Three of the four targets are unavailable.**
  `accepted`.
  The mockup already renders CircleCI, Jenkins and the generic CLI dimmed, and this spec makes that state explicit rather than merely visual.
- **The file list includes `.devdigest/memory.jsonl`.**
  `rejected`.
  Persistent memory is a later lesson and there is nothing to write into that file.
- **The workflow file carries an `editable` badge.**
  `rejected` for this cut.
  Editing inside the wizard adds a state machine and buys nothing over editing the file after it lands, and `CiFile.editable` is emitted as `true` without the UI acting on it.
- **The install step's primary action is "Open a PR with these files".**
  `rejected` for this cut.
  It requires write access to the repository, a branch, and a commit, which is the whole of the next iteration.
  The install step offers per-file copy and per-file download instead.
- **"Copy files as a zip".**
  `rejected`.
  There is no zip writer in the Node standard library and the feature does not justify a dependency; five files copied individually is acceptable and the friction is a useful signal about whether anyone wants the archive.
- **The CI tab shows "Active in 2 repos" and a per-repo status list.**
  `rejected` for this cut, since nothing is persisted.
  The tab is an explanation and one button.
- **The CI tab hosts the "Fail CI on" control.**
  `open`.
  The field already exists on the agent record and is already exported in the manifest, but its natural home is arguably the Config tab next to the model and strategy.
  This spec places it nowhere and exports its stored value.
- **No mockup shows an agent with no skills.**
  Specified as AC-18: the bundle is two files, and the preview says so rather than showing an empty list.
- **No mockup shows the wizard being opened a second time.**
  Specified: it behaves identically, because nothing was recorded the first time.
- **No mockup shows a failed generation.**
  Specified: the wizard stays on the configure step and shows the error, since there is nothing partial to preview.

## Open questions

**1. What runs the bundle?**
This is the question that decides whether the feature is worth anything beyond a readable agent definition.
The generated workflow has a placeholder step because there is no runner: `mcp/bin/devdigest` implements only `--mode working`, has no `--pr` or `--mode branch`, and reaches the DevDigest API over HTTP, which a GitHub-hosted runner cannot do against a local-first server.
The rest of this spec is written under the assumption that a portable, committable agent definition is valuable on its own, and that the runner is a separate decision with its own spec.
If that assumption is wrong, this feature should not ship in this shape.

**2. Should the endpoint be `/ci-bundle` or `/export-ci`?**
This spec uses `POST /agents/:id/ci-bundle` and leaves `POST /agents/:id/export-ci`, already named in the contracts, for the iteration that persists an installation and opens a pull request.
The assumption is that two endpoints with two honest response shapes beat one endpoint whose response gains fields later.

**3. Does anyone want the other three targets?**
Assumed no, until asked.
The `CiTarget` enum keeps all four so that adding one is a generator function and a flag, not a contract change.

**4. Is `post_as` meaningful before a runner exists?**
It is carried into the workflow as an environment variable that nothing currently reads.
Assumed worth keeping, because it is one radio group and it records the user's intent in the committed file.
