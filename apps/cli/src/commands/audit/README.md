# `centcom audit` (lane C070)

- `audit list [--workspace wsp_..] [--actor id] [--action name] [--from t] [--to t] [--limit 1..1000] [--json]`: pages through `GET /v1/workspaces/{id}/audit` with cursors (at most 200 per request, never an offset). Exit 4 when nothing matches.
- `audit export --format csv|json [filters] [--out file] [--wait] [--force]`: starts an export (with an `Idempotency-Key`), polls at 2, 4, 8 then every 10 seconds, gives up after 5 minutes (the export id is printed first), and downloads to the file with mode 0600. An existing file is kept unless `--force`; a failed, interrupted or cancelled download deletes the partial file. The signed download address never reaches the output.
- Times: RFC 3339 or relative (`90m`, `24h`, `7d`, `2w` ago), converted to UTC with milliseconds; anything else is refused locally.
- Table output removes control characters and escape sequences from every server field; `--json` passes the events through unchanged.
- When the plan's `audit_log_days` is 0 the command stops before any audit request; a 403 explains that admin or owner is needed.
