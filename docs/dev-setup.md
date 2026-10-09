# Dev setup: from clone to a running mock and CLI in five minutes

1. **Install.** Node 22 and pnpm 10 or newer. `pnpm install`.
2. **Start the mock backend.** `pnpm dev:mock`. It prints a JSON line with the HTTP and WebSocket addresses, then the `export` lines the client needs (`CENTCOM_API_URL`, `CENTCOM_RELAY_URL`, `CENTCOM_CONFIG_DIR=.dev/config`, `CENTCOM_STATE_DIR=.dev/state`). Options: `-- --scenario <name>`, `-- --port <n>`, `-- --seed <n>`. Scenarios are listed in `docs/mock-backend.md`.
3. **Run the client against it.** In another terminal, paste the `export` lines, then `pnpm centcom login` and `pnpm centcom whoami`.
4. **Try the terminal app with a pretend agent.** `pnpm dev` (the demo agent, no account needed).
5. **Make a throwaway git project** for worktree, lock and agent tests: `node tools/dev/make-fixture-repo.mjs /tmp/fixture --branches 3 --dirty`. The same flags always give the same commit hashes.

The seed data is in `dev/seed` (see `dev/README.md`); change a file there and restart the mock. A dev container is in `.devcontainer/` (Node 22, pnpm).

Before pushing: `./tools/ci/gates.sh`.

## Checking the real terminal behaviour

`python3 tools/dev/pty-smoke.py` (needs `pip install pyte`) runs the real `centcom` in a pseudo-terminal with a throwaway home folder and checks what unit tests cannot: the alternate screen and mouse reporting coming back on quit and on `kill`, the tab title, the editor round trip (ctrl+g), ctrl+z with `bg` and `fg` in a real `bash`, plain-text mode, and bad command lines. `python3 tools/dev/pty-smoke.py editor` runs only the checks with that word in their name. `tools/dev/shot.py` takes a screenshot of any screen.
