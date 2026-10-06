# persistence (lane C026)

Centcom's own record of every conversation. It never reads the CLIs' stores (`~/.claude*`, `~/.codex/*`); engine session ids come only from the events the CLIs emit.

- **Layout.** Each session lives at `<data>/sessions/<ses_id>/`, with folders at 0700 and files at 0600; a symlinked folder is refused.
  - `log.jsonl` starts with the header `{"fmt":"centcom.localsession","v":2}`, then one record per line: `{n, at, agent_id?, type, data}`. The log rolls to `log.1.jsonl`, `log.2.jsonl` and so on at 64 MiB.
  - `lock` holds the writer's pid. A live lock refuses a second writer with `session in use`; a stale lock is taken over.
  - `view.json` is an optional copy of what the terminal app showed, for fast redraws. Without it, the transcript is rebuilt from the log.
  - `<data>/sessions/index.json` lists every session. It is rewritten atomically and rebuilt from the logs when missing or damaged (500 sessions of 1,000 records take well under 2 s).
- **Writing.**
  - Records are buffered and flushed every 250 ms or every 50 records.
  - Every string is redacted with the CT-PROVIDER secret patterns and cut to 8 KiB. Environment dumps are dropped, and a record over 1 MiB is stored as `{truncated: true}`.
  - If the disk refuses a write, the buffer keeps at most 1,000 records or 8 MiB, `session.persist_failed` is emitted once, and the session goes on.
- **Append-only.** A rewind appends a `rewind` record. A line cut short by a crash is skipped when reading, and the next writer appends `recovered`; earlier bytes are never rewritten.
- **Engine sessions.** Each `session.started` adds an `engine.session` row (`claude-code` session id or Codex thread id). A conversation can hold several rows, for example after switching engine.
- **`resumeSession`.** It continues the engine's own session when it is the same engine, the engine has `resume`, and it accepts the id. Otherwise it starts a fresh engine session whose instructions carry a summary of the last 40 messages (at most 8 KiB), and reports the engine's own reason. With no engine available, the session opens read-only.
- **`toSnapshotEvents(id, {fromSeq})`** returns the normalised events from record `n` onward, redacted again, for the LAN and relay session lanes.
- **Retention.** `prune(now)` removes sessions not used for `retentionDays` (30), never a locked one.

The terminal app uses this through `packages/tui/src/sessions.ts`. Conversations saved by older versions are moved over once. `centcom -c` / `--continue` and `--resume [id]` are handled in `apps/cli/src/commands/resume.ts`.
