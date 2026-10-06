#!/usr/bin/env bash
# Run every gate; only if all pass, commit everything (except local tooling) and push to main. Usage: tools/ci/commit.sh "message"
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 tools/plan/progress.py >/dev/null
log=$(mktemp)
if ! ./tools/ci/gates.sh >"$log" 2>&1; then grep -E "^==|Tests |error TS|×|FAIL|Error" "$log" | tail -25; echo "gates FAILED: nothing committed"; exit 1; fi
grep -E "Tests |all gates" "$log" | tail -2
git add -A -- . ':!tools/dev/pr-watch.sh' ':!tools/dev/pr-watch.prompt.md'
git commit -q -m "$1"
git push -q origin main
git log --oneline -1
