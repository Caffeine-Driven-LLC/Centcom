# Centcom

<p align="left"><img src="assets/brand/icon.png" alt="Centcom: Cento the octopus with headphones" width="128" height="128"></p>

Command many hands. A terminal-first, multiplayer platform for running coding agents (it drives your own Claude Code and Codex CLIs; we never touch your login): several people and several agents in one workspace, over LAN or a hosted relay. Mascot: **Cento** the octopus.

> Status: **building.** The terminal app (with Cento), the Claude Code and Codex engines, real approvals, the local web app and auto skills work today. Multiplayer, accounts and the backend are still plans. See [Progress](#progress) and [`plan/`](plan/README.md).


<!-- progress:start -->

## Progress

![Progress](docs/progress.svg)

**42% built** (weighted by lane size across 105 lanes). Details and how this is computed: [`tools/plan/progress.py`](tools/plan/progress.py). Update [`plan/STATUS.json`](plan/STATUS.json) when you finish or advance a lane, then run `python3 tools/plan/progress.py`.

## Next steps

1. **Verify the Codex adapter on a real Codex** — it is tested against Codex's published protocol and a faithful fake, but no real turn has run (C103). On a computer with Codex: follow docs/codex-verification.md (recorder: tools/codex/record.ts)
2. **Wire the new runtime pieces into the app** — permissions, memory, MCP, hooks, context, checkpoints, locks and the fleet are built and tested as libraries; the terminal and web app do not use most of them yet
3. **Finish the M1 terminal lanes** — C036 transcript view, C043 task list, C045 keybindings and help, C048 onboarding
4. **Multiplayer client against the mock backend** — M2 lanes (transport, relay client, crypto, sessions, queue, LAN) can be built and tested against the C007 mock backend before the real backend exists

### Started, not finished

| Lane | What | Done | Note |
|---|---|--:|---|
| [C012](plan/client/C012.md) | Release engineering skeleton: versioning, changesets, signing placeholders | 90% | Changesets fixed group, build metadata, Ed25519 signing over the SHA-256 digest, release manifest for 5 targets, dry-run release workflow, docs/releasing.md; publish steps are stubs until lanes C094/C068 |
| [C026](plan/client/C026.md) | Local transcript persistence and engine session resume | 90% | append-only redacted session log with header v2, flush cadence, segments, line cap, lock, index rebuild, retention, engine session map, resumeSession with fresh-with-summary fallback, toSnapshotEvents, app and CLI wired (-c, --resume [id] with picker), old saves migrated; gaps: session.retentionDays/persist config keys, pty-level CLI test |
| [C029](plan/client/C029.md) | Usage and cost display from engine reports | 90% | ledger (reported cost only, running-total deltas, agent minutes, budget alerts, outbox with cap and drop order), /usage, wired into the app; gap: ledger replay from the golden transcripts of real CLIs |
| [C051](plan/client/C051.md) | HTTP API client generated from OpenAPI | 90% | HTTP client in @centcom/net: operation table generated from openapi.yaml with a CI drift check; typed call, listPage, paginate, revalidate, getStatus, getJwks; CT-ERR retries with full jitter and a 60 s sleep budget, idempotency keys, single-flight 401 refresh, ETag and If-Match, size guard, tolerant response checks, typed errors; all 93 operations pass against the mock. Gaps: responses are checked with generated shapes (types and required fields), not the C003 Ajv validators; no lane uses the client yet |
| [C013](plan/client/C013.md) | Agent runner daemon hosting AgentEngine processes (claude, codex) | 85% | runner and runnerd; gaps: windows pipe, preflight wiring, runnerd logs, daemon-level tests |
| [C014](plan/client/C014.md) | Agent session state machine emitting contract state names | 85% | state machine and emitter; gaps: not wired into the app, golden transcripts from real parsers, combined property test |
| [C030](plan/client/C030.md) | Interrupt and cancel semantics | 85% | interrupt controller, 3 s/8 s signal ladder to whole process groups, registered pids only, Codex protocol-then-ladder with restart on the same thread, approvals denied and late ones refused, partial answer kept, ctrl+c semantics with exit 130 in the app and -p; gaps: turn timeout, interrupt receipt, stale index.lock cleanup |
| [C104](plan/client/C104.md) | Provider detection and login handoff: provider status, login, logout, doctor checks | 85% | provider detection and commands; gaps: message copy, runtime fs spy, CLI-level hang test, app still uses old detectors |

+31 more in [`plan/STATUS.json`](plan/STATUS.json).

### Ready to pick up (all dependencies done)

| Lane | What | Size | Milestone |
|---|---|---|---|
| [C071](plan/client/C071.md) | LAN discovery over mDNS | M | M2 |
| [C054](plan/client/C054.md) | Relay WebSocket client: handshake, envelope, heartbeat | L | M2 |
| [C096](plan/client/C096.md) | Documentation site, README, man pages, built-in help | M | M6 |

Each lane card lists its goal, contracts, acceptance criteria and tests. Read [`plan/START_HERE.md`](plan/START_HERE.md) first.

<!-- progress:end -->

## What is in this repo

| Path | What |
|---|---|
| [`plan/`](plan/START_HERE.md) | The build plan (start with `plan/START_HERE.md` and `plan/ROADMAP.md`): 101 backend lanes + 105 client lanes, architecture, strict guidelines, integration gates |
| [`contracts/`](contracts/README.md) | Frozen connection points shared with the backend repo (REST, WebSocket, events, crypto, LAN, billing) |
| [`assets/DESIGN.md`](assets/DESIGN.md) | Design system: brand, mascot, colour, type, motion, components, voice, accessibility |
| [`assets/theme/`](assets/theme) | Graphite/Paper theme: tokens, CSS, Tailwind preset, terminal themes, live preview |
| [`assets/mascot/`](assets/mascot) | Cento: 319 animations, 5 colours, crowds, gallery, terminal player |
| [`assets/The-Lines.txt`](assets/The-Lines.txt) | 743 spinner lines |
| `tools/plan/` | Plan, contract and lock tooling |

The server lives in the private repo `Caffeine-Driven-LLC/Centcom-backend`; both repos carry identical `contracts/`, `plan/` and `tools/plan/`.

## Run the terminal app

```sh
pnpm install
pnpm dev                 # scripted demo agent, no login needed
pnpm centcom             # drives your own Claude Code (must be installed and signed in)
```

Approvals work with real Claude Code: Centcom runs `claude` with `--permission-mode manual` and a tiny MCP tool (`--permission-prompt-tool`) that asks the app over a private local socket, so the dialog with the diff appears for every Write/Edit/Bash that needs one. If the app is unreachable the answer is always deny.

Try `/demo fix`, `/demo search` and `/demo delete` in demo mode (add `--demo-team` to preview teammates), `ctrl+k` for the palette, `/cento` for the 319-animation gallery, `?` for keys.
Flags: `--mode plan|acceptEdits`, `--mascot large|small|off`, `--cento-color red|yellow|green|brown`, `--theme light`, `--colors 256|16|never`, `--no-motion`.

![welcome](docs/screens/welcome.png)
![approval](docs/screens/approval.png)

**Auto skills:** before each prompt Centcom matches your installed skills and commands (`~/.claude/skills`, plugins, `.claude/skills`, `.claude/commands`) against it locally, shows what it picked, and tells Claude to apply them. `/auto on|off`, `/skills [filter]`.

**centcom-master:** `pnpm skills:sync` fetches the curated catalog in `packages/skills/catalog.tsv` (245 rows from ~70 repos) into `~/.centcom/master`: text files only (scripts are left out), pinned to a commit, scanned for prompt-injection and obfuscation, and exposed as one router skill with an index. Per prompt the matcher injects only the best 1 to 3 (by file path), never the whole bundle. Trusted publishers are on by default; overlapping, hook-dependent and unknown-publisher skills are off. `/skills enable <id>` and `/skills disable <id>` change that.

`tools/dev/shot.py` runs the app in a pseudo-terminal and saves a screenshot (needs `pip install pyte pillow`). Checks: `pnpm typecheck && pnpm test`.

## Web UI and desktop app

```sh
pnpm web          # builds the client, starts http://127.0.0.1:58008 and opens the launcher
pnpm web:app      # same, but opens it as a chromeless app window
```

The launcher lets you pick a project folder, then **Start on web** (a browser tab) or **Start as app** (a window with no browser chrome, own profile). Both show the same workspace and share the same running agent. The server listens on 127.0.0.1 only, checks Host and Origin, and needs the token in `~/.centcom/token` (the first visit sets a cookie).

## Scripting and saved conversations

```sh
centcom -p "summarise this repo"                   # run once, print the answer, exit
cat error.log | centcom -p "what went wrong?"      # piped text is added to the prompt
centcom -p "..." --output-format json              # result, usage, cost, session id as one JSON object
centcom -c                                         # continue the last conversation in this folder
centcom --resume ses_...                           # continue a specific one (list them with /resume)
```

Conversations are saved to `~/.centcom/sessions` (private files) and resumed through the agent's own session, so it remembers what was said. `/new` starts fresh and keeps the old one. Print mode declines anything that needs an approval and says so (exit code 3); allow it with `--mode acceptEdits` or `--dangerously-skip-permissions`. Exit codes: 0 done, 1 error, 2 bad usage, 3 an action was declined. Turn saving off with `--no-save`.

## Remembered settings

Centcom remembers what you choose: theme, Cento's size and color, model, permission mode, auto skills, the side panel, your last agent and your prompt history (per project). Settings come from five layers (defaults, your user file, a project file, environment, flags); `/config` shows each value and where it came from. A project file can't change anything risky, credentials in config files are refused, and skip-permissions is never saved. Details: [`docs/configuration.md`](docs/configuration.md).

## Try the mascot

```bash
cd assets/mascot
python3 play.py --tour                 # every animation in your terminal (true-colour terminal)
python3 play.py typing --color red     # one animation, any of 5 colours
xdg-open gallery.html                  # browse, recolour, tile into crowds
```

All generated GIFs (5 colours + duo/trio/squad/group crowds) are committed under `assets/mascot/gif/`; regenerate with `python3 assets/mascot/build.py`.

## Check the plan and contracts

```bash
python3 tools/plan/validate_contracts.py
python3 tools/plan/validate_plan.py
python3 tools/plan/lock.py --check
```
