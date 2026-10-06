# Providers: Claude Code and Codex

Centcom drives the command-line tools you install yourself. It never sees your login: signing in and out are the vendors' own commands, run in your terminal.

```
centcom provider status [claude|codex] [--json] [--refresh] [--policy]
centcom provider login  <claude|codex> [--console]
centcom provider logout <claude|codex> [--yes]
centcom provider doctor [--json]
```

`status` prints one short line per tool, for example `claude-code  installed 2.1.0 (supported)  signed in (subscription)`. Exit code 0 when all is well, 1 for warnings (a tool missing, not signed in, or a version outside the checked range), 2 when you named a tool and it is not installed.

## How Centcom finds out

It asks the tools themselves, with a 5 second limit per question and 15 seconds in all, and keeps the answer for 30 seconds (`--refresh` asks again):

| Question | Claude Code | Codex |
|---|---|---|
| installed? | looks on `PATH` (or `CENTCOM_CLAUDE_BIN`) | looks on `PATH` (or `CENTCOM_CODEX_BIN`) |
| version | `claude --version` | `codex --version` |
| signed in, and how | `claude auth status` (JSON, only `authMethod` is read), when `claude auth --help` works; otherwise "checked when the first agent starts" | `codex login status` (its own words: ChatGPT, API key, ...) |

`claude.ai` / ChatGPT is a **subscription**, an API key is **api_key**, Bedrock / Vertex / Foundry is **cloud**. Anything Centcom cannot tell counts as a subscription, the careful default.

Supported versions are placeholders (`claude-code >=2.0.0 <3.0.0`, `codex >=0.40.0 <1.0.0`) until the engine lanes record real runs.

## What it never does

- Read, open or even stat any file of the tools: no `~/.claude*`, `~/.codex*`, `auth.json`, keychain. The only filesystem calls are `stat` on the directories of `PATH`.
- Read your provider API-key environment variables to guess how you are signed in.
- Capture, drive or screen-scrape a login. `login` and `logout` run the vendor's own command with your terminal handed over (`stdio: inherit`, no shell). Without a terminal they refuse and print the command to run yourself.
- Run a probe that costs money or plan quota (no test prompts).
- Print a secret: every string that leaves the module goes through the contract's secret patterns and is replaced by `[redacted:<pattern>]`.

## Errors

Each of the nine provider errors has one calm message and a next step (`providerMessage`), in the tool's own words quoted underneath when there are any. Install hints depend on your system and are text only: Centcom never installs anything.

## Doctor

`centcom provider doctor` runs: the tool is installed, its version is supported, it is signed in (for each), the bundled provider policy is not older than 180 days, and a scan of the last 500 KiB of Centcom's own logs for credential-shaped strings (any hit is a failure and names the pattern, never the text). A missing tool is a warning, not a failure.

## For other lanes

`registerStatusSection({ id, render, json })` lets the who-pays lane (C105) add its section to `status --policy`. `providerDoctorChecks` is the list the general `doctor` command (C097) will register.
