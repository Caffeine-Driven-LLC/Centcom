# Roles and permissions

In a session:

- **Host** can do everything in the session: end it, remove people, change roles and hand the host role to someone else.
- **Editor** can send requests; whether they can answer approvals depends on the mode and on what the host allows.
- **Viewer** can watch and send nothing, apart from showing they are present.

In a workspace the roles are owner, admin, member, billing and guest ([Teams and sharing](./teams.md)).

Whether an agent may run a command or change a file is decided by permission rules and, if no rule applies, by asking. Plan mode never writes. `--dangerously-skip-permissions` exists for people who want no questions at all, and has to be given each time; it is never saved.
