# Centcom

Command many hands. A terminal-first, multiplayer platform for running coding agents (it drives your own Claude Code and Codex CLIs; we never touch your login): several people and several agents in one workspace, over LAN or a hosted relay. Mascot: **Cento** the octopus.

> Status: **building.** The terminal app (with Cento), the Claude Code and Codex engines, real approvals, the local web app and auto skills work today. Multiplayer, accounts and the backend are still plans. See [Progress](#progress) and [`plan/`](plan/README.md).


<!-- progress:start -->

## Progress

![Progress](docs/progress.svg)

**29% built** (weighted by lane size across 105 lanes). Details and how this is computed: [`tools/plan/progress.py`](tools/plan/progress.py). Update [`plan/STATUS.json`](plan/STATUS.json) when you finish or advance a lane, then run `python3 tools/plan/progress.py`.

## Next steps

1. **Smoke-test the Codex adapter on a real turn** — it passes its tests against Codex's published protocol schema and the real handshake, but no real model turn has run yet (C103); this needs a fresh `codex login`
2. **C002 CI pipeline** — nothing runs typecheck/tests automatically yet; add the contract-lock check and `progress.py --check`
3. **C003 generate protocol types from `contracts/`** — event and message shapes are hand-typed today (C101, C102, C103 depend on this)
4. **C026 persist transcripts and resume sessions** — both engines already return resume tokens; restarting the app loses the conversation
5. **C017 git worktree manager, then C024 agent fleet** — unlocks the multi-agent story; the fleet panel is only fed demo agents right now
6. **C050 non-interactive mode (print / JSON)** — needed for scripting and for CI use
7. **C007 mock backend, then the M2 LAN lanes (C074, C054-C056, C071-C076)** — starts multiplayer; none of M2 exists yet
8. **Package the web launcher as a real desktop app** — "Start as app" opens a chromeless Chromium window (verified); a signed installable app (Electron or Tauri) is still to do

### Started, not finished

| Lane | What | Done | Note |
|---|---|--:|---|
| [C102](plan/client/C102.md) | Claude Code engine: drive the user’s own claude binary (stream-json, resume, approvals bridge) | 90% | claude stream-json, approvals bridge, resume token, interrupt; no version-range check |
| [C015](plan/client/C015.md) | Permission policy engine bridging engine approval requests | 85% | modes incl. dangerously-skip-permissions, session rules, real approval bridge; no persisted "always" rules |
| [C035](plan/client/C035.md) | Prompt input: multiline, history, paste, slash commands | 85% | multiline, history, paste, slash popup; no external editor |
| [C081](plan/client/C081.md) | Web app scaffold: Vite, React, router, theme | 85% | Vite + React local web app with launcher, workspace, polished UI; no router |
| [C101](plan/client/C101.md) | Engine abstraction: AgentEngine interface, capabilities and normalised event stream | 85% | AgentEngine + normalised events; not yet generated from contracts |
| [C016](plan/client/C016.md) | Command risk classification and sandbox settings passed to the engines | 80% | command risk classes; Codex sandbox/approval policy per mode |
| [C020](plan/client/C020.md) | Skills pack: install and manage Claude Code skills and Codex AGENTS.md guidance | 80% | auto skills + centcom-master (208 skills); no Codex AGENTS.md install |
| [C029](plan/client/C029.md) | Usage and cost display from engine reports | 80% | tokens, estimated cost, 5h/7d limits |

+19 more in [`plan/STATUS.json`](plan/STATUS.json).

### Ready to pick up (all dependencies done)

| Lane | What | Size | Milestone |
|---|---|---|---|
| [C043](plan/client/C043.md) | Task list and progress components | S | M1 |

Each lane card lists its goal, contracts, acceptance criteria and tests. Read [`plan/START_HERE.md`](plan/START_HERE.md) first.

<!-- progress:end -->

## What is in this repo

| Path | What |
|---|---|
| [`plan/`](plan/START_HERE.md) | The build plan (start with `plan/START_HERE.md` and `plan/ROADMAP.md`): 101 backend lanes + 105 client lanes, architecture, strict guidelines, integration gates |
| [`contracts/`](contracts/README.md) | Frozen connection points shared with the backend repo (REST, WebSocket, events, crypto, LAN, billing) |
| [`assets/DESIGN.md`](assets/DESIGN.md) | Design system: brand, mascot, colour, type, motion, components, voice, accessibility |
| [`assets/theme/`](assets/theme) | Abyss/Shallows theme: tokens, CSS, Tailwind preset, terminal themes, live preview |
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

Try `/demo fix`, `/demo search` and `/demo delete` in demo mode, `ctrl+k` for the palette, `/cento` for the 319-animation gallery, `?` for keys.
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
