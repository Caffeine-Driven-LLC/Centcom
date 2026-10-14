# Troubleshooting

Start with:

```sh
centcom doctor
```

It prints one line per check and exactly one next step for each problem. The checks are: `node`, `os`, `terminal`, `keychain`, `git`, `config`, `network` (the Centcom service), `version`, `clock`, `relay` and `account`. The network checks time out after three seconds and never block local use. `--json` prints the same as data, and `centcom doctor --bundle report.tar.gz` writes a local file you can attach to an issue (it contains no code, messages or paths, and nothing is sent).

## Common problems

- **The agent is not found or not signed in:** `centcom provider status`, then sign in with the agent's own command (`centcom provider login`).
- **Node is too old:** Centcom needs Node 22 or newer.
- **Colours look wrong or garbled:** set `NO_COLOR=1`, or use `--colors 256` or `--colors 16`; see the [environment variables](../reference/env.md) (`NO_COLOR`, `COLORTERM`). `--theme light` suits a light terminal.
- **A screen reader or a recording tool:** `centcom --screen-reader` prints plain lines; `--no-alt-screen` keeps the last picture in your scrollback.
- **Sign-in does not stay between runs:** your computer has no keychain (Secret Service on Linux). `centcom doctor` says so.
- **A shared session says offline or reconnecting:** your own agent and your files are not affected, and what you share goes out when the connection is back. `centcom doctor` checks the service and the relay.
- **Your clock is off:** sign-in and signatures depend on it; `centcom doctor` compares it with the service.
- **An update did not work:** `centcom update --check` looks, `centcom update --rollback` goes back to the previous version. Exit code 12 means this install cannot update itself and shows the command to run.
- **A crash:** `centcom crash list` shows the reports kept on your computer, `centcom crash show <id>` reads one.
- **A hosted action is refused with a limit message:** see [Accounts and plans](./billing.md). LAN and local work are never limited.

## Still stuck

Run with `--debug`: detailed logs go to `~/.centcom/logs/centcom.log` on this computer. `/config` shows every setting and where it came from; see [Configuration](../reference/config.md).
