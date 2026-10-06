# doctor and crash reports (lane C097)

## `centcom doctor [--json] [--bundle <file>] [--check <id>...] [--timeout-ms n]`

Checks this computer in parallel and says what to do about each problem: `node`, `os`, `terminal`, `keychain` (stores and removes a test entry), `git`, `config`, `network` (`/healthz`), `version` (this client against the service's minimum and contract) and `clock` (skew against the service: a warning above 30 s, a failure above 60 s).

- Every network check gives up after 3 s, so a blackholed network still finishes inside the 8 s limit.
- Every problem has exactly one `next_step`. Exit code 0 means all pass, 1 warnings only, 2 any failure.
- `--json` prints `{schema_version: 1, version, contract, checks: [{id, status, summary, next_step?, duration_ms}]}` (the schema is `REPORT_SCHEMA`).
- `--bundle` writes a local `.tar.gz` with the report and the crash reports. Nothing is uploaded; look at it before sharing.
- Output never includes a path, a token or a name.

## Crash reports (`src/crash`)

- Anything uncaught is written to `<state>/crashes/<time>.json` (mode 0600, at most 64 KiB, the 10 newest kept) and the process ends with a short message. A report holds the version, contract, platform, error code, a redacted message and stack (file paths reduced to package-relative form) and the last 50 redacted log lines.
- Redaction takes out secrets (the shared list plus GitHub, Slack, Stripe, npm and Centcom key shapes), the home folder, absolute paths, and a deny-list (repo folder name, branch names, user name). A 30-string corpus is tested for leaks.
- `centcom crash list | show <id> | delete <id|--all>`.
- Nothing is ever sent. With telemetry on, a crash with an error code emits one `error.shown {code}` and nothing else.
