# Install

Centcom needs Node 22 or newer.

```sh
npm install --global centcom
```

Homebrew and standalone binaries are planned; this page says so when they arrive.

Check it worked:

```sh
centcom --version
centcom doctor
```

Centcom keeps itself up to date: each time it starts it looks for a newer release in the background and brings it in for the next start. See [Releases](releases.md) for how, what is in each version, and how to turn it off (`update.auto`).

`centcom doctor` checks Node, the terminal, the keychain, git, the network and your clock, and says what to do about each problem.
