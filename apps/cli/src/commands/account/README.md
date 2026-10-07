# account commands (lane C053)

`centcom login`, `logout`, `whoami` and `devices`, on top of the auth client (C052).

- **`login [--no-browser] [--device-name <name>] [--api-key-stdin] [--json]`** shows the code and address, opens the browser unless told not to, and waits. `--api-key-stdin` reads a key from standard input (never from an argument). Only `https` addresses are opened.
- **`logout [--revoke-device]`** clears the keychain on this computer; with `--revoke-device` it also asks the server. If the server cannot be reached the keychain is still cleared and the skipped revocation is reported.
- **`whoami [--json]`** shows who is signed in, the plan and the active workspace.
- **`devices list [--json]`** and **`devices revoke <dev_id> [--yes]`** list and remove the computers on the account. Without a terminal, revoking needs `--yes`.
- All messages come from `messages.ts` (plain words, exit codes in `EXIT`); no token, code or key is ever printed or logged.
