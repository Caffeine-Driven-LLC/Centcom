# reliable delivery (lane C055)

`ReliableChannel` sits on a link (relay or LAN) and makes sequenced frames ordered, de-duplicated and at-least-once.

- **Receiving:** frames come out in seq order, once each. A frame that arrives early is held (at most 1,000); a gap that does not heal in 5 s asks for a resume (`sys.resume {last_seq}`) and after 5 s more forces a reconnect. A relay whose seq numbers went backwards is detected and the channel starts fresh.
- **Sending:** `send()` gives the frame a `msg_` id (monotonic ULID), keeps it until its echo arrives, and resolves with the seq from the echo. After a reconnect the unechoed frames go out again in order with the same ids; one that stays unechoed for 30 s is resent up to 3 times, then reported `stuck`. At 1,000 frames or 8 MiB waiting, `send()` rejects with `OutboxFullError`. Presence frames are written once and never kept.
- **Acks:** every outbound frame carries the last processed seq; a standalone ack goes out after 64 frames, or 5 s after the first unacked one, and never when nothing new came in.
- **Resume:** hello carries `last_seq`; `sys.resumed` is checked (count mismatch: `gap` and a reconnect); `snapshot_required` is reported and delivery waits for `resumeFrom(seq)`; `applyHistory()` feeds REST history through the same order and de-duplication.
- **Position** is saved through a `SeqStore` (memory by default; the offline lane supplies a disk one).
