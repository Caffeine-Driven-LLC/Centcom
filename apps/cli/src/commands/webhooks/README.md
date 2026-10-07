# `centcom webhooks` (lane C069)

Manage outgoing webhooks and check their signatures locally.

| Command | What it does |
|---|---|
| `list [--workspace] [--json]` | all webhooks of the workspace (default: the active one from `/v1/me`) and how many your plan allows |
| `show <whk_id>` | one webhook; never shows the secret |
| `create --url <https-url> --event <type> [--event ...] [--disabled] [--show-secret]` | creates one and shows the signing secret **once** |
| `update <whk_id> [--url] [--event ...] [--enable\|--disable]` | changes it |
| `rotate-secret <whk_id> [--show-secret]` | a new secret, shown once; the old one works for 24 hours |
| `delete <whk_id> [--yes]` | asks first on a terminal; needs `--yes` otherwise |
| `test <whk_id>` | sends a `webhook.test` event |
| `deliveries <whk_id> [--limit 1..200]` | recent deliveries (id, event, attempt, status, time) |
| `redeliver <whk_id> <dlv_id>` | another attempt for one delivery |
| `verify --secret-stdin --signature <header> --body-file <path> [--tolerance 300]` | the receiver check of CT-WEBHOOKS; exit 3 when it fails |

The signing secret is printed on a terminal, or with `--show-secret` when the output is piped. Otherwise a message says it cannot be shown again. `--json` never contains it unless it would also be printed. Addresses must be `https://` (plain `http://localhost` only with `--allow-localhost`). Event types are checked against the contract list before any request. Creating and redelivering send an `Idempotency-Key`, which the HTTP client keeps the same across retries.

Exit codes: 0 ok, 1 failure, 2 sign-in needed, 3 a signature did not verify.
