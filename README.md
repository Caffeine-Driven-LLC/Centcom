# Centcom

<p align="left"><img src="assets/brand/icon.png" alt="Centcom: Cento the octopus with headphones" width="128" height="128"></p>

Command many hands. A terminal-first, multiplayer platform for running coding agents (it drives your own Claude Code and Codex CLIs; we never touch your login): several people and several agents in one workspace, over LAN or a hosted relay. Mascot: **Cento** the octopus.

> Status: **building.** The terminal app (with Cento), the Claude Code and Codex engines, real approvals, the local web app and auto skills work today. Multiplayer, accounts and the backend are still plans. See [Progress](#progress) and [`plan/`](plan/README.md).


<!-- progress:start -->

## Progress

![Progress](docs/progress.svg)

**82% built** (weighted by lane size across 105 lanes). Details and how this is computed: [`tools/plan/progress.py`](tools/plan/progress.py). Update [`plan/STATUS.json`](plan/STATUS.json) when you finish or advance a lane, then run `python3 tools/plan/progress.py`.

## Next steps

1. **Release signing and hosting** — the app already checks for updates on every start (C095), but no standalone update is accepted until the release signing keys, published artifacts and the /v1/releases endpoint exist
2. **Wire the new runtime pieces into the app** — permissions, memory, MCP, hooks, context, checkpoints, locks and the fleet are built and tested as libraries; the terminal and web app do not use most of them yet
3. **Finish the M1 terminal lanes** — C036 transcript view, C043 task list, C045 keybindings and help, C048 onboarding
4. **Multiplayer client against the mock backend** — M2 lanes (transport, relay client, crypto, sessions, queue, LAN) can be built and tested against the C007 mock backend before the real backend exists

### Started, not finished

| Lane | What | Done | Note |
|---|---|--:|---|
| [C008](plan/client/C008.md) | Test harness: vitest setup, pty and TUI snapshot tester, fixtures | 90% | test toolkit: defineCentcomConfig preset (80% floor proved by a failing fixture), network guard (loopback only) and console guard in the root vitest setup, fakeClock, seededRng (xoshiro128**), fixedIds, tmpDir, memFs, loadContractFixture, PtyHarness on Python pty with xterm headless screen and cells (no native add-on), renderInk with colour tiers, expectScreen snapshots, docs/testing.md; gaps: Windows pty, not every package opted into the preset yet, card says green at truecolor gives 38;2; but named colours stay basic ANSI so hex is used; tools/dev/pty-smoke.py: 10 real-terminal checks (alternate screen, kill, title, editor, job control, plain-text mode, idle cost) |
| [C012](plan/client/C012.md) | Release engineering skeleton: versioning, changesets, signing placeholders | 90% | Changesets fixed group, build metadata, Ed25519 signing over the SHA-256 digest, release manifest for 5 targets, dry-run release workflow, docs/releasing.md; publish steps are stubs until lanes C094/C068 |
| [C026](plan/client/C026.md) | Local transcript persistence and engine session resume | 90% | append-only redacted session log with header v2, flush cadence, segments, line cap, lock, index rebuild, retention, engine session map, resumeSession with fresh-with-summary fallback, toSnapshotEvents, app and CLI wired (-c, --resume [id] with picker), old saves migrated; gaps: session.retentionDays/persist config keys, pty-level CLI test |
| [C028](plan/client/C028.md) | Model selection through the engines | 90% | model registry (precedence, engine-reported list + aliases, 24 h cache keyed by engine version, turn-boundary switch with one model.changed, rejection keeps previous model), wired into /model and setModel; gaps: /model no-arg still opens the fixed picker, engines do not yet read models.aliases/--model through the registry at spawn; /model lists the models the Codex account reports; /effort offers each model's levels (Claude and Codex) |
| [C029](plan/client/C029.md) | Usage and cost display from engine reports | 90% | ledger (reported cost only, running-total deltas, agent minutes, budget alerts, outbox with cap and drop order), /usage, wired into the app; gap: ledger replay from the golden transcripts of real CLIs |
| [C034](plan/client/C034.md) | TUI shell: Ink app skeleton, layout, resize | 90% | Shell frame (header/scrollback/toast/prompt/footer, 100-col rail, overlay, too-small state), renderApp with debounced resize, alt-screen guard for exit/SIGINT/SIGTERM/uncaught error, action registry with focus stack, grapheme-aware text helpers; gaps: App.tsx not moved onto the Shell, --no-alt-screen/config not wired, no lint rule for raw Text; resize repaints the whole frame, small-terminal layouts (pickers, help, overlays), width tests, tab title and terminal restore on every exit path |
| [C038](plan/client/C038.md) | Permission prompt UI | 90% | ApprovalView from either engine or a shared session, key state machine (scopes, edit only when editable, 300 ms grace, y+Enter for risky, expiry deny), PermissionPrompt box (min(cols-2,78), heavy border for destructive, command cap, visible escapes, waiting-for-host text), queue ordering helper; gap: app still uses components/Approval.tsx, queue host and view-all screen not built; approval buttons with clicks, countdown, narrow labels, grace period against stray keys |
| [C041](plan/client/C041.md) | Command palette | 90% | palette core: DP fuzzy matcher with indices, engine (debounce, abort, slow-provider append, fixed group order, recent), list and file providers (git ls-files or walk, 20k cap, sliced scoring), view and live component (60/cols-4 wide, 8 rows + more row, wrap-around keys), palette.* actions; gap: the app still shows its older palette, sessions/skills providers not wired; palette with ranking and click, entries from the command list; /settings and pickers on one picker model |

+68 more in [`plan/STATUS.json`](plan/STATUS.json).

### Ready to pick up (all dependencies done)

| Lane | What | Size | Milestone |
|---|---|---|---|

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
Flags: `--mode plan|acceptEdits`, `--mascot large|small|off`, `--cento-color red|yellow|green|brown`, `--theme light|hc`, `--colors 256|16|never`, `--no-motion`, `--screen-reader` (plain lines for a screen reader). A mistyped option is a one-line error, not a silent no-op.

The terminal app in short: shift+arrows jump and select words, `ctrl+c` copies, the mouse wheel and clicks work (`/mouse off` for your terminal's own selection), `@` mentions a project file, `ctrl+k` searches commands, files, conversations and skills, `ctrl+r` your earlier messages, `/settings` shows every setting, `/find`, `/copy` and `/export` take things with you, and most commands open a list when you give them no value. Everything is in [docs/site/guide/terminal-app.md](docs/site/guide/terminal-app.md).

![welcome](docs/screens/welcome.png)
![approval](docs/screens/approval.png)

**Auto skills:** before each prompt Centcom matches your installed skills and commands (`~/.claude/skills`, plugins, `.claude/skills`, `.claude/commands`) against it locally, shows what it picked, and tells Claude to apply them. `/auto on|off`, `/skills [filter]`.

**The `centcom` command:** `pnpm onboard` (checks Node/pnpm/git, installs, links the command, reports which agents it found; `sh tools/dev/onboard.sh --check` only reports) or `pnpm install && pnpm install:cli` once, then run `centcom` in any folder to start the terminal app there, the way you start `claude` (`centcom --engine codex`, `centcom --help`). It runs from this checkout, so `git pull` is an update.

**Night cycle:** `ctrl+n` (or `/night`) opens a queue: write many tasks, press Enter on an empty line, and the agent works through them while you sleep, never asking you anything. Questions are answered "decide yourself"; high-risk actions and anything that pushes, publishes or deploys are refused; a morning report is written to `~/.centcom/night/`. See [`docs/night-cycle.md`](docs/night-cycle.md).

**Skill library:** seven skills ship with Centcom in `packages/skills/library` (design, frontend, backend, security, database, marketing, code-review): each a `SKILL.md` plus `references/` the agent reads only when the task needs that depth, and a few stdlib-only helper scripts. They are matched like any other skill, the agent is pointed at the file, and your own project skills of the same name win. See `packages/skills/library/README.md`.

**centcom-master:** `pnpm skills:sync` fetches the curated catalog in `packages/skills/catalog.tsv` (245 rows from ~70 repos) into `~/.centcom/master`: text files only (scripts are left out), pinned to a commit, scanned for prompt-injection and obfuscation, and exposed as one router skill with an index. Per prompt the matcher injects only the best 1 to 3 (by file path), never the whole bundle. Trusted publishers are on by default; overlapping, hook-dependent and unknown-publisher skills are off. `/skills enable <id>` and `/skills disable <id>` change that.

`tools/dev/shot.py` runs the app in a pseudo-terminal and saves a screenshot (needs `pip install pyte pillow`). Checks: `pnpm typecheck && pnpm test`.

## Desktop app

```sh
pnpm app          # builds the app and opens it as a desktop window (Electron)
pnpm web:dev      # the same screens in a browser tab, for development
```

The desktop app (`apps/desktop`, screens in `apps/web`) is a window around the Centcom screens: sign in, workspaces, sessions, the fleet board, billing and settings. It opens `centcom://` links, keeps the page sandboxed, and sends outside links to your browser. Electron's binary needs one extra step the first time: see [`apps/desktop/README.md`](apps/desktop/README.md). The terminal app (`pnpm centcom`) is where agents run today.

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
