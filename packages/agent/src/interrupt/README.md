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

- **Claude Code** is asked first, by the protocol: the turn runs with `--input-format stream-json`, and when `system/init` lists `interrupt_receipt_v1` the engine writes a `control_request` with the subtype `interrupt`. The CLI answers with a `control_response` (the receipt), then the turn's `result`, and the engine ends stdin so the process leaves by itself (`method: 'protocol'`, `receipt: true`, no signal sent). The turn ends as `canceled`, not as an error. If the CLI does not list the capability, does not answer within the grace time, or the stop is `hard`, the ladder runs: SIGINT ends its turn (`receipt: false`). Checked against the real `claude` 2.1.289 with `tools/dev/claude-interrupt-live.ts`.
- **Codex** gets `turn/interrupt` first (`method: 'protocol'`). If it does not finish the turn within the grace time, the ladder stops the app-server (`method: 'sigint'`), and the next message starts it again on the same thread (`thread/resume`).

The fixture processes for the tests are in `packages/agent/test/fixtures/procs/`.

## Per-turn limit

`agent.turn_timeout_s` (0 = off) stops a turn that runs too long: the app calls `interrupt(reason: 'timeout')` and tells the person which setting to change. In print mode `--timeout` does the same with exit code 124.

## A leftover git lock

A killed `git add` can leave `index.lock` behind, and every later git command in the folder then refuses to run. After the engine's processes are gone, `removeStaleIndexLock` (`lock.ts`) removes that one file, and only when all of this holds: it is a regular file in the folder git itself names (`git rev-parse --git-path index.lock`, so a linked worktree's own folder is found); it was made during the stopped turn (not older than the turn start, so a lock held by something the person started is never touched); no process Centcom registered for the agent is alive; and it did not change during a 300 ms settle time. Otherwise the file stays and the result says why. The app tells the person when it removed one. A link or a folder with that name is never removed.

## Not yet

- The Codex path has no protocol-level receipt beyond the `turn/interrupt` answer.
- The lock rule looks at the agent's registered processes only; a git process the agent's tool started in a different process group would be seen as gone.
