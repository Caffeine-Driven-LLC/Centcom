# Getting started

## Quick start

1. [Install](./install.md) Centcom, and make sure `claude` or `codex` works on its own: sign in with their own commands. `centcom provider status` checks both.
2. In a project folder, run `centcom`. The first run sets a few things up; `centcom init` does it on purpose.
3. Type what you want done. When the agent wants to run a command or change a file, Centcom asks first; `y` allows it once, `n` declines it.
4. Press `?` for every shortcut, or run `centcom keys`. `ctrl+k` searches commands, files, conversations and skills, and `/settings` shows every setting in one list.

No agent yet, or only looking around? `centcom --demo` runs a scripted pretend agent: no login, no model, nothing sent.

You do not need an account for any of this. An account is only needed for hosted sessions ([Accounts and plans](./billing.md)).

## One task, no screen

```sh
centcom -p "what does this project do?"
```

Print mode runs one task, prints the answer and exits, so it works in scripts. Piped input is added to the prompt, `--output-format json` gives machine-readable output, and the exit code says what happened ([exit codes](../reference/exit-codes.md)). An approval that nobody can answer is declined and the exit code is 3, unless you allow it up front with `--allow`.

## Where to go next

- [The terminal app](./terminal-app.md): everything the screen can do.
- [Teams and sharing](./teams.md) and the two ways to share: [command post and branch mode](./command-post.md).
- [Troubleshooting](./troubleshooting.md) when something is off.
