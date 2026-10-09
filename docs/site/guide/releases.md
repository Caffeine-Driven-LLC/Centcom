# Releases

Generated from `docs/releases.json`. Do not edit by hand: run `pnpm docs:gen`.

## The latest

| Channel | Version | Released |
|---|---|---|
| stable | none yet | – |
| beta | none yet | – |
| nightly | none yet | – |

## How Centcom stays up to date

Every time Centcom starts it looks for a newer release on your channel, in the background. It never delays the start, gives up after five seconds, and says nothing when you are offline or already up to date.

- **A standalone install** downloads the new program, checks its SHA-256 and its Ed25519 signature against the keys built into Centcom, and only then replaces itself. Anything that fails a check is deleted and nothing changes. The version you had is kept, so `centcom update --rollback` brings it back.
- **An npm or Homebrew install** runs its own update command (`npm install --global centcom@latest` or `brew upgrade centcom`). If that does not work, for example for lack of permission, the command is shown to you instead.
- **A source checkout** is only told that a newer version exists.

The new version is used the next time you start Centcom. You see one note when it happened.

```sh
centcom update --check        # is there something newer? (exit code 10 when yes)
centcom update                # update now, asking first
centcom update --rollback     # go back to the version you had
centcom update --channel beta # follow another channel for this run
```

| Setting | Default | What it does |
|---|---|---|
| `update.check` | on | look for a newer release each time Centcom starts |
| `update.auto` | on | bring it in by itself (off: only say that one exists) |
| `update.channel` | stable | `stable`, `beta` or `nightly` |

`CENTCOM_NO_UPDATE_CHECK=1` turns the check off for one run, and nothing is checked when `CI` is set. Change a setting with `/settings` or `centcom config`.

## All releases

There is no public release yet. This page lists each one, newest first, as soon as there is.
