# print mode (lane C050)

`centcom -p "task"` runs one task without a screen.

- **Prompt.** The argument, plus any piped input added as a fenced block (at most 1 MiB, otherwise exit 2 with `Input is too large (max 1 MiB).`).
- **Output.** stdout carries only data:
  - `text`: the assistant's text;
  - `json`: one line `{type:'result', is_error, result, usage, session_id, engine, duration_ms, error?}`;
  - `stream-json`: Centcom's normalised events, one per line (`session.started`, `text.delta`, `text.done`, `tool.requested`, `tool.result`, `approval.requested`, `usage.report`, `turn.done`, `error`), then the same `result` line.

  Everything for people goes to stderr. All output is redacted with the CT-PROVIDER secret patterns.
- **Permissions.** Nothing is ever prompted: what still needs an approval is declined, and the run exits 3. You can allow things with:
  - `--allow "<rule>"` (repeatable, permission-rule syntax: `Bash(npm test)`, `Edit(src/**)`);
  - `--permission-mode ask|accept-edits|plan`;
  - `--dangerously-skip-permissions`, which stays available on purpose and must be typed out.
- **Other flags.** `--engine claude-code|codex`, `--model`, `--resume <id>`, `-c`/`--continue`, `--timeout <s>` (exit 124), `--max-turns <n>` (agent steps, default 50), `--cwd <dir>`. If no engine is installed, the run exits 4 and never uses the demo agent.
- **Exit codes** (`exit-codes.ts`):

  | Code | Meaning |
  |---|---|
  | 0 | Done |
  | 1 | Failed |
  | 2 | Bad usage |
  | 3 | Something was declined |
  | 4 | Provider not installed, not signed in, or blocked |
  | 5 | Plan or rate limit |
  | 6 | Engine protocol error or service unavailable |
  | 124 | Timeout |
  | 130 | Interrupted (ctrl+c) |

  If the reader closes stdout early (`| head -1`), the engine is stopped and the run exits 0 without a stack trace.

## Not yet

- `--input-format stream-json`.
- Engine-native `--max-turns` (the limit is counted by Centcom).
- A spawned-binary test of `| head -1`.
