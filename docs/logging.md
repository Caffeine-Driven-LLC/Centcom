# Logging

Centcom writes a structured log so problems can be diagnosed without exposing anything private.

- **Where:** `~/.centcom/logs/centcom.log` (or `$CENTCOM_STATE_DIR/logs`). The folder is private (0700) and files are 0600. At 5 MiB the file rotates to `centcom.log.1`, `.2`, keeping 3 files.
- **How much:** `log.level` in your config (`debug`, `info`, `warn`, `error`; default `info`), or `--debug` for a single run. See [configuration](configuration.md).
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
