# Logging

Centcom writes a structured log so problems can be diagnosed without exposing anything private.

- **Where:** `~/.centcom/logs/centcom.log` (or `$CENTCOM_STATE_DIR/logs`). The folder is private (0700) and files are 0600. At 5 MiB the file rotates to `centcom.log.1`, `.2`, keeping 3 files (`log.max_files`). With `log.max_files: 1` there is no history: the file is deleted at the size limit and starts again, so it never exceeds `log.max_file_bytes`.
- **How much:** `log.level` in your config (`debug`, `info`, `warn`, `error`, `silent`; default `info`). `silent` writes nothing at all, not even errors (no records are built, so the `log.redaction_failed` record cannot appear either), or `--debug` for a single run. See [configuration](configuration.md).
- **Format:** one JSON object per line: `{"ts":…,"level":…,"component":…,"msg":"http.retry", …}`. `msg` is a fixed event name; variable details are fields.

## What is never logged

Tokens, keys, ciphertext, message text, file contents, paths, branch names, commands, diffs, prompts, summaries, emails. Callers pass ids and enums (a tool name, a risk level, an outcome). This is enforced by the logger, not by each caller:

- A key deny-list (`token`, `authorization`, `text`, `delta`, `command`, `cwd`, `path`, `branch`, `ct`, `content`, `email`, and more) is replaced by `[redacted]` at any depth, including inside arrays and error causes.
- Free text is scanned for credentials (the contract's patterns for Anthropic, OpenAI, AWS and Google keys, JWTs, bearer headers, Codex auth JSON), Centcom API keys, private-key blocks, email addresses, absolute file paths, long opaque strings, and your home directory. Hex digests, ULIDs and versions pass through.
- Limits: depth 6, strings 2048 characters, arrays 50 items, 16 KiB per line. Cycles, getters that throw, bigints and symbols are handled.
- If redaction itself ever fails, the record is replaced by `log.redaction_failed` with no context. There is no setting to turn redaction off.

## Failure behavior

Writes never block the app and errors are swallowed. If the folder cannot be created, the file sink is skipped (one warning on stderr) and the in-memory ring still works. If the disk is full, records are dropped and counted, and a `log.dropped` record with the count is written when space returns.

## Diagnostics

`collectDiagnostics` gathers what a bug report needs: app and contract version, OS, Node, terminal color depth, your settings with where each came from (values of sensitive keys are hidden), and the last 500 log records. It returns data only; the `centcom doctor` command (a separate lane) writes it out.

## Performance

The file sink queues records on a promise chain, but each queued write is a synchronous `appendFileSync`, so every record blocks the main thread for one small write. At `info` and above the volume is low and this is not noticeable. At `debug` or `trace` the volume is high and the writes add up; use those levels for a single run (`--debug`), not as a permanent setting. Records below the level are dropped before any work is done.

## Several apps, one file

Each process has one app logger. The web server creates a single logger shared by every open folder (each workspace adds its own `session_id` binding), so folders do not rotate each other's output. The first folder opened decides the web server's `log.*` settings until it restarts.

The CLI and the web server are separate processes that can write the same `centcom.log`. Appends are small and made in append mode, so lines do not interleave, and before rotating a sink re-reads the real file size so it does not rotate output another process just wrote. The remaining limit: two processes can still rotate at nearly the same moment, which can lose or reorder a rotated file, and with `max_files: 1` one process can delete the other's recent lines. Point them at different `CENTCOM_STATE_DIR` values if that matters.
