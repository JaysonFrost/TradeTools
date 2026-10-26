#!/bin/bash
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}"
export PATH="$HOME/.local/bin:$PATH"
echo "export PATH=\"$HOME/.local/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"

uv tool install -q 'graphifyy[sql]==0.9.95' >&2 || command -v graphify >/dev/null
[ -f "$HOME/.claude/skills/graphify/SKILL.md" ] || graphify install >/dev/null

claude plugin list 2>/dev/null | grep -q 'ponytail@ponytail' \
  || claude plugin install ponytail --marketplace DietrichGebert/ponytail -s user >&2 \
  || echo "ponytail install failed" >&2

exclude="$(git rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$exclude")"
grep -qx 'graphify-out/' "$exclude" 2>/dev/null || echo 'graphify-out/' >> "$exclude"

log="/tmp/graphify-update-$(basename "$PWD").log"
GRAPHIFY_BACKEND=none GRAPHIFY_NO_TIPS=1 graphify update . >"$log" 2>&1 || echo "graphify update failed, see $log" >&2
