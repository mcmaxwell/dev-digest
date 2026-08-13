#!/usr/bin/env bash
# PreToolUse hook (Write|Edit matcher): confines the `specreator` agent to
# creating new spec files under docs/specs/.
#
# Silent for every other caller - your own edits and the other agents are
# untouched. For specreator it enforces three things the agent prompt also
# states, so a drifting model cannot quietly ignore them:
#   1. the only writable path is docs/specs/L<NN>-<slug>.md
#   2. that file must not already exist  (create-only, never overwrite)
#   3. Edit is refused outright
#
# Reads the hook payload from stdin. Exit 0 = allow, exit 2 = block (stderr is
# shown to the agent). Deliberately dependency-free: no jq, no node. Fields are
# pulled out with grep. A file_path spelled inside the written content cannot be
# mistaken for the real one, because JSON escapes its quotes and the pattern
# needs bare ones; and every candidate must pass anyway, so the ambiguous case
# fails closed rather than open.
set -uo pipefail

input=$(cat)

json_str() { # $1 = key -> every value for that key, one per line
  grep -Eo "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" <<<"$input" |
    sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*\"(.*)\"$/\1/"
}

[[ "$(json_str agent_type | head -1)" == "specreator" ]] || exit 0

fail() {
  echo "specs-gate: $1" >&2
  exit 2
}

tool=$(json_str tool_name | head -1)
[[ "$tool" == "Write" ]] ||
  fail "specreator may only use Write, not '$tool' - a spec is created once and never edited in place. To replace an earlier decision, write a new spec with 'Supersedes:'."

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cwd=$(json_str cwd | head -1)
[[ -n "$cwd" ]] || cwd="$root"

paths=$(json_str file_path)
[[ -n "$paths" ]] || fail "no file_path in the Write call"

while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  [[ "$path" == /* ]] || path="$cwd/$path"

  rel=${path#"$root"/}
  [[ "$rel" != "$path" ]] ||
    fail "'$path' is outside this repository - specreator writes only docs/specs/"

  [[ "$rel" =~ ^docs/specs/L[0-9]{2}-[a-z0-9-]+\.md$ ]] ||
    fail "'$rel' is not a spec path - specreator writes only docs/specs/L<NN>-<slug>.md (two-digit number, lowercase slug). Plans, package specs, code and config belong to other agents."

  [[ ! -e "$path" ]] ||
    fail "'$rel' already exists - specs are create-only. Report this to the caller instead of overwriting it; a decision that replaces an earlier one gets a new file with 'Supersedes:'."
done <<<"$paths"

exit 0
