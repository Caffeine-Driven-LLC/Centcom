# Command classification

Centcom builds no sandbox. Before an agent runs something, Centcom reads the request and gives it a risk (`low`, `medium`, `high`) so the approval prompt and the rules can use it, and it passes the right permission and sandbox flags to Claude Code or Codex, which do the real enforcing.

Nothing here runs a command, reads a file, or touches the network: the shell text is read by a small parser and judged by name, arguments and path.

## How a command is read

The parser splits on `;` `&&` `||` `|` `&` and newlines, and understands quotes, escapes, `VAR=x` prefixes, redirections, `$(...)`, backticks, `<(...)`, heredocs, `eval`, `source`, and `sh -c` / `bash -c` (read again inside, up to depth 4). Windows commands are read the same way with `\` treated as a path separator.

The overall risk is the highest of all parts. **Anything it cannot read is `high`** (reason `unparseable`): an unterminated quote, a NUL byte, text that is not valid UTF-8, a command over 64 KiB, nesting deeper than 4, a fork bomb, a command whose name comes from a variable (`$CMD`).

## Levels

| Level | Examples |
|---|---|
| low | `ls`, `cat`, `head`, `wc`, `echo`, `git status/diff/log/show`, `rg`, `grep`, `find` (without `-exec`/`-delete`), version checks, read-only `docker ps`, `npm ls` |
| medium | writes inside the root, installs, `git add/commit/checkout/merge`, build and test runners, `curl` or `wget` to a file, `rm` inside the root |
| high | `rm -rf` of anything wide, `dd`, `mkfs`, `chmod -R`, `git push --force`, `git reset --hard`, `git clean`, `sudo`/`su`, `curl ... \| sh` (or any pipe into a shell or interpreter), writes outside the root or to a protected path, reads of credentials, uploads, `ssh`/`scp`, shutdown, package publishing, container `run`/`exec`, destructive SQL, cloud deletes, encoded or dynamic commands |

## Facts and destructive commands

Each result carries `facts` (`writes`, `deletes`, `network`, `escapesRoot`, `isTest`, `destructive`) and `autoAllowable`. A destructive command (`rm -r`, force-push, `reset --hard`, `clean`, `dd`, `mkfs`, destructive SQL, ...) is **never** auto-allowable, whatever the risk and whatever the configuration. High is never auto-allowable either. User rules act later (in the permission engine) and can never lower the risk.

`reasons` are rule ids such as `git_force_push` or `writes_outside_root`: never the command, a path or an argument, because they reach logs.

## Protected paths

A write is always `high`, and a read of a credential place is `high`, for: `.git/`, `.env*`, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.claude*`, `~/.codex/*`, shell start-up files, `.centcom/`, `.github/workflows/`, and machine secrets such as `/etc/shadow`. Reading `.env.example` is fine. Paths are resolved against the root as text (`..` and `~` are expanded; a variable in a path counts as unknown and is treated as outside). Nothing is read from disk, so a symlink is judged by the permission engine, which resolves them.

## Mode to flags (`engineSettings`)

| Centcom mode | `claude` | `codex` |
|---|---|---|
| ask | `--permission-mode default` | `--sandbox workspace-write --ask-for-approval untrusted` |
| accept-edits | `--permission-mode acceptEdits` | `--sandbox workspace-write --ask-for-approval on-request` |
| plan | `--permission-mode plan` | `--sandbox read-only --ask-for-approval untrusted` |
| auto-low-risk | `default` plus allowed tools from the permission engine | as `ask` |
| bypass | `bypassPermissions` | `--sandbox danger-full-access --ask-for-approval never` |

`bypass` needs the explicit opt-in; without it the `ask` settings are returned with the note `bypass_requires_opt_in`. Codex also gets the app-server form (`approvalPolicy`, `sandboxPolicy`). With `network: 'deny'`, Codex gets its native switch only when the installed version has it (`caps.codexNetworkOff`); otherwise the result has a `provider_capability_missing` note, and the UI shows reduced protection instead of claiming enforcement. Claude Code has no network switch, so it always carries that note. An unknown mode or engine gets the safe settings and a note; nothing throws.

The flag spellings follow `contracts/10-providers.md` and must be re-checked against the pinned CLI versions when the real transcripts from C102/C103 are recorded.
