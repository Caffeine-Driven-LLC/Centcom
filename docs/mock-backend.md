# Mock backend

`@centcom/testkit` contains a stand-in for the Centcom service, so the client can be built and tested before any real server exists. It speaks the contract in `contracts/` (REST, WebSocket relay) and nothing else. It is for tests and local development only; it has no security of its own, binds 127.0.0.1 only, and must never be exposed to a network. Production packages must not import it.

```bash
pnpm --filter @centcom/testkit mock-backend --port 0 --seed 7 --scenario happy
# stdout, exactly one line:  {"http":"http://127.0.0.1:41234","ws":"ws://127.0.0.1:41234/v1/ws"}
# stderr: JSON lines (ready, http, frame, ws_close, exit); frame lines carry kind, ids, seq, size only
```

| Flag | Meaning |
|---|---|
| `--port N` | `0` (default) picks a free port; the real one is in the stdout line |
| `--scenario NAME\|FILE.json` | Run a bundled scenario (below) or a scenario file |
| `--seed N` | Same seed, same ids, keys, bodies and timestamps (default: the scenario's `seed`, else 1) |
| `--data DIR` | Load seed data (below) |
| `--clock real\|virtual` | CLI default `real`; `virtual` only moves on `POST /__mock/advance {ms}` |
| `--ping-ms N`, `--dead-ms N` | Heartbeat advertised in `sys.welcome` and enforced (defaults 20000 / 50000; dead must exceed ping) |
| `--no-control` | Do not serve `/__mock/*` |
| `--quiet` | Only errors on stderr |

Exit codes: `0` after SIGINT/SIGTERM (every socket is closed with 1001 first; the process is gone within 1 s), `1` port in use (`EADDRINUSE: port N …`) or another startup failure, `2` bad arguments, an unknown scenario, or a malformed scenario/seed file (every violation is listed by JSON pointer; nothing starts).

## In a test

```ts
import { startMockBackend, DEFAULT_SID } from '@centcom/testkit';
const mock = await startMockBackend({ clock: 'virtual', seed: 7, scenario: 'happy' });   // also: port, dataDir, heartbeat, relay, control, log
const token = mock.mintToken();                          // a valid access token
const ticket = mock.mintTicket({ sid: DEFAULT_SID, role: 'host' });   // a valid relay ticket
await mock.advance(25_000);                              // time only moves when you say so; scenario steps fire here
mock.disconnect({ sid: DEFAULT_SID, role: 'editor', code: 4503, retryAfterS: 30 });
mock.notice(DEFAULT_SID, 'usage_warning', 'warn', { pct: 90, resets_at });
mock.setScenario('host-loss');                           // replaces pending steps of the previous scenario
mock.frames(DEFAULT_SID);                                // {seq, ts, t, k, id, from, bytes} per frame: never the content
await mock.stop();
```

`addVirtualPeer`, `reset` and `control(op, body)` are also available. The same operations are reachable over HTTP at `/__mock/<op>`, answered only to 127.0.0.1/::1 (any other source address gets 404): `state`, `reset`, `advance`, `errors`, `rate-limit`, `maintenance`, `min-client`, `approve-device`, `deny-device`, `expire-device`, `revoke-device`, `session`, `ticket`, `disconnect {code, sid?, member?, role?, retry_after_s?, reason?}`, `notice`, `fault {type, sid?, ms?, count?}`, `peer-send`, `frames?sid=`, `scenario` (body `{name}` or a whole scenario file).

## Scenarios

A scenario is JSON, validated on load (closed shapes: a typo is an error):

```json
{ "name": "my-case", "seed": 7, "steps": [
  { "do": "peer_send", "args": { "name": "Host", "role": "host", "k": "message.user" } },
  { "at_ms": 2000, "do": "disconnect", "args": { "code": 1001, "reason": "server_restart" } },
  { "on": { "kind": "sys.hello", "nth": 2 }, "do": "disconnect", "args": { "code": 4429, "retry_after_s": 2 } }
] }
```

A step runs now (no `at_ms`, no `on`), at `at_ms` of mock time after the scenario starts, or when the `nth` frame of `kind` (`k`, else `t`; `sys.hello` = a completed join) passes through the relay. Faults (`drop`, `duplicate`, `delay`, `reorder`) triggered by `on` hit that very frame. Steps without `sid` act on `DEFAULT_SID` (`ses_01JTEST0000000000000000001`).

| `do` | `args` |
|---|---|
| `disconnect` | `code` (a CT-WS-ENVELOPE close code), `sid?`, `member?`, `role?`, `retry_after_s?`, `reason?` (`kicked` runs a real kick; `superseded`; `server_restart`), `error?`. Each code is preceded by its `sys.error` (4401 `ticket_invalid`, 4503 `service_unavailable` with `retry_after_s`, …). Disconnecting the role `host` when the host is a virtual peer starts host loss. |
| `notice` | `code` (CT-WS-SESSION-EVENTS notice), `params` (the keys that code needs), `level?` (defaults from the contract table), `sid?` |
| `error` | `code` (any registry code). REST by default: queued for the next `count` calls. `sticky: true` answers it to every call but status/health until `sticky: false`; `after: n` (with `rate_limited`) lets n calls through first; `min_version` (with `client_too_old`) sets the minimum client for REST and the relay. `channel: "ws"` pushes `sys.error` frames instead. |
| `delay` / `drop` / `duplicate` / `reorder` | `sid?`, `count?`, `ms` (delay) |
| `peer_send` | `k`, `name?`, `role?`, `t?`, `id?`, `p?`, `count?`, `ct_bytes?`. Encrypted kinds carry opaque random `ct` and `sig`; the peer joins on first use. |
| `set_entitlement` | `entitlements` (merged into `GET /v1/workspaces/{id}/entitlements`, `rev` bumped), `workspace?` |

Bundled (`packages/testkit/scenarios/`): `happy`, `resume-hot`, `resume-snapshot`, `forced-disconnect`, `ticket-expired`, `superseded`, `kicked`, `host-loss` (the pause comes after the 10 minute grace: advance the virtual clock), `slow-consumer`, `bad-frames`, `quota-warning`, `maintenance`, `client-too-old`, `overload-4503`, `errors` (every registry code once, in registry order, on the next calls), `rate-limited`, plus `flaky-start` and `busy-session`.

## Seed data (`--data DIR`, `dataDir`)

Optional files `users.json`, `workspaces.json`, `sessions.json`, `entitlements.json`, each an array whose items must match the OpenAPI component `User`, `Workspace`, `Session`, `Entitlements` (ids unique; files up to 8 MiB). The first user is the account that logs in, the first workspace is the active one, sessions exist in the relay with their name and state, entitlements are keyed by `workspace`. `GET /v1/workspaces`, `/v1/workspaces/{id}`, `/v1/sessions`, `/v1/sessions/{id}`, `/v1/me` and entitlements answer from them. Default seed content is lane C011's.

## What it does

**REST.** All operations of `openapi.json` are served; a sweep test proves every response validates. Requests are validated against the request schema (422 `validation_failed` with field pointers).

- Device login: `device/code`, polling with `authorization_pending`, `slow_down`, `access_denied`, `expired_token`; a mock with nobody to approve it approves itself on the third poll.
- Tokens: Ed25519 JWTs (15 minutes) with a JWKS endpoint; refresh rotates, an already-used refresh token revokes the family (`refresh_reuse_detected`); revoked devices are refused.
- Lists: `{data, next_cursor, has_more}`, `limit` 1 to 200, opaque cursors tied to the query; the same request gives the same page.
- `Idempotency-Key`: replay with `Idempotency-Replayed: true`, a different body is `idempotency_conflict`, keys forgotten after 24 hours; checkout, invite creation, usage ingest and webhook creation require one.
- `ETag`: a generated resource is kept once read, so its ETag is stable; `PATCH`/`PUT` merge the request fields and move the ETag. `If-Match` must name the ETag last given out for that path (or `*`), else 412 `precondition_failed`.
- `RateLimit-*`, `Retry-After`, 256 KiB body cap (1 MiB for usage ingest), `X-Request-Id` echoed or generated.

**Relay (`/v1/ws`, subprotocol `centcom.v1`).** Handshake (`hello` within 5 s or 4408; bad/expired/replayed ticket 4401; unknown session 4404; not a member 4403; too-old client 4426; maintenance 4503), welcome with limits and heartbeat, per-session sequencing with echo, de-duplication by frame id, a 5000-frame replay buffer, resume (`sys.resumed` with the missing range, or `snapshot_required`), supersede (4409), roles, the queue state machine, kick (`member_left` then `rotate_key`, 4403), transfer host, end session, host loss (paused after 10 minutes, live when the host is back), coalesced presence, bad frames (the first 10 in 60 s get `sys.error invalid_frame`, the 11th closes 4400), unknown kinds sequenced and forwarded, oversize frames, slow consumers (`sys.slow_down` once, then 4429).

**Never reads content.** The relay does not look inside `ct` and does not verify `sig`; its frame log and logs keep only kind, ids, seq, time, sender and size.

## What it does not do

- It does not verify end-to-end signatures or encryption, and does not model key distribution beyond emitting `rotate_key`.
- Outside login, `me`, sessions, join tokens, entitlements and seeded data, operations are generated examples: creating a workspace does not make it appear in the next list.
- No LAN host mode, no file or blob storage. Rate limiting is a switch (`rate-limit`, scenario `error … after`), not a quota model.

## Contract gaps found while building it

These are in `contracts/` and need the contract process, so the mock works around them:

1. `04-session-events.md` says the queue item id is a `que_` id "carried as the frame `id`", but `envelope.schema.json` requires every frame `id` to match `^msg_…$`. The mock puts the item id in `p.item` (a `que_` id) and uses the frame `id` for de-duplication.
2. `openapi.json` says contract 1.0.0 / version 1.1.0 while `CONTRACTS.lock` says 1.2.0.
