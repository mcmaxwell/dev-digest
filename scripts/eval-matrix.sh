#!/usr/bin/env bash
# Deterministic eval gate. Two modes:
#
#   eval-matrix.sh matrix <base-ref>   prints a JSON array for the job matrix on
#                                      stdout; every SKIP reason goes to stderr
#   eval-matrix.sh check  <target>     runs the checks for one target
#
# Targets: skill:<name> | instructions | agents | commands
#
# Nothing here calls a model. These are the failures that do not need one: an
# evals.json that stopped parsing, a fixture path that moved, a "Read when..."
# pointer aimed at a deleted file, a command naming a skill that no longer
# exists. LLM runs are a separate, on-demand workflow - they cost money and they
# flake, and neither belongs in a PR gate.
set -uo pipefail

root=$(git rev-parse --show-toplevel) || exit 1
cd "$root"

# ---------------------------------------------------------------- matrix mode
changed() { git diff --name-only "$1"...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null; }

emit_matrix() {
  local base="${1:-origin/main}" files targets=() skipped=()
  files=$(changed "$base")

  # a skill is tested only when it ships evals; otherwise it is skipped LOUDLY
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if [[ -d ".claude/skills/$name/evals" ]]; then
      targets+=("skill:$name")
    else
      skipped+=("skill:$name has no evals/ - nothing to check")
    fi
  done < <(grep -oE '^\.claude/skills/[^/]+/' <<<"$files" | cut -d/ -f3 | sort -u)

  grep -qE '(^|/)AGENTS\.md$|(^|/)CLAUDE\.md$' <<<"$files" && targets+=("instructions")
  grep -qE '^\.claude/agents/'                 <<<"$files" && targets+=("agents")
  grep -qE '^\.claude/commands/'               <<<"$files" && targets+=("commands")

  for s in "${skipped[@]:-}"; do [[ -n "$s" ]] && echo "SKIP $s" >&2; done
  if [[ ${#targets[@]} -eq 0 ]]; then
    echo "SKIP nothing eval-relevant changed" >&2
    echo '[]'
    return
  fi
  printf '%s\n' "${targets[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'
}

# ----------------------------------------------------------------- check mode
fails=0
ok()   { echo "  ok    $1"; }
bad()  { echo "  FAIL  $1"; fails=$((fails+1)); }
json_ok() { python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$1" 2>/dev/null; }

check_skill() {
  local name=$1 dir=".claude/skills/$1"
  echo "skill: $name"
  [[ -f "$dir/SKILL.md" ]] && ok "SKILL.md present" || bad "SKILL.md missing"

  # frontmatter name must match the directory, or /<name> resolves to nothing
  local declared
  declared=$(sed -n 's/^name:[[:space:]]*//p' "$dir/SKILL.md" 2>/dev/null | head -1)
  [[ "$declared" == "$name" ]] && ok "frontmatter name matches directory" \
    || bad "frontmatter name '$declared' != directory '$name'"
  grep -q '^description:' "$dir/SKILL.md" 2>/dev/null && ok "has a description" \
    || bad "no description - the skill can never trigger"

  if [[ -f "$dir/evals/evals.json" ]]; then
    if json_ok "$dir/evals/evals.json"; then
      ok "evals.json parses"
      while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        # a fixture path may be written relative to the repo root, the skill
        # root, or the evals/ directory it sits next to - all three are in use
        if [[ -e "$f" || -e "$dir/$f" || -e "$dir/evals/$f" ]]; then
          ok "fixture exists: $f"
        else
          bad "fixture missing: $f (tried repo root, $dir/, $dir/evals/)"
        fi
      done < <(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
for e in d.get("evals",[]):
    if e.get("fixture"): print(e["fixture"])' "$dir/evals/evals.json")
    else
      bad "evals.json does not parse"
    fi
  fi

  # a fixture that explains its own planted defect teaches the model the answer
  if [[ -d "$dir/evals/fixtures" ]]; then
    if grep -rlniE 'planted|intentional(ly)? (wrong|broken)|this is the bug' "$dir/evals/fixtures" >/dev/null 2>&1; then
      bad "a fixture comment gives away its planted defect"
    else
      ok "fixtures carry no give-away comments"
    fi
  fi

  while IFS= read -r py; do
    [[ -z "$py" ]] && continue
    python3 -m py_compile "$py" 2>/dev/null && ok "compiles: ${py#"$dir/"}" || bad "syntax error: $py"
  done < <(find "$dir" -name '*.py' 2>/dev/null)
}

check_instructions() {
  echo "instruction layer"
  while IFS= read -r f; do
    [[ -L "$f" ]] || continue
    [[ "$(readlink "$f")" == "AGENTS.md" ]] && ok "$f -> AGENTS.md" || bad "$f points at $(readlink "$f")"
  done < <(git ls-files '*CLAUDE.md')

  # every doc the root file points at must still be there
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    [[ -e "$p" ]] && ok "pointer resolves: $p" || bad "pointer is dead: $p"
  done < <(grep -oE '`[^`]+\.(md|sh)`' AGENTS.md | tr -d '`' | sort -u)
}

check_agents() {
  echo "agents"
  while IFS= read -r f; do
    # an agent definition opens with YAML frontmatter; README.md and
    # INSIGHTS.md live in the same folder and are documentation, not agents
    [[ "$(head -1 "$f")" == "---" ]] || { echo "  skip  $(basename "$f") (no frontmatter - documentation)"; continue; }
    local n; n=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -1)
    [[ -n "$n" ]] && ok "$(basename "$f") declares a name" || bad "$(basename "$f") has no name:"
    grep -q '^description:' "$f" && ok "$(basename "$f") has a description" \
      || bad "$(basename "$f") has no description"
    [[ "$n" == "$(basename "$f" .md)" ]] || bad "$(basename "$f"): name '$n' != filename"
  done < <(find .claude/agents -name '*.md' 2>/dev/null)
}

check_commands() {
  echo "commands"
  while IFS= read -r f; do
    grep -q '^description:' "$f" && ok "$(basename "$f") has a description" \
      || bad "$(basename "$f") has no description"
    # a command that names a skill must not outlive it
    while IFS= read -r s; do
      [[ -z "$s" ]] && continue
      [[ -d ".claude/skills/$s" ]] && ok "$(basename "$f") -> skill $s exists" \
        || bad "$(basename "$f") names skill '$s', which does not exist"
    done < <(grep -oE '`[a-z0-9-]+` skill' "$f" | sed 's/` skill//; s/`//' | sort -u)
  done < <(find .claude/commands -name '*.md' 2>/dev/null)
}

case "${1:-}" in
  matrix) emit_matrix "${2:-origin/main}" ;;
  check)
    case "${2:-}" in
      skill:*)      check_skill "${2#skill:}" ;;
      instructions) check_instructions ;;
      agents)       check_agents ;;
      commands)     check_commands ;;
      *) echo "unknown target '${2:-}'" >&2; exit 1 ;;
    esac
    echo
    [[ $fails -eq 0 ]] && echo "PASS" || { echo "FAIL ($fails)"; exit 1; }
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
