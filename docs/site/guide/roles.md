# Roles and permissions

- **Host** can do everything in the session.
- **Editor** can send requests and answer approvals when the host allows it.
- **Viewer** can watch.

Whether an agent may run a command or change a file is decided by permission rules and, if no rule applies, by asking. Plan mode never writes. `--dangerously-skip-permissions` exists for people who want no questions at all, and has to be typed each time.
