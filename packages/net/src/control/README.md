# control client (lane C060)

`new ControlClient(session, { clock? })`: the host's authority actions and the receiving side of server-issued control frames.

- **Host actions** (each returns `{ seq }`; a non-host gets `NotHostError` and nothing is sent; acting on yourself is refused locally): `kick(member, code)`, `mute(member, until?)`, `unmute`, `setRole(member, 'editor' | 'viewer')`, `transferHost(to)`, `endSession(code)`, `setPolicy({ auto_approve, share_history, queue_limit, locked?, ... })` (checked against the contract before sending), `requestRotation('scheduled' | 'requested')`. A refusal from the relay becomes `ForbiddenError`.
- **Server frames** (`member-joined`, `member-left`, `roster`, `host-changed`, `session-state`, `rotate-key`) are surfaced only when `from` is the server; a roster that is not newer than the last one is ignored; forged and stale ones are counted in `warnings`.
- **State** (`state()`): our own mute (it ends by itself at `until`), role, who is host, the policy, the session state, and `effectiveFromSeq`. Events: `muted`, `unmuted`, `policy`, `became-host` and `lost-host` (once each per change), `removed-from-session`.
- **Session client side:** while muted, `sendEvent` refuses everything except presence (`SessionError('muted')`); `control.role` updates the roster and our own role; being kicked or revoked (`member_left` for us, or close 4403) stops the connection for good, wipes the session's keys from memory (`KeyRing.clear`) and fires `removed` once.

`NotHostError` is exported from the package as `ControlNotHostError` so it does not clash with the queue client's class of the same name.

Not here: key rotation after a kick (the session client does it), queue and approval behaviour changes caused by a policy.
