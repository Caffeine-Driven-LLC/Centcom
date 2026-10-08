#!/bin/sh
# From a fresh clone to a working `centcom` command. Usage: sh tools/dev/onboard.sh [--check]   (--check only reports, changes nothing)
cd "$(dirname "$0")/../.." || exit 1
check=0; [ "$1" = "--check" ] && check=1
ok() { printf '  ok    %s\n' "$1"; }; no() { printf '  MISSING  %s\n' "$1"; miss=1; }; miss=0
echo "Centcom onboarding"
command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] 2>/dev/null && ok "node $(node -v)" || no "Node 22 or newer (https://nodejs.org)"
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm -v)" || no "pnpm (npm i -g pnpm)"
command -v git >/dev/null 2>&1 && ok "git" || no "git"
[ $miss -eq 1 ] && { echo "Install what is missing, then run this again."; exit 1; }
if [ $check -eq 0 ]; then echo "Installing dependencies…"; pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install || exit 1; sh tools/dev/install-cli.sh || exit 1; else [ -d node_modules ] && ok "dependencies installed" || echo "  todo  pnpm install"; command -v centcom >/dev/null 2>&1 && ok "centcom command" || echo "  todo  pnpm install:cli"; fi
agents=0
if command -v claude >/dev/null 2>&1; then ok "Claude Code ($(claude --version 2>/dev/null | head -1))"; agents=1; else echo "  --    Claude Code not found (npm i -g @anthropic-ai/claude-code, then: claude)"; fi
if command -v codex >/dev/null 2>&1; then ok "Codex ($(codex --version 2>/dev/null | head -1))"; agents=1; else echo "  --    Codex not found (npm i -g @openai/codex, then: codex login)"; fi
[ $agents -eq 0 ] && echo "  No agent installed: Centcom will offer its demo agent (centcom --demo) until you add one."
cat <<'TXT'

Next:
  cd your-project && centcom        start (add --engine codex for Codex; centcom --demo to look around)
  ctrl+n                           night cycle: queue tasks to run while you sleep
  ? or ctrl+k                      help and the command palette
  pnpm app                         the desktop app
Docs: README.md, docs/night-cycle.md, docs/dogfood.md
TXT
