# Permissions

One engine decides what an agent may do, whichever tool (Claude Code or Codex) is behind it. It receives the normalised approval request, checks the rules and the mode, and either answers, or asks a person. The default is to ask; anything that goes wrong is a "no".

## Order of decisions

1. **Hard denies** (no rule, mode or answer can change them): a write outside the agent's worktree (checked after resolving symlinks and `..`, on Windows case-insensitively), a write into `.git` internals, any use of a credential location (`~/.ssh`, `~/.aws`, `~/.codex`, `~/.claude*`, `.netrc`, `auth.json`, keychain files), and anything from a stopped agent. Shell commands are read for the paths they write to (`>`, `rm`, `mv`, `cp`, `tee`, `sed -i`, `dd of=` ...). Only the request's path is examined; no file is ever read.
2. **Rules**: an explicit **deny** beats **ask**, which beats **allow**; inside a class the most specific rule is the one named. Deny and ask rules look at every part of a compound command (`a; b`, `a | b`); an allow rule only ever matches a simple command, so `git status; rm -rf x` is never allowed by `git status:*`.
3. **Mode** (when no rule applies):

| Mode | Read in the folder | Edit in the folder | Shell | Other tools |
|---|---|---|---|---|
| `ask` (default) | allow | ask | ask | ask |
| `accept-edits` | allow | allow | ask | ask |
| `plan` | allow | **deny** (`plan_mode`) | **deny** | ask |
| `auto-low-risk` | allow if risk is low, otherwise ask | same | same | same |
| `bypass` | allow (needs the opt-in `permissions.bypass`; without it, `ask`) | | | |

A tool or engine Centcom does not know is always `ask`.

## Asking

A request that needs a person is sent to the prompter (the TUI or web app) and, in a shared session, may be answered by the host or an allowed approver (`host`, `owner` or `any_editor`, or a delegated approver). The first answer wins. With nobody answering it is denied after 10 minutes. Without a prompter in headless mode it is denied at once. If the engine disconnects its pending approvals are cancelled and audited.

The wire form (`approvalToWire`) has only ids, risk, expiry and the approver policy in the clear; the command and folder are in the encrypted part.

## "Always" and "this session"

Approving with scope *always* writes a conservative rule: for a shell command the words up to the first flag (`git status:*`, never `*`, nothing for a compound command); for an edit, the folder of the file inside the worktree (`src/lib/**`). Scope *session* adds the same rule in memory only.

## Where rules live

- session: in memory
- project: `<folder>/.centcom/permissions.local.json` (excluded from git). It is only loaded if the file's SHA-256 is trusted; rules Centcom wrote itself are trusted at once, anything else shows up in `needsTrust`.
- user: `<config dir>/permissions.json`

Files are written atomically with mode 0600. A file that cannot be read or does not match the schema is ignored whole, with a warning, so it can only ever mean fewer allowed things.

## Passing rules to the tools

`parseClaudeRule` / `formatClaudeRule` read and print Claude's style (`Bash(git status:*)`, `Read(src/**)`, `mcp__server__tool`); `toClaudeArgs` gives `--allowedTools` / `--disallowedTools`. Codex only has a sandbox level and an approval policy: `toCodexArgs` picks them from the mode and lists in `translationNotes` everything it could not express (deny rules, path and command limits). Centcom's own broker still enforces those when the tool asks.

## Known limits

- `decide` is asynchronous (resolving symlinks needs the file system); the card showed it as synchronous.
- Shell reading is deliberately simple. Anything it cannot understand is "not simple": it is never allowed by a rule and asks.
- The risk classifier (C016) is optional until that lane exists; the engine's own risk, or `medium`, is used.
