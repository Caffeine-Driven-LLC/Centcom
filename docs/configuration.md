# Configuration

Generated from `packages/config/src/schema.ts`. Do not edit by hand: run `pnpm exec tsx tools/docs/config-doc.ts > docs/configuration.md`.

## Where settings come from

From lowest to highest priority: **built-in defaults, your user file, the project file, environment variables, command-line flags.** A later layer overrides only the keys it sets. `/config` shows every setting in effect and which layer it came from.

| Layer | Location |
|---|---|
| User file | `$CENTCOM_CONFIG_DIR/config.json`, else `$XDG_CONFIG_HOME/centcom/config.json` (Linux, default `~/.config/centcom`), `~/Library/Application Support/centcom/config.json` (macOS), `%APPDATA%\centcom\config.json` (Windows) |
| Project file | `.centcom/config.json`, the nearest one from the working folder up to the git toplevel (never beyond it, at most 25 levels). Outside a git repo the search stops below your home folder, and a folder outside your home folder only looks at itself; the state folder's own `config.json` is never a project file |
| Environment | `CENTCOM_API_URL`, `CENTCOM_RELAY_URL`, `CENTCOM_LOG_LEVEL`, `CENTCOM_REDUCED_MOTION` (or the older `CENTCOM_REDUCE_MOTION`), `CENTCOM_TELEMETRY=on|off`, `DO_NOT_TRACK`, `NO_COLOR`, `CENTCOM_CONFIG_DIR`, `CENTCOM_STATE_DIR` |
| Flags | `--theme`, `--mascot`, `--cento-color`, `--model`, `--mode`, `--colors`, `--engine`, `--no-motion` (used for that run only, never written back) |

State that is not settings (saved conversations, prompt history, the web token) lives in `$CENTCOM_STATE_DIR`, default `~/.centcom`.

## Safety rules

- A **project file** may only set the keys marked "yes" below, so a cloned repository cannot redirect traffic, enable telemetry or loosen permissions. Other keys are ignored with a warning.
- Any key that looks like a credential (token, secret, password, api key, private) in any file makes Centcom ignore that file and warn, naming the key and never the value.
- `DO_NOT_TRACK` and `CENTCOM_TELEMETRY=off` always win over every file and flag.
- **Skip-permissions is never saved.** It can only be chosen on purpose each session (`--dangerously-skip-permissions`, `/mode bypass`, or the web menu). `client.permission_mode` only stores ask first, accept edits or plan.
- A config file that cannot be read, parsed or validated never stops Centcom: a bad project file is ignored, a bad user file falls back to the defaults, and a warning is shown. A user file that cannot be parsed is never overwritten.
- A project file that sets `client.model` produces a notice, since it can change what a session costs.
- Files are written atomically with mode 0600; a crash mid-write leaves the old file intact.

## What the client remembers for you

When you change them in the app, these are saved to your user file: theme, Cento size and color, reduced motion, model, permission mode (not skip-permissions), auto skills, the side and session panels, and your last agent. Prompt history is kept per project (200 entries). Saved conversations are described in the README.

## Keys

| Key | Values | Default | Project may set | Meaning |
|---|---|---|---|---|
| `api.base_url` | string | `"https://api.centcom.dev"` | no | Backend REST base URL |
| `relay.url` | string | `"wss://relay.centcom.dev/v1/ws"` | no | Hosted relay WebSocket URL |
| `net.timeout_ms` | number (1000 to 600000) | `15000` | no | Per-request network timeout |
| `net.max_attempts` | number (1 to 20) | `5` | no | Retry attempts for network calls |
| `budget.session_usd` | number (0 to 100000) | `0` | no | Warn when a session's reported cost passes 80 % and 100 % of this (0 = off). Only warns; nothing is stopped |
| `telemetry.enabled` | boolean | `false` | no | Anonymous usage reporting (off unless you turn it on) |
| `log.level` | debug \| info \| warn \| error \| silent | `"info"` | yes | How much to write to the log file |
| `log.max_file_bytes` | number (65536 to 268435456) | `5242880` | no | Rotate the log file at this size |
| `log.max_files` | number (1 to 20) | `3` | no | How many rotated log files to keep |
| `ui.theme` | auto \| dark \| light | `"auto"` | yes | Graphite (dark), Paper (light), or follow the system |
| `ui.mascot` | boolean | `true` | yes | Show Cento |
| `ui.mouse` | boolean | `true` | no | Scroll with the mouse wheel in the terminal app (off gives the terminal its own text selection back) |
| `ui.reduced_motion` | boolean | `false` | yes | Turn animation off |
| `ui.color` | auto \| truecolor \| 256 \| 16 \| never | `"auto"` | yes | Terminal color depth |
| `a11y.screen_reader` | boolean | `false` | no | Plain text for screen readers: no colour, no boxes, no animation, no redraws; one line per event. Same as --screen-reader or CENTO_SCREEN_READER=1 |
| `lan.enabled` | boolean | `true` | no | Allow LAN sessions |
| `agent.max_parallel` | number (1 to 16) | `4` | yes | Most agents running at once |
| `agent.approval_timeout_ms` | number (1000 to 86400000) | `600000` | yes | How long an approval waits before it is declined |
| `client.engine` | claude-code \| codex | `"claude-code"` | no | Last agent you used |
| `client.model` | string | `""` | yes | Model id passed to the agent (empty = the CLI default) |
| `client.permission_mode` | default \| acceptEdits \| plan | `"default"` | no | Permission mode at start. Skip-permissions can only be chosen on purpose, each time |
| `client.cento_color` | violet \| red \| yellow \| green \| brown | `"violet"` | yes | Cento's color |
| `client.mascot_size` | auto \| large \| small \| off | `"auto"` | yes | Cento size in the terminal |
| `client.auto_skills` | boolean | `true` | yes | Pick matching skills for each message |
| `client.side_panel` | boolean | `true` | no | Show the side panel in the web app |
| `client.fleet_panel` | boolean | `true` | no | Show the session panel in the terminal when others join |

