# Telemetry

Centcom can send anonymous usage counts so we know which features are used and how fast it runs. **It is off unless you turn it on** (`telemetry.enabled`), and two switches always win over any setting:

- `DO_NOT_TRACK=1` (or `true`)
- `CENTCOM_TELEMETRY=off`

When it is off, nothing is recorded, nothing is stored and no timer runs.

## What can be sent

Only these events, and only these fields. The code has no way to send anything else: every value is checked against an allow-list before it is even stored, and an event that fails is dropped and counted.

| Event | Fields |
|---|---|
| `app.start`, `app.exit` | none |
| `command.run` | `name`: a registered command name |
| `session.created` | `mode` (`command_post`, `branch`), `transport` (`lan`, `relay`) |
| `session.joined` | `transport` |
| `agent.state_change` | `from`, `to`: agent-level state names |
| `feature.used` | `key`: a short key such as `web.open` (names that look like hosts or files, e.g. `x.local`, `notes.txt`, are refused; the product can pass its own list of feature keys) |
| `error.shown` | `code`: an error code from the registry |
| `perf.startup`, `perf.frame` | milliseconds (bounded numbers) |
| `update.result` | `from`, `to` (versions), `ok` |

**Never sent:** message, code or diff text, file paths, branch or repo names, prompts, model output, host names, user names, e-mail addresses, keys, anything encrypted.

## How it is sent

- A random `install_id` (a ULID) stored in `<state dir>/telemetry/install_id` (mode 0600). It is not derived from anything about you or your computer and is not linked to an account. `resetInstallId()` (behind `centcom telemetry reset`) deletes it and makes a new one.
- No `Authorization` header, no cookies, no user, device or session ids. Only the user agent and an `Idempotency-Key`.
- Batches of up to 100 events (64 KiB at most), at most one send per minute (measured with a clock that cannot go backwards), at most 1,000 events kept in memory (the oldest are dropped first). Events are never written to disk; a crash loses at most what was in memory.
- Everything is fire and forget: 5 seconds per request, a failed batch is retried once (same key) and then dropped, and you never see anything. On exit a flush sends what is allowed to go, and returns within 2 seconds.

Because of the one-per-minute rule, events from a session shorter than a minute may never be sent after the first batch.

## For other lanes

`createTelemetry(...)` gives the typed methods (`appStart`, `commandRun`, `featureUsed`, ...). Pass the CLI's command names as `commands` and the product's feature keys as `features` so only those can ever be reported. The opt-in prompt, the `centcom telemetry on|off|reset|status` commands and syncing the choice to the account are for the CLI and account lanes.
