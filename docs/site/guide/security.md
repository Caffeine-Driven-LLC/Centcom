# Security and privacy

This page is about what Centcom protects and how. The exact list of what the relay can and cannot see is in [Privacy and encryption](./privacy.md); this page does not repeat or extend its guarantees.

## Your agents' logins

Centcom starts your own `claude` or `codex`. It never reads their credential files and never sees their login.

## Your keys

Device keys and sign-in tokens live in the operating system's keychain. Neither is written to the configuration or state folders, and a scan of those folders after a sign-in is part of the project's security checks. A configuration file that contains something that looks like a credential is ignored, with a warning that names the key and never the value.

## What is encrypted

What a session carries (messages, code, file paths, branch names, commands) is encrypted on your computer with a session key that only the devices of the people in the session hold, and every encrypted frame is signed by the sender's device. Removing someone rotates the key. File locks travel as a keyed hash of the path, so the relay cannot read a path. Watch-only links carry a view key in the part of the link after `#`, which is not sent to any server.

## What the server sees

The relay sees the parts of a frame it needs to deliver it: sizes, timing, who is in a session and the clear metadata listed in [Privacy and encryption](./privacy.md). It does not see the content. Traffic analysis is not hidden in v1.

## Telemetry

Anonymous usage counts are off unless you turn them on with `centcom telemetry on`. `DO_NOT_TRACK=1` and `CENTCOM_TELEMETRY=off` always win, and nothing ever contains message text, paths or names. See [Environment variables](../reference/env.md).

## What can run

Whether an agent may run a command or change a file is decided by permission rules and, if no rule applies, by asking you. The decision is made on the real command, not on what the model says about it, and risky commands always ask. Hidden characters in a command are shown as escapes. Plan mode never writes. `--dangerously-skip-permissions` has to be given each time and is never saved. Text from a teammate or from a repository is never run as a command. See [Roles and permissions](./roles.md).

## Updates

A downloaded update is checked against its SHA-256 and an Ed25519 signature with keys built into Centcom before anything is replaced, and the old version is put back if the new one does not start. See [Releases](./releases.md).

## Supply chain

The project bans install scripts, uses a frozen lockfile and a licence allow-list, scans for secrets, and produces a software bill of materials for each release artifact. Release signing and a real published artifact are not set up yet.

## Reporting a problem

Crash reports stay on your computer (`centcom crash list`) and are never sent. `centcom doctor --bundle report.tar.gz` writes a local file you can attach to an issue; it contains no code, messages or paths.
