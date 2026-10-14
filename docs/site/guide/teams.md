# Teams and sharing

You can work alone, on your own network, or through the hosted relay. Each has different needs.

| | Account | Server | Who can join |
| --- | --- | --- | --- |
| Alone | none | none | you |
| LAN | none | none | computers on the same network that have the pairing code |
| Relay | yes, on a plan with relay access | the Centcom relay | people you invite, or anyone with a watch-only link |

## LAN

On the same network, `centcom lan scan` lists sessions, and the host's `centcom lan host` prints a one-time pairing code and a fingerprint to compare. No account and no server, and LAN work is never stopped by a plan limit. Hosting beyond your own network needs `--allow-wan`, so it is not done by accident.

## Relay: invite and watch links

After `centcom login`, `/share` starts a session. Then:

- `/share invite <email>` makes a link for one person. They sign in and join at the role you picked; an invite does not use a workspace seat.
- `/share link` makes a watch-only link that anyone can open for an hour. A watch-only guest needs no account, sees what the agent does and cannot send anything.
- `/share status` lists who is in the session, `/share stop` ends it.

Guests join with `centcom join <link or session id>`.

## Roles

A session has a host, editors and viewers; see [Roles and permissions](./roles.md). Inside a workspace the roles are owner, admin, member, billing and guest. Owner, admin and member use a seat; guest and billing do not.

## Workspaces

`centcom whoami` shows who is signed in, the plan and the active workspace, and `centcom devices` lists the computers signed in to your account. Workspace webhooks and the audit log are managed with `centcom webhooks` and `centcom audit` ([Webhooks](./webhooks.md)).

How session content is protected is in [Privacy and encryption](./privacy.md).
