# MCP servers

MCP servers give Claude Code and Codex extra tools. Centcom helps you add and remove them in each tool's own config file, and shows what each tool says about them. It does not run the servers and it never stores a secret.

```
centcom mcp list [--scope project|user]
centcom mcp add <name> (--cmd <program> [--arg <a>]... | --url <https-url> [--transport http|sse])
                [--env-ref NAME=VARIABLE]... [--header-ref Header=VARIABLE]...
                [--engine claude|codex|both] [--scope project|user] [--yes]
centcom mcp remove <name> [--engine ...] [--scope ...] [--yes]
centcom mcp status
centcom mcp test <name> [--engine claude|codex]
```

## Where it writes

| Tool | Project (default) | User |
|---|---|---|
| Claude Code | `<project>/.mcp.json` (`mcpServers`) | not edited: Claude keeps those in a file that also holds your sign-in details; use `claude mcp add --scope user` |
| Codex | `<project>/.codex/config.toml` | `~/.codex/config.toml` |

Only the MCP part is touched. In `.mcp.json` every other key and its order is kept, with the file's own indentation. In `config.toml` only `[mcp_servers.<name>]` tables (and their sub-tables) are edited; every other line stays byte for byte. A file that is not valid is never edited (the error says the line and column).

## Safe by construction

- **Diff, then confirm.** Every change is a plan with a diff. Nothing is written until you confirm that exact plan (a changed file or a different plan is refused), and the old file is kept as `<file>.<time>.centcom-bak`. Changing your user-level settings needs a second confirmation.
- **A program on your machine.** A `.mcp.json` entry makes Claude Code start that command. The diff says so ("runs a program on your machine") before you confirm.
- **No secrets.** Only the names of environment variables are written: `env` gets `${GITHUB_TOKEN}`, an `Authorization` header gets `Bearer ${TOKEN}`; Codex gets `env_vars` and `bearer_token_env_var`. A value that looks like a password or key (the contract's patterns plus GitHub, Slack, Stripe, npm and GitLab tokens, private key blocks, `user:password@` in a URL, or a token pasted where a variable name belongs) is refused, and the message never repeats it. Settings whose name looks secret (`*_TOKEN`, `*_KEY`, `*SECRET*`, `PASSWORD`) must use a reference.
- **URLs** must be `https`, or `http` to this computer (`127.0.0.1`, `localhost`, `[::1]`).
- Names are lowercase letters, digits, `-` and `_`, starting with a letter, 32 at most.
- **`centcom-approvals`** is Centcom's own approvals server. It is listed as built in and locked, and can never be added, edited, removed or written to a file.

## Status

`status` shows each tool's own view of each server: `connected`, `needs_auth`, `failed`, `pending`, `disabled` or `unknown`, with the tool's error text as it gave it. It comes from the tool when a session starts, so it is shown inside a running session; without one it says "not reported". A tool that never reports MCP status still lets you edit its config.

## Testing a server

`mcp test` checks that the program exists on `PATH` (it is only looked up, never run by Centcom) or that the URL is allowed, then asks the tool to start a throw-away session with only that server and reports what the tool says; 30 seconds at most, then the session is stopped. **Starting that session needs the engine adapters (C102/C103); until they provide it, `centcom mcp test` reports `session_failed` for servers that pass the first checks.**

## Notes

- Codex's key names (`env_vars`, `bearer_token_env_var`, `env_http_headers`, project-level `.codex/config.toml`) follow its documentation and must be checked against the installed version before release; the tested range will be recorded here.
- Codex has no `sse` transport and can only pass an environment variable on under its own name; both are refused rather than approximated.
