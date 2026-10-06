# Mock backend

`@centcom/testkit` contains a stand-in for the Centcom service, so the client can be built and tested before any real server exists. It speaks the contract in `contracts/` (REST, WebSocket relay) and nothing else. It is for tests and local development only; it has no security of its own and must never be exposed to a network.

```bash
pnpm --filter @centcom/testkit mock -- --port 0 --seed 7     # prints one JSON line: {"url","ws_url","port","seed"}
```

| Flag | Meaning |
|---|---|
| `--port N` | `0` picks a free port (the real one is in the JSON line) |
| `--seed N` | Same seed, same ids, keys, bodies and timestamps |
| `--clock virtual\|real` | `virtual` only moves when told (default for tests); the CLI default is `real` |
| `--scenario NAME` | Start in a prepared situation (`flaky-start`, `maintenance`, `client-too-old`, `rate-limited`, `busy-session`) |
| `--no-control` | Do not serve `/__mock/*` |

## In a test

```ts
import { startMockBackend } from '@centcom/testkit';
const mock = await startMockBackend({ clock: 'virtual', seed: 7 });
const token = mock.mintToken();                 // a valid access token
const ticket = mock.mintTicket({ sid, role: 'host' });   // a valid relay ticket
await mock.advance(25_000);                     // time only moves when you say so
mock.disconnect({ sid, code: 4503, retryAfterS: 30 });
mock.notice(sid, 'usage_warning', 'warn', { pct: 90, resets_at });
mock.frames(sid);                               // kind, seq, id, sender, size of every frame: never the content
await mock.stop();
```

`addVirtualPeer`, `setScenario`, `reset` and `control(op, body)` are also available. The same operations are reachable over HTTP on loopback only at `/__mock/<op>` (`state`, `reset`, `advance`, `errors`, `rate-limit`, `maintenance`, `min-client`, `approve-device`, `deny-device`, `expire-device`, `revoke-device`, `session`, `ticket`, `disconnect`, `notice`, `fault`, `peer-send`, `frames`, `scenario`).

## What it does

**REST.** All 93 operations of `openapi.json` are served. Requests are validated against the request schema (422 `validation_failed` with field pointers). Most operations answer with a deterministic example generated from the response schema, so they always validate; a test sweeps every operation to prove it. These behave like the real thing:

- Device login: `device/code`, polling with `authorization_pending`, `slow_down` when polled too fast, `access_denied`, `expired_token`; a mock with nobody to approve it approves itself on the third poll.
- Tokens: Ed25519 JWTs (15 minutes) with a JWKS endpoint; refresh rotates, and presenting an already-used refresh token revokes the whole family (`refresh_reuse_detected`); revoked devices are refused.
- Lists: `{data, next_cursor, has_more}`, `limit` 1 to 200, opaque cursors that expire and are tied to the query (`cursor_invalid`).
- `Idempotency-Key`: replay returns the first answer with `Idempotency-Replayed: true`, a different body is `idempotency_conflict`, keys are forgotten after 24 hours, and checkout, invite creation, usage ingest and webhook creation require one.
- `ETag` on reads, `If-Match` on writes (`precondition_failed`), `RateLimit-*` headers, `Retry-After`, 256 KiB body cap (1 MiB for usage ingest), `X-Request-Id` echoed or generated.
- Failure injection: `errors` (any code from the contract, n times), `rate-limit`, `maintenance`, `min-client`.

**Relay (`ws://…/v1/ws`, subprotocol `centcom.v1`).** Handshake (`hello` within 5 s or 4408; expired ticket 4401; replayed ticket 4401; unknown session 4404; not a member 4403; too-old client 4426), welcome with limits and heartbeat, ping every 20 s and drop at 50 s of silence, per-session sequencing with echo, de-duplication by frame id, a 5000-frame replay buffer, resume (`sys.resumed` with the missing range, or `snapshot_required`), supersede (4409), roles (viewers may only react and comment, host-only authority), the queue state machine (caps, `queue_full`, `queue_item_gone`, versions), kick (4403 then `member_left`, `rotate_key`), transfer host, end session, host loss pausing the session after 10 minutes, coalesced presence, bad frames (more than 10 a minute closes 4400), oversize frames, and slow consumers (`sys.slow_down` once, then 4429). Frames can be made to drop, duplicate, reorder or delay (`fault`).

**Never reads content.** The relay does not look inside `ct` and does not verify `sig`; it keeps only kind, id, seq, sender and size, and the frame log it exposes contains nothing else.

## What it does not do

- It does not verify end-to-end signatures or encryption, and does not model key distribution beyond emitting `rotate_key`.
- Operations other than login, `me`, sessions and join tokens are stateless examples: creating a workspace does not make it appear in the next list. Billing, webhooks, invites and audit return plausible data, not behaviour.
- No LAN host mode, no file or blob storage, no real clock-based expiry on the real clock beyond what the timers above do.
- Rate limiting is a switch you turn on (`rate-limit`), not a model of real quotas.

## Contract gaps found while building it

These are in `contracts/` (identical in both repos) and need the contract process, so the mock works around them:

1. `04-session-events.md` says the queue item id is a `que_` id "carried as the frame `id`", but `envelope.schema.json` requires every frame `id` to match `^msg_…$`. The mock puts the item id in `p.item` (a `que_` id) and uses the frame `id` (a `msg_` id) for de-duplication.
2. `openapi.json` says contract 1.0.0 / version 1.1.0 while `CONTRACTS.lock` says 1.2.0.
