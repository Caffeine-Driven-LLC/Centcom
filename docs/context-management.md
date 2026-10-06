# Context management

Centcom shows each agent's context and usage **exactly as its engine reports it**. It never counts, estimates or summarises tokens: there is no tokenizer and no table of model windows. A number the engine did not send stays blank.

## What is shown

- `used` and `window` (what the engine reports), `pct` (used / window, or the engine's own percentage), and totals of input tokens, output tokens and cost.
- Without a window, `pct` is missing and the meter shows raw counts or "not reported". No warning is ever raised from a missing number.
- Totals are summed per agent and counted once per engine message id, so a resumed session that replays its history does not count twice (a report with no message id is told apart by its sequence number). Totals never go down.
- The bus event `agent:context` carries `used`, `window`, `pct` at most once per second per agent.

## Warnings

`context.warn_pct` (default 75) and `context.full_pct` (default 97) apply to the engine's own percentage only. Each fires once, and fires again only after the number has dropped 10 points below it. `full` is the local `context-full` state (`agent:context_alert` with level `full`); it clears (`ok`) when the number falls below 87, normally after a compaction.

## Compaction

`requestCompaction(agent)` asks the engine to compact itself with its own documented command (`/compact` for Claude Code, sent as a prompt). It only works when the engine has the `compact` capability and the agent is waiting between turns:

| Result | Meaning |
|---|---|
| `{ ok: true }` | the command was sent (once) |
| `unsupported` | the engine has no compact command; nothing is sent, and the UI says why |
| `busy` | a turn is running, an approval is pending, a compaction is already running, or a recent failure is backing off (60 s) |
| `not_idle` | the agent has exited |
| `failed` | the send failed; Centcom backs off for 60 s |

Progress comes from the engine (`compaction.started` / `compaction.ended` with before and after if it reports them) and is re-emitted as `agent:compaction`; the state machine shows `compacting`.

`context.auto_compact` (default **off**, because a compaction changes what the model remembers) asks once per cycle when the engine reports `context.auto_pct` (default 85) or more and the agent is idle.

## Not here

The meter itself, the `centcom context` command and the `/compact` TUI command are for the TUI and CLI lanes; the state machine does not yet turn `agent:context_alert` into the `context-full` state (C014 follow-up).
