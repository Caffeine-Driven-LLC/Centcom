# session transports (lane C074)

Three ways to carry a session, one interface (`SessionTransport`, which is a `FrameLink`, so the reliable-delivery channel of lane C055 can sit on any of them):

| Kind | What it is | Capabilities |
|---|---|---|
| `RelayTransport` | the hosted relay through `RelayClient`; a join token for every connection attempt, the ticket only in the hello | durable history, REST snapshots, entitlements, failover, audit log |
| `LanTransport` | a LAN host: plain `ws://ip:port`, the stored reconnect token as the ticket; with a pairing code and no token it pairs first (`guestPair`, fingerprint checked before anything is accepted) and keeps the token in the keychain | LAN snapshots, 8 members, no failover or entitlements |
| `LocalTransport` | the host's own member talking to a `LanHostServer` through memory; no sockets | nothing that needs a network |

- `openTransport(target, deps)` builds one from a `TransportTarget`; `parseJoinTarget(text)` reads `ip:port`, `[ipv6]:port`, a session id or a `centcom://join/<token>` link (refusing other schemes, whitespace, bad ports, bad octets, and public addresses unless `allowWan`).
- `transportCloseError({ code })` turns close codes into the same typed errors for every kind (4403 forbidden, 4426 client_too_old, 4401 token_invalid, ...).
- `transportConformance(name, make)` is one vitest suite (welcome, 100 frames in order with echo, liveness, resume from `last_seq`, refused frames, graceful and repeated close) that runs unchanged against all three.
- `lanUpgrade` is reported only when the welcome lists the `lan.upgrade` cap; no upgrade call exists here.

Not here: the host server (C072), pairing (C073), discovery (C071), the LAN-to-relay upgrade itself.
