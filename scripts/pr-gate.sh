#!/usr/bin/env bash
# PreToolUse hook (Bash matcher): blocks `gh pr create` / `gh pr merge` unless
# the CURRENT change-set passed /pr-self-review.
#
# Reads the hook payload from stdin. Exit 0 = allow, exit 2 = block (stderr is
# shown to the agent). Deliberately dependency-free: matches the command as a
# raw substring of the JSON payload instead of parsing it.
set -uo pipefail

input=$(cat)

# Match the COMMAND, not the whole payload. Substring-matching the raw JSON
# blocked any command that merely MENTIONED the phrase - an echo explaining the
# gate, a grep over this file, a commit message - which is a false positive on
# exactly the tooling somebody needs while working on the gate itself.
# Pull the command out and require the phrase in a command position: at the
# start, or right after && || ; or a newline.
verb=$(printf '%s' "$input" |
  sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)
[[ -n "$verb" ]] || verb="$input"

blocked=0
while IFS= read -r seg; do
  case "${seg#"${seg%%[![:space:]]*}"}" in
    gh\ pr\ create* | gh\ pr\ merge* ) blocked=1 ;;
  esac
done < <(printf '%s\n' "$verb" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')
[[ $blocked -eq 1 ]] || exit 0

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
