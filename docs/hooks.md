# Hooks

Claude Code can run your own commands at set moments (before or after a tool call, when it stops, when it needs your attention). These are *hooks*, and they live in Claude Code's settings files. Centcom shows them, checks them and edits them safely. **Centcom never runs a hook**: the engine does, and the hook is ordinary code on your machine.

## Where they live

| Scope | File | Shared? |
|---|---|---|
| project | `<repo>/.claude/settings.json` | yes, committed to git |
| local | `<repo>/.claude/settings.local.json` | no, personal |
| user | `~/.claude/settings.json` | every project (asks for an extra confirmation) |

Only the `hooks` part of a file is ever touched. Everything else (permissions, environment, anything the tool adds later) stays **byte for byte** as it was: Centcom patches the one place in the text and does not rewrite the file. If a file is not valid JSON or is over 1 MiB, nothing is edited.

## Commands

```
centcom hooks list [--scope project|local|user]
centcom hooks add --template <id> [--choice name=value] [--scope ...] [--yes]
centcom hooks add --event Stop --cmd "echo done" [--matcher Edit|Write] [--timeout 30]
centcom hooks remove --event Stop --index 0
centcom hooks validate
centcom hooks templates
```

## Safe edits

1. `plan` builds the new file and a diff. **Every command is shown in full.**
2. You confirm (user scope: a second time). The confirmation is tied to a hash of the exact plan, so a changed file or a different plan is refused and nothing is written.
3. The old file is copied to `<file>.centcom-bak.<yyyymmddHHMMSS>` (the five newest are kept), then the new one is written atomically.

A command that looks like it contains a password or key is refused without being shown or stored. Put secrets in environment variables.

## Checks

Events Centcom knows: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`. Limits: 8 hooks per event, a command is at most 1,024 characters, a timeout is 1 to 600 seconds, a matcher is a short regular expression such as `Edit|Write`.

| Issue | Meaning |
|---|---|
| `unknown_event` | not an event Centcom knows. It is **kept** and never deleted; new hooks cannot be added to it |
| `too_many` | a ninth hook for one event: refused |
| `too_long`, `bad_timeout`, `bad_matcher` | refused |
| `command_not_found` | the program is not on your PATH (a lookup, nothing is run); a warning |

`list` also marks hooks in the **shared project file** as "review before running" when you have not confirmed them here yet, or when the `hooks` part changed since you last did (for example after a `git pull`).

## Templates

`notify-on-approval`, `run-formatter-after-edit` (prettier, gofmt or black from a fixed list), `block-force-push` (the whole checker is one visible shell line; exit code 2 blocks the call), `log-session-stop`. None calls the network. The formatter and force-push templates use `jq`.

## One run only

`sessionSettingsArg(defs)` builds the JSON for Claude Code's `--settings` option with just the chosen hooks, for a single session. No file is written.

## Codex

The installed Codex documents no hook settings that Centcom can edit, so the Codex side says so and offers nothing. (Editing a documented `notify` setting is a follow-up for when a version documents it.)

## Not here

Running hooks, timeouts and exit-code handling are the engine's. The permission engine is separate (it does not read these files).
