# 03 · WebSocket protocol

Contracts in this file: **CT-WS-ENVELOPE · CT-RESUME**

The same protocol runs over the **hosted relay** and over **LAN direct** (a host client acts as the server; see CT-LAN). A client implements it once; transports differ only in how the connection is established and who plays the "server" role.

Schema: `schemas/envelope.schema.json`. Fixtures: `fixtures/envelope/*.json`.

---

## CT-WS-ENVELOPE · Connection and frames

### Endpoint and subprotocol
- Relay: `wss://relay.centcom.dev/v1/ws` (regional hosts `relay-eu`, `relay-us` behind the same name; clients follow the `region` hint returned by `join-token`).
- WebSocket subprotocol: `centcom.v1`. TLS 1.2+ (relay), plain `ws` is allowed **only** on LAN (payloads are encrypted end to end anyway; CT-CRYPTO).
- One connection serves **one session**. A client in several sessions opens several connections.
- Text frames only, UTF-8 JSON. Binary WS frames are reserved. Max frame **256 KiB** (after JSON). Larger content is chunked by the sender (`chunk` field below) or uploaded as a blob (snapshots).

### Frame (envelope)
```json
{
  "v": 1,
  "t": "event",
  "id": "msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W",
  "sid": "ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W",
  "from": "mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W",
  "ts": "2026-10-05T18:07:41.123Z",
  "seq": 1042,
  "ack": 1040,
  "ref": "msg_…",
  "k": "message.user",
  "p": { },
  "ct": { "alg": "xchacha20poly1305", "kid": "k3", "n": "…", "c": "…" },
  "sig": "…"
}
```

| Field | Req. | Meaning |
|---|---|---|
| `v` | ✓ | Protocol major version (integer, `1`) |
| `t` | ✓ | **Frame type** (below) |
| `id` | ✓ for client→server `event`/`control`/`queue` frames | Client-generated `msg_` ULID. Idempotency key: the server de-duplicates by `(sid, from, id)` for 24 h |
| `sid` | ✓ | Session id |
| `from` | server-set | Sender member id (`mem_…`), or the literal `srv` for frames the server itself originates. Clients MUST NOT set it; the server stamps it (a client-supplied value is ignored) |
| `ts` | server-set | Server receive time |
| `seq` | server-set | Session-wide, strictly increasing integer assigned by the server to every **sequenced** frame (see below). Starts at 1 |
| `ack` | optional | Highest `seq` the sender has *processed in order* (sent client→server periodically and piggy-backed) |
| `ref` | optional | `id` of a frame this one answers/relates to |
| `k` | for `event`/`control`/`queue`/`presence` | **Kind**: the event name, e.g. `message.user`, `queue.submit`, `control.kick` |
| `p` | cleartext payload | JSON object. Used for `sys.*`, `control`, `queue`, `presence` and cleartext/hybrid events |
| `ct` | encrypted payload | Ciphertext object (CT-CRYPTO). Each event kind is **clear** (`p` only), **encrypted** (`ct` only) or **hybrid** (both); see CT-WS-SESSION-EVENTS |
| `sig` | for `ct` frames | Ed25519 signature by the sender device over the canonical header + ciphertext (CT-CRYPTO §Signing) |

### Frame types (`t`)
| `t` | Direction | Sequenced? | Purpose |
|---|---|:-:|---|
| `sys.hello` | C→S | no | First frame. Carries relay ticket, protocols, caps, client info, `last_seq` (for resume) |
| `sys.welcome` | S→C | no | Accepts. Carries chosen protocol, caps, `member`, `slot`, `role`, roster snapshot version, heartbeat settings, server time |
| `sys.ping` / `sys.pong` | both | no | Heartbeat |
| `sys.error` | S→C (or C→S for protocol faults on LAN host) | no | Problem+json body in `p` (CT-ERR); may be followed by close |
| `sys.slow_down` | S→C | no | Backpressure: client must reduce rate for `p.for_ms` |
| `sys.notice` | S→C | no | Server notices (usage warnings, plan changes, maintenance). `p: {code, level, params}`; catalogue in CT-WS-SESSION-EVENTS |
| `sys.resume` | C→S | no | Resume request (`p.last_seq`), when not in `hello` |
| `sys.resumed` | S→C | no | Replay window result: `{from_seq, to_seq, count}` or `{snapshot_required: true, snapshot_seq}` |
| `sys.bye` | both | no | Graceful close with reason |
| `event` | both | **yes** | Session content/application events (CT-WS-SESSION-EVENTS) |
| `queue` | both | **yes** | Queue operations (CT-WS-QUEUE) |
| `control` | C→S, S→C | **yes** | Authority actions (CT-WS-CONTROL) |
| `presence` | both | no (ephemeral, coalesced) | Presence and ephemeral indicators (CT-WS-PRESENCE) |
| `ack` | C→S | no | Pure ack frame `{ack: n}` when nothing else to send |

Only **sequenced** frames are buffered, replayed and acked. Ephemeral frames (`presence`, pings) are never replayed.

### Handshake
```
C → S  (TLS + WS upgrade, subprotocol centcom.v1; no token in URL)
C → S  sys.hello   { protocols:[1], caps:[…], ticket:"<relay JWT>", client:{name,version,contract}, last_seq: 1040|null }
S → C  sys.welcome { protocol:1, caps:[…], member:{id,name,slot,role}, roster_v:17,
                     heartbeat:{ping_ms:20000, dead_ms:50000}, server_time:"…", limits:{…}, resume:{from_seq,…}|null }
S → C  (replayed frames > last_seq, in order, if resuming)   sys.resumed {...}
S → C  presence roster frames
… normal traffic …
```
- The server MUST receive `sys.hello` within **5 s** of upgrade, else close `4408`.
- Ticket is verified (signature, `aud`, `exp`, single-use `jti`, session and membership live check). Failure → `sys.error` then close `4401`/`4403`.
- A second connection for the same `(member, device)` supersedes the first (the old one gets `sys.bye reason=superseded`, close `4409`).

### Heartbeat
- Server sends `sys.ping` every `ping_ms` (default 20 s) with `p.t`; client answers `sys.pong` with the same `p.t`.
- Either side that sees nothing for `dead_ms` (default 50 s) closes the connection and (client) reconnects.
- Clients MAY also ping; the server answers. Pings count as activity.

### Sequencing and delivery guarantees
- The relay assigns `seq` on receipt, in arrival order, per session. Delivery to each client is **in `seq` order, at least once**; the client de-duplicates by `seq` (and by `id` for its own echoes).
- The server echoes a client's own sequenced frame back **with its `seq`** (so the sender learns the ordering). The sender treats the echo as the ack of its send.
- The client sends `ack` (piggy-backed or standalone) at least every 5 s while it has unacked inbound frames, and after every 64 frames.
- The server keeps an in-memory **replay buffer** per session of at least the last **5 000 frames or 10 minutes**, whichever is larger, plus durable ciphertext history (CT-RESUME).
- A client must keep unacked outbound frames and resend them (same `id`) after reconnect; the server's `(sid, from, id)` de-dup makes this safe.

### Limits (server-advertised in `welcome.limits`, defaults below)
| Limit | Default |
|---|---|
| Max frame size | 256 KiB |
| Sequenced frames per member | 30/s sustained, burst 100 |
| Presence frames per member | 10/s (server coalesces) |
| Outbound buffer per connection | 2 MiB; exceeding → `sys.slow_down`, then close `4429` |
| Members per session | by plan (CT-ENTITLEMENTS), hard cap 50 |
| Idle session timeout (no host connected) | 10 min grace, then session `paused`; 24 h then `expired` |

### Close codes
| Code | Meaning |
|---|---|
| 1000 | Normal |
| 1001 | Going away (server restart); client reconnects immediately with jitter |
| 4400 | Protocol violation (bad frame/schema) |
| 4401 | Unauthenticated / ticket invalid or expired |
| 4403 | Forbidden / membership revoked |
| 4404 | Session not found or ended |
| 4408 | Handshake timeout |
| 4409 | Superseded by another connection |
| 4426 | Client version too old |
| 4429 | Rate-limited / slow consumer |
| 4503 | Server overloaded; retry later (`retry_after_s` in the preceding `sys.error`) |

### Reconnection (client)
1. On any close except 4401/4403/4404/4426, reconnect with exponential backoff: 250 ms × 2ⁿ, full jitter, cap 15 s.
2. Fetch a **new relay ticket** (`POST /v1/sessions/{id}/join-token`) for each attempt (tickets are single-use).
3. Send `sys.hello` with `last_seq` = highest contiguous seq processed.
4. Resend any unacked outbound frames after `welcome`.
5. For 4401 refresh the access token first; for 4403/4404 stop and tell the user.

### Compression
`permessage-deflate` is **not** used (ciphertext does not compress). Optional capability `compress.zstd` is reserved for cleartext snapshots; not used in v1.

### Ordering across event kinds
All sequenced kinds share one `seq` space, so queue state, control actions and events are totally ordered within a session. That is what lets a late joiner reconstruct state by replay.

### Security notes
- The relay MUST validate every frame against the schema before routing; invalid frames → `sys.error` (`invalid_frame`) and, if repeated (>10/min), close 4400.
- The relay MUST NOT log `p` of cleartext frames beyond the kind, nor ever log `ct`.
- Clients MUST drop frames whose signature does not verify or whose `from` is unknown, and surface a protocol warning (never crash).

---

## CT-RESUME · History, replay, snapshots

### Layers
| Layer | Holds | Window | Who serves it |
|---|---|---|---|
| **Hot buffer** | Sequenced frames | ≥ 5 000 frames / 10 min | Relay memory/Redis, over the WS (`resumed`) |
| **Durable log** | Ciphertext of every sequenced frame | By plan: Pro 7 days, Team 30 days (CT-ENTITLEMENTS `history_days`) | Blob store via REST |
| **Snapshots** | Client-built *encrypted* state checkpoints (transcript + queue + roster state) | Latest 3 per session | Blob store via REST |

### Flow
1. Client reconnects with `last_seq`.
2. Server: if `last_seq` is within the hot buffer → replays `last_seq+1 … head`, then `sys.resumed {from_seq, to_seq, count}`.
3. Else → `sys.resumed {snapshot_required:true, snapshot_seq}`. The client:
   a. `GET /v1/sessions/{id}/snapshot` → pre-signed URL + `{snp, seq, size, sha256}`; downloads, verifies hash, **decrypts** with the right epoch key.
   b. `GET /v1/sessions/{id}/history?after_seq=<snapshot_seq>&limit=…` (paginated, CT-PAGE) to fetch the ciphertext frames after the snapshot (or replays them over WS after sending `sys.resume {last_seq: snapshot_seq}`).
   c. Applies frames in order; sends `ack`.
4. If no snapshot exists, `snapshot_required` is never `true`; the server replays from the earliest retained frame and adds `history_gap: true` to `sys.resumed` when frames before `last_seq+1` are no longer available.
5. If no snapshot exists and history is incomplete, the client rebuilds from the earliest retained frame, and shows "earlier history unavailable".

### Snapshot rules
- Built and uploaded by the **host** client every 500 frames or 5 min of activity (whichever first) and on graceful end. Upload via pre-signed PUT from `POST /v1/sessions/{id}/snapshot` (returns `{snp, upload_url, expires_in}`), then `POST /v1/sessions/{id}/snapshot/{snp}/commit {seq, sha256, size, kid}`.
- Server verifies size/hash only (cannot read content). Keeps the latest 3; deletes older ones.
- Snapshot payload format (inside the ciphertext) is client-defined but versioned: `{"fmt":"centcom.snapshot","v":1,…}`; clients MUST refuse an unknown `fmt`/`v` with a clear message.

### Epoch keys and history
History frames carry `ct.kid`. A late joiner is granted the keys for epochs it is entitled to (CT-CRYPTO §Joining): by default **all epochs of the session** if the host allows "share history" (default on for invited editors/viewers; the invite can disable).

### Deletion and retention
- When a session ends, durable log and snapshots are kept until `history_days` expires, then purged by the retention job; deleting a workspace purges immediately.
- `DELETE /v1/sessions/{id}/history` (host/owner only) purges on request and writes an audit event.

### What the server stores about history (for the privacy review)
`seq, id, from, ts, kind-class (event|queue|control), size, kid, blob key`. Never plaintext.
