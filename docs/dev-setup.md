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


## Seeing the app

`python3 tools/dev/screenshot.py OUT_DIR [scene ...]` runs the real `centcom --demo` in a pseudo-terminal and writes each scene as a PNG with the real colours (scenes: welcome, chat, approval, settings, palette, help, narrow, busy, error, ask; add `-light` for the light theme). It needs `pip install pyte pillow` and a monospace font (set `CENTCOM_FONT` to choose one). Use it to check how a change looks, next to `tools/dev/pty-smoke.py`, which checks how it behaves.

`node apps/web/scripts/gui-shots.mjs OUT_DIR [scene ...]` does the same for the desktop app's screens (home, session, approval, busy, narrow, and `-light` variants): it runs the web app in headless Chromium with a scripted stand-in for the desktop bridge, so no Electron window is needed. If Playwright's own browser revision is not installed, point `PW_CHROMIUM` at any Chromium.
