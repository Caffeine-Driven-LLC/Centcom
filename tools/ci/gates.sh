#!/usr/bin/env bash
# Every check CI runs, in the same order, stopping at the first failure. Run it before every push.
set -euo pipefail
cd "$(dirname "$0")/../.."
step() { printf '\n== %s\n' "$1"; }
step "lockfile";        pnpm install --frozen-lockfile --prefer-offline >/dev/null
step "protocol";        pnpm --filter @centcom/protocol gen --check
step "http client";     pnpm --filter @centcom/net gen:http --check
step "skills pack";     node tools/skills/build-manifest.mjs --check
step "states doc";      pnpm exec tsx tools/docs/states-doc.ts --check
step "typecheck";       pnpm -s typecheck
step "tests";           pnpm -s test
step "web build";       pnpm -s web:build >/dev/null
step "plan";            pnpm -s plan:check
step "progress";        python3 tools/plan/progress.py --check
printf '\nall gates passed\n'
