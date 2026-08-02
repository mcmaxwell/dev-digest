#!/usr/bin/env bash
# PreToolUse hook (Bash matcher): blocks `gh pr create` / `gh pr merge` unless
# the CURRENT change-set passed /pr-self-review.
#
# Reads the hook payload from stdin. Exit 0 = allow, exit 2 = block (stderr is
# shown to the agent). Deliberately dependency-free: matches the command as a
# raw substring of the JSON payload instead of parsing it.
set -uo pipefail

input=$(cat)
case "$input" in
  *"gh pr create"* | *"gh pr merge"*) ;;
  *) exit 0 ;;
esac

fail() {
  echo "pr-self-review gate: $1" >&2
  exit 2
}

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
gitdir=$(git -C "$root" rev-parse --git-dir)
marker="$gitdir/pr-self-review.json"

[[ -f "$marker" ]] || fail "no review marker found — run /pr-self-review before opening or merging a PR"

verdict=$(grep -Eo '"verdict" *: *"[A-Z]+"' "$marker" | grep -Eo '[A-Z]+' | tail -1 || true)
stored_hash=$(grep -Eo '"diff_hash" *: *"[a-f0-9]+"' "$marker" | grep -Eo '[a-f0-9]{40}' | tail -1 || true)
current_hash=$("$root/scripts/pr-self-review-checks.sh" hash 2>/dev/null || true)

[[ -n "$stored_hash" && "$stored_hash" == "$current_hash" ]] ||
  fail "the change-set has changed since the last review — re-run /pr-self-review"

case "$verdict" in
  PASS | ACKNOWLEDGED) exit 0 ;;
  *) fail "last review verdict is '${verdict:-unknown}' — fix the critical findings (or use '/pr-self-review acknowledge <reason>')" ;;
esac
