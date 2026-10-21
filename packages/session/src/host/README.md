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

Each frame's clear part is checked against the contract for its kind before it is numbered (a known kind with a wrong clear part is refused as `invalid_frame`; unknown kinds, `presence.*`, `queue.*` and `control.*` have their own rules). `releaseRunning()` puts running queue items back to approved when the host role is about to move, so the next host runs them once. Host failover: with `auto_failover` on, a host that drops and is still away after `failoverGraceMs` (10 s) is replaced by the connected editor with the lowest slot (`failover()`): running items go back to approved, everyone hears `control.host_changed {code:'failover'}`, the roster and the queue; with no editor the session pauses. A host that comes back is an editor.

`runner-bridge.ts` (`HostRunnerBridge`) puts the host's agent behind the engine: it claims the approved item at the front, hands the host-opened text to an agent from the runner (`open` is the host's own session codec; an unreadable item is rejected), ends the item on the agent's `turn.done` or exit, and passes the agent's events through `toSessionWire` to `publish`. It claims only while its member is host.

`lan-snapshot.ts` seals the host's state at a seq (queue, roster, transcript, agents) in the net package's snapshot format; the server serves it on `lan.snapshot.get`, a guest beyond the replay window fetches it (`LanTransport.fetchSnapshot`), opens it (`openLanSnapshot`) and `GuestSession` restores from it. The engine builds the snapshot after the frame that triggered it has taken effect, and stores and serves the bytes without opening them.

Not here: restoring a session after a host restart (the session ends).