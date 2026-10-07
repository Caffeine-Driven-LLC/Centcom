# host session engine (lane C075)

`HostSessionEngine` is the host's authority for a LAN session: what the hosted relay does (queue rules, control actions, approvals, locks, roster, history) done by the host, so a LAN command post behaves like a hosted one. It plugs into `LanHostServer` as its `FrameInterceptor` (`onInbound` decides, `onSequenced` updates state and sends what follows) and never reads `ct`.

| File | What it decides |
|---|---|
| `authority.ts` | who may send which kind (CT-RBAC session actions, mute, locked, branch mode) |
| `queue-machine.ts` | queue states, caps (5 per member, `queue_limit`, 192 KiB), order, version, held on host loss |
| `control-enforcer.ts` | kick, mute, role, transfer, end, policy and rotate checks |
| `approval-router.ts` | who may answer an approval; first decision wins, expiry |
| `lock-arbiter.ts` | `file.lock` on `path_hmac`: first acquire wins, `deny`, ttl `expire` |
| `roster.ts` | members, stable slots, roster version |
| `history.ts` | `SessionPersistence`, a file implementation (frames as JSON lines, snapshots 0600, latest 3 kept), cadence constants |
| `engine.ts` | the wiring, the host's own actions (`approveItem`, `kick`, ... go through the loopback link, so the same code path as remote frames) |

Rejected actions answer the sender only (`sys.error`), are logged, and are never numbered. Kick closes the target with 4403, revokes its reconnect token and emits `member_left` and `rotate_key` with consecutive seq. A server-originated frame (`control.*` from the engine, `queue.state`, auto `queue.approve` with `policy: "auto:<mode>"`) is built by the server with `from: "srv"`.

Changes in `@centcom/lan` for this lane: `setInterceptor`, `setHooks` (connected, disconnected, left), `setRole`, `roleOf`, `dropMember`, `setSnapshots`, `onSequenced`, a stable slot per member, and an `id` on server frames (clients refuse frames without one).

Not here: host failover, restoring a session after a host restart (the session ends), the snapshot builder (the caller encrypts it), the agent runner. Frame payload shapes are not schema-checked beyond what the control and queue checks need; unknown kinds are sequenced and forwarded.
