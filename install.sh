#!/usr/bin/env bash
#
# Install the Braintrust skills (every skill under skills/) into an agent-agnostic
# skills directory. The canonical location is <root>/.agents/skills/<name>/SKILL.md,
# which most agents read directly; agent-specific directories can alias to it.
#
# Usage:
#   ./install.sh [--global] [--link] [--agent NAME]...
#
#   --global        Install into ~/.agents/skills instead of ./.agents/skills
#   --link          Symlink the skill instead of copying (tracks repo updates)
#   --agent NAME    Also alias an agent-specific skills dir to .agents/skills.
#                   Repeatable. Supported: claude, gemini, qwen, copilot, opencode.
#                   (codex reads .agents/skills directly; cursor uses .cursor/rules.)
#   -h, --help      Show this help.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/skills"

scope_root="$PWD"
use_link=false
agents=()

usage() {
  sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) scope_root="$HOME"; shift ;;
    --link) use_link=true; shift ;;
    --agent)
      [[ $# -ge 2 ]] || { echo "error: --agent requires a value" >&2; exit 1; }
      agents+=("$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "error: skills directory not found at $SKILLS_SRC" >&2
  exit 1
fi

canonical_dir="$scope_root/.agents/skills"
mkdir -p "$canonical_dir"

for skill_path in "$SKILLS_SRC"/*/; do
  [[ -f "$skill_path/SKILL.md" ]] || continue
  skill_name="$(basename "$skill_path")"
  dest="$canonical_dir/$skill_name"

  rm -rf "$dest"
  if $use_link; then
    ln -s "${skill_path%/}" "$dest"
    echo "linked  $dest -> ${skill_path%/}"
  else
    cp -R "${skill_path%/}" "$dest"
    echo "copied  $dest"
  fi
done

agent_dir_for() {
  case "$1" in
    claude) echo ".claude" ;;
    gemini) echo ".gemini" ;;
    qwen) echo ".qwen" ;;
    copilot) echo ".copilot" ;;
    opencode) echo ".opencode" ;;
    codex)
      echo "note: codex reads .agents/skills directly; no alias needed" >&2
      echo "" ;;
    cursor)
      echo "warning: cursor uses .cursor/rules (.mdc), not the skills format; skipping alias" >&2
      echo "" ;;
    *)
      echo "warning: unknown agent '$1'; skipping alias" >&2
      echo "" ;;
  esac
}

for agent in "${agents[@]:-}"; do
  [[ -n "$agent" ]] || continue
  agent_dir="$(agent_dir_for "$agent")"
  [[ -n "$agent_dir" ]] || continue
  alias_parent="$scope_root/$agent_dir"
  alias_path="$alias_parent/skills"
  mkdir -p "$alias_parent"
  if [[ -e "$alias_path" || -L "$alias_path" ]]; then
    if [[ -L "$alias_path" ]]; then
      rm -f "$alias_path"
    else
      echo "warning: $alias_path exists and is not a symlink; leaving it untouched" >&2
      continue
    fi
  fi
  ln -s "$canonical_dir" "$alias_path"
  echo "aliased $alias_path -> $canonical_dir"
done

echo "Done. Skill installed under $canonical_dir"
