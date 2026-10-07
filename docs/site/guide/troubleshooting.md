# Troubleshooting

Start with:

```sh
centcom doctor
```

It prints one line per check and exactly one next step for each problem. `centcom doctor --bundle report.tar.gz` writes a local file you can attach to an issue (it contains no code, messages or paths, and nothing is sent).

- **The agent is not found or not signed in:** `centcom provider status`, then sign in with the agent's own command.
- **Colours look wrong:** see the [environment variables](../reference/env.md) (`NO_COLOR`, `COLORTERM`).
- **A crash:** `centcom crash list` shows the reports kept on your computer.
