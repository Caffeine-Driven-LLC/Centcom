# Agent runner

The runner (`createRunner`, in `@centcom/agent`) hosts several engine sessions (Claude Code, Codex) at once. It owns no model code and no credentials: engines do the talking, the runner supervises them.

## What it guarantees

- **Isolation.** One supervisor per agent; a crash, hang or flood in one never blocks another. Buffers are bounded (ring of 1000 events per agent; readers only ever lose deltas, never approvals or lifecycle events).
- **Limits.** `max_parallel` 4 (hard cap 16, refused at once with `RunnerBusy`), 20 queued prompts per agent, one agent per folder unless `allowSharedCwd`, 30 s to start, 30 min of silence ends a turn (`watchdog_timeout`).
- **Stopping.** `interrupt()` asks the engine; if the turn does not end in 5 s the engine gets SIGTERM, 2 s later SIGKILL, and the agent ends `canceled`. `stopAll()` runs these in parallel and takes at most 7 s.
- **Crashes.** `agent:exited{outcome:'crash'}` with exit code or signal, pending approvals denied. With `restart: 'on-crash'` it restarts after 1 s and 4 s reusing the resume token, and gives up on the third crash.
- **Environment.** Children get `PATH HOME USER LANG LC_* TERM TMPDIR proxy and CA variables XDG_*`, the provider variables the user already has (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...) passed through unread, and `CENTCOM_AGENT_ID`. Everything else (including every other `CENTCOM_*`, `GITHUB_TOKEN`, `AWS_*`) is dropped.
- **Logging.** Ids, engine, outcome, counts only; never prompts, text, folders or model names.
- **Bus events.** `agent:started`, `agent:event {agent_id, seq, event}` (gap-free `seq`), `agent:exited`, plus `agent:approval_needed` / `agent:approval_resolved`.

## The daemon

`centcom-runnerd [--socket <path>] [--idle-exit-s 60]` serves the runner over a Unix socket (`$XDG_RUNTIME_DIR/centcom/runner.sock`, folder 0700, socket 0600). It is optional: the CLI can embed the runner in-process.

- A second daemon on a live socket prints `already running` and exits 1; a socket nobody answers on is replaced.
- Frames are newline-delimited JSON, at most 1 MiB: `{v:1,id,cmd,args}` -> `{v:1,id,ok,result|error:{code}}`, plus pushed `{v:1,evt}`.
- The first frame must be `hello` with the per-run secret (written to `runner.secret`, 0600). A wrong secret gets `unauthorized` and is disconnected.
- Commands: `start send interrupt stop list subscribe approve shutdown`. A client that disconnects leaves its agents running; a new client replays the ring with `subscribe`.
- With no agents and no clients the daemon exits after `--idle-exit-s`.
- Windows named pipes are not implemented yet (Unix sockets only).

## Trust store

`FileTrustStore` (`<config dir>/trust.json`): which MCP servers, hook scripts and project rule files the user approved, by SHA-256. Atomic writes, mode 0600, a damaged file is kept as `trust.json.corrupt` and treated as empty.

## Known gaps

- Claude Code runs one process per turn, so killing it fails that turn instead of crashing the agent; only engines with a long-lived process (Codex) set `exited`.
- Windows named pipe, and the `provider.*` kill switch is an injected function until C105 exists.
