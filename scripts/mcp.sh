#!/usr/bin/env bash
#
# devdigest-mcp - manage the local MCP server, separately from the app.
#
#   ./scripts/mcp.sh setup     # install deps + verify the server answers
#   ./scripts/mcp.sh enable    # register it with Claude Code (this project, you only)
#   ./scripts/mcp.sh status    # is it registered, and is the API it needs up?
#   ./scripts/mcp.sh disable   # unregister; the code stays on disk
#   ./scripts/mcp.sh inspect   # open the MCP Inspector against it
#   ./scripts/mcp.sh check     # typecheck + boundaries + tests + token budget
#
# Deliberately NOT wired into dev.sh: the app (Postgres + API + web) and the
# MCP server have separate lifecycles. dev.sh owns the app; this owns the tool.
#
# A stdio MCP server has no port and cannot be "started" usefully by hand - the
# host spawns it and speaks JSON-RPC over its stdin/stdout. So `enable` is the
# real "start": it tells Claude Code to spawn it. `disable` is the real "stop".

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL="${DEVDIGEST_API_URL:-http://localhost:3001}"
SERVER_NAME="devdigest"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }

need_deps() {
  command -v pnpm >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }
  if [ ! -d mcp/node_modules ]; then
    log "installing deps in mcp/"
    (cd mcp && pnpm install)
  fi
}

# One initialize round-trip over stdio. Proves the binary runs, the SDK loads,
# and - critically - that nothing wrote to stdout ahead of the JSON-RPC reply.
smoke() {
  local req out
  req='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"mcp.sh","version":"1"}}}'
  out="$(printf '%s\n' "$req" | ./mcp/bin/devdigest-mcp 2>/dev/null | head -1)"
  case "$out" in
    *'"serverInfo"'*) ok "stdio handshake OK" ;;
    "") echo "no reply on stdout - run './scripts/mcp.sh setup' and read the error"; exit 1 ;;
    *) echo "unexpected first line on stdout (a stray console.log breaks the protocol):"; echo "$out"; exit 1 ;;
  esac
}

api_up() { curl -fsS --max-time 2 "$API_URL/health" >/dev/null 2>&1; }

cmd_setup() {
  need_deps
  smoke
  ok "mcp/ is ready. Register it with: ./scripts/mcp.sh enable"
}

cmd_enable() {
  command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
  need_deps
  # --scope local: only this project, only this machine, not committed. That is
  # what keeps the server opt-in instead of appearing for everyone who clones.
  claude mcp add --scope local --env "DEVDIGEST_API_URL=$API_URL" \
    --transport stdio "$SERVER_NAME" -- ./mcp/bin/devdigest-mcp
  ok "registered. Open a NEW Claude Code session, then run /mcp to see the tools."
  api_up || warn "the API at $API_URL is not up - start it with ./scripts/dev.sh"
}

cmd_disable() {
  command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
  claude mcp remove --scope local "$SERVER_NAME"
  ok "unregistered. The code stays in mcp/; re-add it any time with 'enable'."
}

cmd_status() {
  if command -v claude >/dev/null; then
    claude mcp list 2>/dev/null | grep -i "$SERVER_NAME" || echo "$SERVER_NAME: not registered"
  else
    echo "claude CLI not found"
  fi
  if api_up; then ok "API reachable at $API_URL"
  else warn "API NOT reachable at $API_URL - every tool will return a start-the-stack error"
  fi
}

cmd_inspect() { need_deps; (cd mcp && pnpm inspect); }

cmd_check() {
  need_deps
  (cd mcp && pnpm typecheck && pnpm arch:check && pnpm test && pnpm budget)
}

case "${1:-}" in
  setup)   cmd_setup ;;
  enable)  cmd_enable ;;
  disable) cmd_disable ;;
  status)  cmd_status ;;
  inspect) cmd_inspect ;;
  check)   cmd_check ;;
  -h|--help|"") sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) echo "unknown command: $1" >&2; exit 2 ;;
esac
