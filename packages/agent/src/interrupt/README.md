# interrupt (lane C030)

One way to stop an agent, whatever the engine.

- **`createInterruptController`** ends the current turn and denies the agent's open approvals (their prompts close). It marks the turn as cancelled, so a late approval from that turn is denied without asking. It then leaves the agent `idle`, with the partial answer kept and flagged `interrupted: true`, and emits `agent.interrupted` once.
  - Concurrent interrupts share one run. Interrupting an idle agent returns `stoppedStream: false`.
  - If an engine ignores the interrupt for 9 s, the agent is set idle anyway and the failure is logged.
- **`ctrlC()` / `onSignal(proc)`**:
  - During a turn: the first press stops it softly, and a second within 1 s stops it hard and exits with code 130.
  - When idle: the first press shows `Press ctrl+c again to exit`, and a second within 2 s exits.
  - The library never calls `process.exit`. The app maps the codes.
- **`signalLadder`** sends SIGINT, then SIGTERM after the grace time (3 s, `limits.interrupt_grace_ms`), then SIGKILL at 8 s. `hard` sends SIGKILL at once.
- **`ProcessRegistry`** holds the engine processes Centcom started, by agent.
  - Signals only go to these pids, never to anything found by name.
  - Engines are spawned as their own process group (not on Windows), so a signal reaches every tool, MCP server and approval helper they started.
  - Windows uses `taskkill /T /F`.
  - The shared registry kills every group when Centcom exits.

## Engines

- **Claude Code** gets the ladder directly: SIGINT ends its turn.
- **Codex** gets `turn/interrupt` first (`method: 'protocol'`). If it does not finish the turn within the grace time, the ladder stops the app-server (`method: 'sigint'`), and the next message starts it again on the same thread (`thread/resume`).

The fixture processes for the tests are in `packages/agent/test/fixtures/procs/`.

## Not yet

- `agent.turnTimeoutS` (a per-turn timeout that calls `interrupt(reason: 'timeout')`).
- Waiting for an interrupt receipt advertised in `system/init`.
- Removing a stale `index.lock` after a git operation is killed.
