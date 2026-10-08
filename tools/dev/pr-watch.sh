#!/usr/bin/env bash
# Runs the PR watch every 2 minutes in its own process, so it never interrupts your other Claude session.
# Usage (in a separate terminal tab):  tools/dev/pr-watch.sh        Stop with Ctrl-C.
set -u
cd "$(dirname "$0")/../.." || exit 1
PROMPT="$(cat tools/dev/pr-watch.prompt.md)"
while true; do
  printf '\n[%s] pr-watch pass\n' "$(date +%H:%M:%S)"
  claude -p "$PROMPT" --allowedTools "Bash(gh:*) Bash(git:*) Bash(pnpm:*) Bash(python3:*) Bash(npx:*) Bash(node:*) Read Edit Write" || echo "pass failed, will retry"
  sleep 120
done
