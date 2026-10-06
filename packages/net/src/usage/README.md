# usage reporting (lane C065)

Sends the informational usage events (`agent_minutes`, `tokens_in`, `tokens_out`) to `POST /v1/usage/events`, and tracks the quota the server reports. It never decides anything locally.

- **`UsageReporter.record()`** is synchronous and never throws. Only events of a hosted session are kept; LAN, local and logged-out events are refused (a logged-out run warns once). Kept events go to a spool file (`spool.jsonl`, mode 0600, 10,000 events or 5 MiB, oldest dropped and counted).
- **Batches:** at most 500 events and 1 MiB, each with its own `Idempotency-Key` that stays the same on every resend, at most 60 requests a minute. A kill between `record()` and the send loses nothing; a spool cut off mid-line keeps every complete line.
- **Outcomes:** 2xx removes the batch; 429 pauses (`retry_after_s`) while recording goes on; 422 and other 4xx drop that batch (logging only the code and pointers); 5xx, offline and 401 keep it and back off; a 409 conflict is retried once if the batch changed, otherwise dropped.
- **`QuotaTracker`:** `usage_warning` is a warning, `quota_reached` is reached until `resets_at`; neither stops reporting or any local command. `allowsHostedActions()` is for hosted actions only.
- **`stop()`** flushes within 5 s or leaves the spool for the next run.
