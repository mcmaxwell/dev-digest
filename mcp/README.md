# devdigest-mcp

A local MCP server that gives an editor agent (Claude Code and anything else
that speaks MCP) the same reviewer agents, findings and conventions the
DevDigest web studio shows, without leaving the editor.

It is a thin client: it talks HTTP to the DevDigest API on
`http://localhost:3001` and holds no database connection, no GitHub client and
**no secrets**.

## Requirements

The DevDigest stack has to be running, because every tool is a read or a write
against its API:

```sh
./scripts/dev.sh          # Postgres + API :3001 + web :3000
```

`dev.sh` does NOT install or start this package. The app and the MCP server have
separate lifecycles on purpose: `dev.sh` owns the app, `scripts/mcp.sh` owns the
tool. Nothing here runs until you ask for it.

## Registration

The repo ships **no** `.mcp.json`, so no session spawns this server by accident.
Turn it on when you want it:

```sh
./scripts/mcp.sh setup     # install deps, verify the stdio handshake
./scripts/mcp.sh enable    # register with Claude Code (this project, you only)
./scripts/mcp.sh status    # registered? is the API it needs up?
./scripts/mcp.sh disable   # unregister; the code stays on disk
```

`enable` registers at **local** scope, which means this project and this machine
only, nothing committed. It is the equivalent of:

```sh
claude mcp add --scope local --env DEVDIGEST_API_URL=http://localhost:3001 \
  --transport stdio devdigest -- ./mcp/bin/devdigest-mcp
```

The registration takes effect in the **next** session, not the running one.

A stdio server has no port, so there is no separate process to start: the host
spawns it on demand and speaks JSON-RPC over its stdin and stdout. `enable` IS
the start, `disable` IS the stop. Running `./mcp/bin/devdigest-mcp` in a terminal
by hand just gives you a process waiting for JSON-RPC on stdin.

The server key `devdigest` decides the tool names the host exposes:
`mcp__devdigest__list_agents` and so on. That is why the tools here are NOT
prefixed - `devdigest_list_agents` would become
`mcp__devdigest__devdigest_list_agents`. Renaming the key renames every tool.

## The five tools

| Tool | Costs money | What it does |
|---|---|---|
| `list_agents` | no | The reviewer agents in this workspace, with slug and uuid. Call it before `run_agent_on_pr`. |
| `run_agent_on_pr` | **yes** | Runs ONE agent on an already-imported PR, waits, returns the verdict and findings. |
| `get_findings` | no | Reads a review that already ran, by `run_id` or by `repo` + `pr_number`. |
| `get_conventions` | no | The repository's accepted house rules, each with a measured adherence rate. |
| `get_blast_radius` | no | **Not implemented** - the L04 exercise. Calling it returns instructions for building it. |

`run_agent_on_pr` waits for up to `wait_seconds` (180 by default, 300 max). When
it runs out of patience it does **not** fail: it returns `status: running` plus
a `run_id`, and the run keeps going on the server. Read the result later with
`get_findings`.

`get_findings` by `run_id` only works for runs THIS server started - the API has
no route mapping a run back to its pull request. Use `repo` + `pr_number` for
anything else.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the DevDigest API |
| `DEVDIGEST_MCP_TIMEOUT_MS` | `15000` | Per-request timeout |
| `DEVDIGEST_MCP_WAIT_SECONDS` | `180` | Default for `run_agent_on_pr`'s `wait_seconds` |

That is the complete list. **No API key is read by this process** - reviews are
started through the DevDigest API, which owns the provider keys in
`~/.devdigest/secrets.json`. An invalid `DEVDIGEST_API_URL` stops the server at
startup with a message on stderr.

## The token budget

Tool definitions are loaded into the system prompt at the start of every chat,
before you type anything. This server's entire `tools/list` payload is held
under **2500 tokens** and measured mechanically:

```sh
cd mcp && pnpm budget
```

```
tool              tokens   bytes
--------------------------------
get_blast_radius     524    2310
run_agent_on_pr      323    1408
get_findings         296    1291
get_conventions      263    1230
list_agents          163     731
--------------------------------
TOTAL               1571
```

The same counter runs in `test/tools-list.test.ts`, together with a structural
gate: no `anyOf`/`oneOf`/`allOf`/`$ref`, at most 8 parameters per tool, every
parameter described, tool descriptions at most 350 characters and parameter
descriptions at most 160, exactly one non-read-only tool, at most one
`outputSchema`. A sixth tool in a later lesson cannot quietly break any of that.

## Development

```sh
cd mcp
pnpm typecheck
pnpm arch:check          # boundaries: standalone, no DB/framework, tools use the API port
pnpm test                # hermetic - no network, no Docker, no keys
pnpm test:it             # opt-in; spawns the real process, wants the stack up
pnpm inspect             # MCP Inspector
```

Manual check that is deliberately not automated (it spends real money):
`run_agent_on_pr` against the seeded `acme/payments-api` PR #482, once to
completion and once with `wait_seconds: 10` to see the `status: running` path.

Conventions, the v1-vs-v2 SDK delta and the reasoning behind the schema rules
live in `AGENTS.md`.
