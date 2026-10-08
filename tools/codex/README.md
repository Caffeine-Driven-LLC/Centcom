# Mock Codex

`tools/codex/mock-codex.mjs` (run through `tools/codex/bin/codex`) behaves like codex-cli 0.161.0 for everything Centcom uses: `--version`, `login status`, and `app-server --listen stdio://` with the JSON-RPC methods and notifications seen in the recorded real traffic (`packages/agent/test/fixtures/providers/codex`). It runs real commands and edits real files. Like the real Codex, it does not stop a running command on `turn/interrupt`, so it exercises Centcom's own Stop.

Use it: `CENTCOM_CODEX_BIN=$PWD/tools/codex/bin/codex` (read by the engine and by detection), or `pnpm app:mock` to open the desktop app with it. Choose Codex in the Local agent screen.

Prompts: `run: <command>`, `edit <file> from <a> to <b>`, `create <file> with <text>`, `sleep <seconds>`, `think <text>`, `fail`, `fail usage`, `fail auth`; anything else gets a plain answer. `MOCK_CODEX_SIGNED_IN=0` makes it signed out. Thread history is kept in `MOCK_CODEX_HOME` (default a temp folder) so resume works.

It is a stand-in, not a spec: if the real Codex differs, the recordings and `questions.txt` win.
