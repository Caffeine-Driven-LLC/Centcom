# accounting (lane C029)

Usage as the engines reported it: tokens, cache tokens, agent time and cost, per agent, per conversation, per day and for the last 7 days.

- **Only reported numbers.** A cost appears only when the CLI gave one (Claude Code's `total_cost_usd`), always followed by `est.`; otherwise it says `not reported`. There is no price table here, and a test fails the build if one appears.
- **Running totals.** Claude Code reports cost as a total for its session (and again on resume), so the ledger keeps the last total per engine session and adds only the difference. A total that goes down starts a new baseline.
- **Agent time** counts every state except `idle`, `ready`, `sleeping`, `away`, `awaiting-approval` and `asking-question`. Whole minutes go to the outbox as `agent_minutes`; the rest is carried.
- **Budget.** `budget.session_usd` (0 = off) emits `cost.alert` on the bus at 80 % (warn) and 100 % (error) of a conversation's reported cost, once each. It only warns; nothing is stopped.
- **Limits.** An engine's own limit message counts as a `limitEvents`; nothing is enforced locally.
- **Outbox.** `<data>/usage/outbox.jsonl` holds informational CT-API-USAGE events (`agent_minutes`, `tokens_in`, `tokens_out`; ids `use_` + ULID; no text, paths, models or engine ids). At most 10,000 wait: token events are dropped first, agent minutes last. `dequeueBatch` gives at most 500; `ack` rewrites the file atomically; `requeue` puts a failed batch back in front. Sending it is the usage client's job (a later lane); this code never opens a socket.

In the app: `/usage` shows the table; the controller feeds the ledger from each agent's events.
