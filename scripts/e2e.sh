#!/usr/bin/env bash
#
# DevDigest hermetic e2e — run the browser flows against a fully isolated,
# freshly-seeded stack on ALTERNATE ports, so it never touches your dev DB and
# can run alongside a dev stack that's already up.
#
#   ./scripts/e2e.sh
#   E2E_PG_PORT=5440 E2E_API_PORT=3201 E2E_WEB_PORT=3200 ./scripts/e2e.sh
#
# Mirrors what .github/workflows/e2e-web.yml does, but with an ephemeral
# Postgres (no persistent volume → empty every run, so the seeded demo repo
# acme/payments-api is the ONLY repo and the home redirect lands on it).
#
# Exits with the e2e run's status. On success, failure, or Ctrl-C it tears down
# the API/web child processes AND removes the isolated Postgres container.
#
# NOTE: this is a LOCAL convenience. CI brings up its own stack and calls the
# pure runner (`cd e2e && npm test`) directly — this script is not used in CI.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- config (all overridable; defaults dodge the dev stack on 5432/3000/3001) ---
PG_CONTAINER="${E2E_PG_CONTAINER:-devdigest-e2e-postgres}"
PG_PORT="${E2E_PG_PORT:-5433}"
PG_IMAGE="${E2E_PG_IMAGE:-pgvector/pgvector:pg16}"
PG_DB="${E2E_PG_DB:-devdigest}"
PG_USER="${E2E_PG_USER:-devdigest}"
PG_PASS="${E2E_PG_PASS:-devdigest}"
API_PORT="${E2E_API_PORT:-3101}"
WEB_PORT="${E2E_WEB_PORT:-3100}"

# Exported BEFORE any tsx/next spawn. dotenv (used by migrate/seed/config) does
# not override already-set env, so these win over server/.env's :5432 / :3001
# without touching the file. WEB_PORT must be exported too: the API derives its
# CORS allow-origin (config.webOrigin) from it. 127.0.0.1 (not localhost) avoids
# an IPv6 ::1 vs published-IPv4 mismatch against the container.
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"
export API_PORT WEB_PORT
export NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}"
export E2E_BASE_URL="http://localhost:${WEB_PORT}"
# Next inlines NEXT_PUBLIC_* at COMPILE time and keys its build cache by
# directory alone — sharing client/.next with a running dev server would leave
# this run's `:3101` API base baked into the chunks that server keeps serving on
# :3000. Own dist dir = the client build cache is hermetic too, not just PG/API.
export NEXT_DIST_DIR="${E2E_NEXT_DIST_DIR:-.next-e2e}"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }
command -v agent-browser >/dev/null || \
  warn "agent-browser not found — install once: npm i -g agent-browser && agent-browser install"

# --- teardown trap (installed before we start anything) ----------------------
SERVER_PID=""
WEB_PID=""
# Recursively kill a process and all its descendants. `pnpm exec tsx` / `next dev`
# spawn the real listener as a GRANDCHILD, so a plain `kill $PID` + `pkill -P`
# leaves it orphaned (port stays bound). Walk the tree leaves-first instead.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}
restore_snapshot() {
  local backup="$1" target="$2"
  [ -n "$backup" ] && [ -f "$backup" ] || return 0
  cp "$backup" "$target" 2>/dev/null || true
  rm -f "$backup"
}
cleanup() {
  local code=$?
  log "tearing down hermetic e2e stack"
  kill_tree "$WEB_PID"
  kill_tree "$SERVER_PID"
  # `next dev` REWRITES tracked files to match the distDir it ran with:
  # next-env.d.ts gets a new /// <reference>, and tsconfig.json gains a
  # `.next-e2e/types` include (plus a full reformat). Left alone, an e2e run
  # dirties the working tree and points typecheck at a dir that only exists
  # after e2e has run. Put the committed versions back.
  restore_snapshot "$NEXT_ENV_BACKUP" "$ROOT/client/next-env.d.ts"
  restore_snapshot "$TSCONFIG_BACKUP" "$ROOT/client/tsconfig.json"
  # Backstop: reap whatever still holds the ISOLATED ports (never the dev stack's
  # 3000/3001 — only the alt ports this script started).
  for port in "$WEB_PORT" "$API_PORT"; do
    local pids
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT INT TERM

# --- fresh isolated Postgres (ephemeral: --rm, no named volume) --------------
log "starting isolated Postgres '$PG_CONTAINER' on :$PG_PORT (ephemeral)"
docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$PG_CONTAINER" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p "${PG_PORT}:5432" \
  --health-cmd="pg_isready -U $PG_USER -d $PG_DB" \
  --health-interval=5s --health-timeout=5s --health-retries=10 \
  "$PG_IMAGE" >/dev/null

log "waiting for Postgres to be healthy"
status="starting"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "$status" = "healthy" ] || { echo "isolated Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed the ISOLATED db ------------------------------------------
# Hard guard: never let migrate/seed run against anything but the isolated port.
case "$DATABASE_URL" in
  *":${PG_PORT}/"*) : ;;
  *) echo "refusing: DATABASE_URL is not on :$PG_PORT ($DATABASE_URL)"; exit 1 ;;
esac
log "applying migrations (isolated db)"
(cd server && pnpm db:migrate)
log "seeding demo data (isolated db)"
(cd server && pnpm db:seed)

# --- API on :$API_PORT -------------------------------------------------------
# tsx directly (not `pnpm start`, which needs a build; not `tsx watch`, to avoid
# a mid-suite watcher restart).
log "starting API on :$API_PORT"
(cd server && pnpm exec tsx src/server.ts) &
SERVER_PID=$!
log "waiting for API /health"
api_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1 && { api_up=1; break; }
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "API process exited before becoming healthy"; exit 1; }
  sleep 1
done
[ "$api_up" -eq 1 ] || { echo "API never became healthy on :$API_PORT"; exit 1; }
log "API healthy"

# --- web on :$WEB_PORT (next dev → reads NEXT_PUBLIC_API_BASE from env) -------
# Snapshot the tracked files `next dev` rewrites for its distDir; cleanup()
# restores them so an e2e run leaves the working tree exactly as it found it.
NEXT_ENV_BACKUP="$(mktemp -t devdigest-next-env)"
TSCONFIG_BACKUP="$(mktemp -t devdigest-tsconfig)"
cp "$ROOT/client/next-env.d.ts" "$NEXT_ENV_BACKUP"
cp "$ROOT/client/tsconfig.json" "$TSCONFIG_BACKUP"
log "starting web on :$WEB_PORT"
(cd client && pnpm exec next dev -p "$WEB_PORT") &
WEB_PID=$!
log "waiting for web :$WEB_PORT"
web_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${WEB_PORT}" >/dev/null 2>&1 && { web_up=1; break; }
  kill -0 "$WEB_PID" 2>/dev/null || { echo "web process exited before becoming reachable"; exit 1; }
  sleep 1
done
[ "$web_up" -eq 1 ] || { echo "web never became reachable on :$WEB_PORT"; exit 1; }
log "web up"

# --- warm every route the flows visit ----------------------------------------
# `next dev` compiles a route on its FIRST request, and the loop above only
# proves `/` compiled. Every other route paid its compile inside the first flow
# that opened it, racing `agent-browser`'s own timeout — so on a loaded machine
# a different flow failed each run with `Command failed: agent-browser open …`
# or `wait --url …`, which reads like flakiness and is not. Warming here moves
# that cost off the assertion path and makes the suite deterministic under load.
#
# Dynamic segments compile per PATTERN, not per value, so a placeholder id
# compiles `/repos/[repoId]/…` for every repo. The page may render a not-found
# state for it; that is fine, we are buying the compile, not the content.
log "warming routes (next dev compiles on first request)"
WARM_ID="00000000-0000-0000-0000-000000000000"
for path in \
  "/" \
  "/agents" \
  "/skills" \
  "/conventions" \
  "/repos/new" \
  "/settings/api-keys" \
  "/settings/models" \
  "/repos/${WARM_ID}/pulls" \
  "/repos/${WARM_ID}/pulls/1" \
  "/repos/${WARM_ID}/context" \
  "/repos/${WARM_ID}/onboarding" \
; do
  # -m 180: a cold compile of a heavy route can genuinely take minutes on a
  # loaded machine. Failure is not fatal — a route that will not compile fails
  # its own flow with a real message, which is more useful than aborting here.
  curl -fsS -m 180 -o /dev/null "http://localhost:${WEB_PORT}${path}" \
    || log "  warm miss: ${path} (its flow will report the real error)"
done
log "routes warm"

# --- run the flows; propagate the exit code through the trap -----------------
log "running e2e flows against $E2E_BASE_URL"
set +e
(cd e2e && npm test)
E2E_CODE=$?
set -e
exit "$E2E_CODE"
