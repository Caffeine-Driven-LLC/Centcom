# Install

Centcom needs Node 22 or newer, and a working `claude` (Claude Code) or `codex` on the same computer. It drives your own agent; it does not replace it.

## From the source checkout (the way that exists today)

Centcom is not published to npm, Homebrew or a download page yet. Today you run it from a checkout of the repository, where a `git pull` is an update:

```sh
pnpm install
pnpm install:cli
```

`pnpm install:cli` links `bin/centcom` as `~/.local/bin/centcom`, so `centcom` works in any folder. Make sure `~/.local/bin` is on your `PATH`.

## Planned

- **npm** (`npm install --global @centcom/cli`), **Homebrew** (`brew install centcom`) and **standalone binaries** for Linux, macOS and Windows. None of them is published yet. The update code already knows about all three ([Releases](./releases.md)); this page changes when they exist.

## Check it worked

```sh
centcom --version
centcom doctor
```

`centcom doctor` checks Node, the terminal, the keychain, git, the network, the relay, your sign-in, the version and your clock, and says what to do about each problem.

## Keeping it up to date

Each time it starts, Centcom looks for a newer release in the background and brings it in for the next start. See [Releases](./releases.md) for how, what is in each version, and how to turn it off (`update.auto`).

## Taking it off

Remove the link (`~/.local/bin/centcom`) and the checkout. Your settings and saved conversations stay in the configuration and state folders until you delete them; see [Configuration](../reference/config.md).
