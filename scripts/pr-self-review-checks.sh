#!/usr/bin/env bash
# Deterministic (no-LLM) layer of the pr-self-review skill.
#
# The change-set is everything that differs from the merge-base with main:
# branch commits + staged + unstaged + untracked files.
#
# Subcommands:
#   files            list changed files (one per line)
#   hash             stable hash of the current change-set (used by the PR gate)
#   run              run fast checks; prints "SEVERITY<TAB>file<TAB>message" lines;
#                    exit 1 if at least one CRITICAL was found
#   marker VERDICT [note]
#                    write .git/pr-self-review.json binding VERDICT
#                    (PASS | BLOCKED | ACKNOWLEDGED) to the current change-set hash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

base_ref() {
  git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD
}

changed_files() {
  local base
  base=$(base_ref)
  {
    git diff --name-only "$base"
    git ls-files --others --exclude-standard
  } | sort -u
}

diff_hash() {
  local base
  base=$(base_ref)
  {
    git diff "$base"
    git ls-files --others --exclude-standard | sort | while IFS= read -r f; do
      printf '%s %s\n' "$f" "$(git hash-object -- "$f" 2>/dev/null || echo missing)"
    done
  } | git hash-object --stdin
}

# The dev shell may default to Node 17 via nvm; the repo needs Node >= 18 for pnpm.
ensure_node() {
  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [[ "$major" -lt 18 ]]; then
    local d
    for d in "$HOME"/.nvm/versions/node/v2*/bin; do
      if [[ -x "$d/node" ]]; then
        export PATH="$d:$PATH"
        break
      fi
    done
  fi
}

CRITICALS=0
emit() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3"
  if [[ "$1" == CRITICAL ]]; then
    CRITICALS=$((CRITICALS + 1))
  fi
}

added_lines() {
  local base=$1 f=$2
  if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    git diff "$base" -- "$f" | { grep -E '^\+' || true; } | { grep -vE '^\+\+\+' || true; }
  elif [[ -f "$f" ]] && grep -Iq . "$f" 2>/dev/null; then
    cat "$f"
  fi
}

scan_secrets() {
  local f=$1 src=$2 p
  local pats=(
    'ghp_[A-Za-z0-9]{36}'
    'github_pat_[A-Za-z0-9_]{20,}'
    'sk-(proj-|ant-)?[A-Za-z0-9_-]{24,}'
    'AKIA[0-9A-Z]{16}'
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  )
  for p in "${pats[@]}"; do
    if grep -qE -e "$p" <<<"$src"; then
      emit CRITICAL "$f" "possible secret matching /$p/ in added lines — secrets belong in ~/.devdigest/secrets.json, never in git"
    fi
  done
}

run_checks() {
  local base files f other src
  base=$(base_ref)
  files=$(changed_files)

  # 1. "Do not touch" paths
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    case "$f" in
      server/clones/*)
        emit CRITICAL "$f" "server/clones/** is a runtime checkout — must never be edited or committed" ;;
      # nav.ts is the APP's sidebar + shortcut registry that happens to sit
      # inside the kit directory. It already carries this app's routes
      # (/repos/:repoId/pulls, /skills, /agents), and every lesson that adds a
      # page has to add its entry here — so flagging it as a vendored-kit edit
      # is a false positive on every such PR. The kit itself stays protected.
      client/src/vendor/ui/nav.ts)
        : ;;
      client/src/vendor/ui/*)
        emit CRITICAL "$f" "client/src/vendor/ui/** is a vendored UI kit — do not modify" ;;
      .env|*/.env|.env.local|*/.env.local)
        emit CRITICAL "$f" ".env files must not be committed — edit .env.example instead" ;;
    esac
  done <<<"$files"

  # 2. Migrations are generated from schema.ts
  if grep -q '^server/src/db/migrations/' <<<"$files" && ! grep -qE '^server/src/db/schema(\.ts$|/)' <<<"$files"; then
    emit CRITICAL "server/src/db/migrations" "migrations changed without a schema change — migrations are generated: change the schema, then 'cd server && pnpm db:generate'"
  fi
  if grep -qE '^server/src/db/schema(\.ts$|/)' <<<"$files" && ! grep -q '^server/src/db/migrations/' <<<"$files"; then
    emit MAJOR "server/src/db/schema" "schema changed but no migration in the change-set — run 'cd server && pnpm db:generate'"
  fi

  # 3. Vendored @devdigest/shared copies must not drift on files touched here
  while IFS= read -r f; do
    case "$f" in
      server/src/vendor/shared/*) other="client/src/vendor/shared/${f#server/src/vendor/shared/}" ;;
      client/src/vendor/shared/*) other="server/src/vendor/shared/${f#client/src/vendor/shared/}" ;;
      *) continue ;;
    esac
    if [[ ! -f "$f" || ! -f "$other" ]]; then
      emit CRITICAL "$f" "counterpart vendored copy '$other' is missing — @devdigest/shared changes must land in BOTH copies"
    elif ! cmp -s "$f" "$other"; then
      if grep -qF "$other" <<<"$files"; then
        emit MAJOR "$f" "both vendored copies changed but still differ from each other ($other) — confirm the divergence is intentional"
      else
        emit CRITICAL "$f" "changed here but counterpart copy '$other' was not updated — @devdigest/shared changes must land in BOTH copies"
      fi
    fi
  done <<<"$files"

  # 4. Secrets in added lines
  while IFS= read -r f; do
    [[ -n "$f" && "$f" != *.lock && "$f" != *pnpm-lock.yaml ]] || continue
    src=$(added_lines "$base" "$f")
    [[ -n "$src" ]] || continue
    scan_secrets "$f" "$src"

    # 5. Hand-parsed request bodies in server code (route validation is schema-first)
    if [[ "$f" == server/src/*.ts ]] && grep -qE 'JSON\.parse\([^)]*\b(req|request)\.(raw)?[Bb]ody' <<<"$src"; then
      emit CRITICAL "$f" "hand-parsed request body — server routes are schema-first (zod via fastify-type-provider-zod)"
    fi
  done <<<"$files"

  # 6. DB-backed server tests must use the *.it.test.ts suffix
  while IFS= read -r f; do
    if [[ "$f" == server/*.test.ts && "$f" != *.it.test.ts && -f "$f" ]]; then
      if grep -qE 'testcontainers|helpers/pg' "$f"; then
        emit CRITICAL "$f" "uses testcontainers/pg helper but is not named *.it.test.ts — DB-backed server tests must use the .it.test.ts suffix"
      fi
    fi
  done <<<"$files"

  # 7. Onion layering (dependency-cruiser) when server sources changed
  if grep -qE '^server/src/' <<<"$files"; then
    ensure_node
    if ! command -v pnpm >/dev/null 2>&1 || [[ ! -d server/node_modules ]]; then
      emit MAJOR "server" "arch:check skipped (pnpm or server/node_modules missing) — run 'cd server && pnpm arch:check' manually"
    else
      local arch_out
      arch_out=$(cd server && pnpm -s arch:check 2>&1) || {
        emit CRITICAL "server" "dependency-cruiser arch:check failed — onion layering violated; see 'cd server && pnpm arch:check'"
        printf '%s\n' "$arch_out" | tail -20 >&2
      }
    fi
  fi

  if [[ "$CRITICALS" -gt 0 ]]; then
    echo "deterministic layer: $CRITICALS critical finding(s)" >&2
    return 1
  fi
  echo "deterministic layer: no critical findings" >&2
}

write_marker() {
  local verdict=$1 note=${2:-} gitdir hash
  case "$verdict" in
    PASS|BLOCKED|ACKNOWLEDGED) ;;
    *) echo "marker verdict must be PASS, BLOCKED or ACKNOWLEDGED" >&2; return 1 ;;
  esac
  gitdir=$(git rev-parse --git-dir)
  hash=$(diff_hash)
  printf '{\n  "verdict": "%s",\n  "diff_hash": "%s",\n  "created_at": "%s",\n  "note": "%s"\n}\n' \
    "$verdict" "$hash" "$(date -u +%FT%TZ)" "$note" >"$gitdir/pr-self-review.json"
  echo "marker: $verdict ($hash)" >&2
}

case "${1:-}" in
  files)  changed_files ;;
  hash)   diff_hash ;;
  run)    run_checks ;;
  marker) shift; write_marker "$@" ;;
  *)      echo "usage: $0 files|hash|run|marker VERDICT [note]" >&2; exit 64 ;;
esac
