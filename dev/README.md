# dev data

Everything here is made up. There are no real accounts, keys or tokens.

- `seed/` is loaded by the mock backend (`pnpm dev:mock`). It has five files:
  - `users.json`
  - `workspaces.json`
  - `sessions.json`
  - `entitlements.json`
  - `notifications.json`
- `example-config/` holds sample settings files that load without warnings.

## The people

| | Who | Where |
|---|---|---|
| `ada` | the first user, so the one who signs in on the mock; owns all three workspaces | `users.json` (first entry) |
| `ben` | a member | second entry |
| `cy` | a guest who can only look | third entry |
| `dee` | handles billing | fourth entry |

## The workspaces and plans

- **Acme Pro** (plan pro): relay access, 8 parallel agents.
- **Acme Team** (plan team): relay access, 32 parallel agents, 90 days of history and audit.
- **Ada Personal** (plan free): no relay, 2 parallel agents.

## Sessions

One `live` session in Acme Pro, one `pending` and one `ended` session in Acme Team.

## Notifications

One notification for each category in the contract (15), with message keys and no display text.

## Signing in on the mock

The mock approves a device login on its own after a few polls (`pnpm centcom login`). For scripts, `mock.mintToken()` (in `@centcom/testkit`) returns a signed token for the first user.
