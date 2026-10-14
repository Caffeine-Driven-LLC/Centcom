# handoff and pair mode (lane C079)

- `requestHandoff(host, to)`: only a host may ask, only for a connected editor that holds every key epoch (`forbidden`, `not_editor`, `keys_missing` are answered locally and send nothing). It sends one `control.transfer_host` and resolves `ok` only when the server's `control.host_changed` names the target; `timeout` after 10 s, `superseded` when a rival transfer, a failover or the target leaving came first. `onProgress` gives requested, accepted, done, failed.
- `HostActionGate`: refuses host actions from the transfer frame's seq on, not from the click.
- `onHostChanged`, `watchRole`: follow who the host is; a failover only changes the role, nothing reconnects and nothing the caller keeps is touched.
- `adoptQueue`, `ClaimLedger`: what was running shows as approved to the new host; an item is claimed once.
- `EpochTracker`: the kid new frames are sealed with moves at `control.rotate_key`.
- `startPair(session, agent, partner)`: announces `pair-working` (`agent.state`), merges both selections on one file (`sharedSelection$`), and `stop()` clears it and publishes your own cursor again at once.
- `fromSessionHandle(handle, clock)` adapts the session client.

The engine puts running items back to approved when the role is about to move (`HostSessionEngine.releaseRunning()`, `QueueMachine.requeueRunning()`; `transferHost` calls it before it sends the transfer; an unplanned failover has no old host to call it, so the new host's view uses `adoptQueue`); `adoptQueue` stays for a new host that reads the view of an old one. Not here: the roster hint depends on the session accepting `agent.state` from an editor (branch mode), and pairing works without it; mascot animations are triggered by the callers on `done` and on `startPair`, never on a timer.
