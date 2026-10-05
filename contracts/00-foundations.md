# 00 · Foundations

Contracts in this file: **CT-IDS · CT-ERR · CT-VER · CT-PAGE · CT-STATUS**

Normative words (MUST, SHOULD, MAY) follow RFC 2119.

---

## CT-IDS · Identifiers, time, money, text

### Identifiers
All entity IDs are **prefixed ULIDs**: `<prefix>_<26-char Crockford base32 ULID>`, lowercase prefix, uppercase ULID.
Example: `ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W`.

| Entity | Prefix | | Entity | Prefix |
|---|---|---|---|---|
| user | `usr` | | session | `ses` |
| workspace | `wsp` | | agent | `agt` |
| device | `dev` | | queue item | `que` |
| membership | `mem` | | message / frame | `msg` |
| invite | `inv` | | approval | `apr` |
| api key (id) | `key` | | subscription | `sub` |
| webhook endpoint | `whk` | | webhook delivery | `dlv` |
| notification | `ntf` | | audit event | `aud` |
| snapshot | `snp` | | project | `prj` |
| upload / blob | `blb` | | request | `req` |
| data export | `exp` | | push subscription | `psh` |
| usage event | `use` | | status incident | `inc` |

- IDs are opaque to clients. Clients MUST NOT parse the ULID part for meaning except for sort order (lexicographic order = creation order, within one generator's clock skew).
- Server-generated IDs are generated server-side. **Client-generated IDs** are allowed (and required) for: queue item `que_`, frame `msg_`, approval request `apr_`. They MUST be ULIDs from a monotonic generator; the server treats them as idempotency keys.
- Max ID length 40 bytes.

### Time
- Wire timestamps: RFC 3339, UTC, `Z` suffix, millisecond precision: `2026-10-05T18:07:41.123Z`.
- Durations: integer milliseconds in fields named `*_ms`, integer seconds in `*_s`. Never fractional.
- Clients MUST NOT trust their own clock for ordering inside a session; the relay assigns `seq` (see CT-WS-ENVELOPE).
- Server clock skew tolerance for token `exp`/`iat`: ±60 s.

### Money
- Integer **minor units** + ISO-4217 code: `{"amount": 1900, "currency": "USD"}`. Never floats.
- v1 currencies: `USD`, `EUR`.

### Text
- UTF-8, NFC-normalised at the API boundary. Control characters (U+0000–U+001F except `\n`, `\t`) are rejected.
- Display names: 1–40 chars. Workspace names: 1–60. Session names: 1–80. Slugs: `[a-z0-9-]{3,40}`.
- Email addresses: lower-cased, ≤ 254 chars.
- Locale: BCP 47 tag; default `en`.

### Hashes, binary
- Binary on the wire is **base64url without padding**.
- Hash display/ID format: `<alg>:<hex>` e.g. `sha256:9f86d0…`.
- Public keys: 32-byte raw, base64url. Signatures: 64-byte raw, base64url.

### Enumerations
- Enum values are lower-case snake or kebab as listed in the schemas, never numeric.
- Consumers MUST tolerate unknown enum values (treat as "other" and continue).

---

## CT-ERR · Error model

All HTTP errors use **RFC 9457 `application/problem+json`**. All WebSocket errors use the `sys.error` frame with the same body shape.

```json
{
  "type": "https://centcom.dev/errors/quota_exceeded",
  "title": "Quota exceeded",
  "status": 429,
  "code": "quota_exceeded",
  "detail": "Your workspace used 100% of its monthly agent-minutes.",
  "instance": "/v1/usage/events",
  "request_id": "req_01JA3Z8K2M5N7P9Q0R1S2T3V4W",
  "retry_after_s": 3600,
  "errors": [{"pointer": "/events/3/qty", "code": "out_of_range", "detail": "must be ≥ 0"}]
}
```

Rules:
1. `code` is the stable machine identifier from `errors.json`. Clients switch on `code`, never on `title`/`detail`.
2. `detail` is human-readable English, safe to show, and MUST NOT contain secrets, other users' data, or internal paths.
3. `status` is the HTTP status (for WS errors it is the equivalent status and informational).
4. `request_id` is always present and echoed in the `X-Request-Id` response header. Clients MAY send `X-Request-Id` (a valid `req_` ULID) and the server SHOULD reuse it.
5. `errors[]` holds per-field validation problems (JSON Pointer into the request).
6. `retry_after_s` is present for `429`, `503` and any retryable code; it also appears as `Retry-After`.
7. Unknown codes MUST be handled as their HTTP status class.
8. Error codes are namespaced by area in the registry; adding a code is a *minor* contract change, removing or changing meaning is *breaking*.

Retry semantics (normative table; clients and server obey the same table):

| Status | Retry? | How |
|---|---|---|
| 400, 401*, 403, 404, 409, 410, 422 | No | Fix the request. (*401 → refresh token once, then re-auth) |
| 408, 425, 429 | Yes | Honour `Retry-After`, else exponential backoff with full jitter, base 500 ms, cap 30 s |
| 500, 502, 503, 504 | Yes, idempotent requests only | Same backoff, max 5 attempts |

POST requests are retried only if they carry an `Idempotency-Key` (CT-PAGE).

---

## CT-VER · Versioning and compatibility

### REST
- Version in the path: `/v1/…`. A new major version runs side by side with the old for ≥ 6 months.
- **Additive changes are not breaking**: new optional request fields, new response fields, new enum values (documented as extensible), new endpoints, new error codes.
- **Breaking**: removing/renaming a field or endpoint, changing a type, making an optional field required, tightening validation, changing semantics of a code.
- Deprecations are announced with the `Deprecation` and `Sunset` response headers and in `/v1/status`.

### WebSocket protocol
- `v` field in every frame (integer). `sys.hello` carries `protocols: [1]`; `sys.welcome` returns the chosen `protocol`.
- Feature negotiation: `caps` arrays in hello/welcome (strings such as `resume`, `compress.zstd`, `cursor.coalesce`). A side MUST NOT use a capability the other did not advertise.
- Minimum supported protocol and client versions are published in `/v1/status` and in the release manifest (CT-API-RELEASES). A server may reject too-old clients with `client_too_old` (HTTP 426 / WS close code 4426) carrying the upgrade hint.

### Contract files
- Contract files carry a `contract_version` (semver) in `contracts/index.json`.
- MAJOR = breaking; MINOR = additive; PATCH = clarification/fixture only.
- Every release of either repo records the `contract_version` it was built against in its build metadata and in the `User-Agent`: `centcom-cli/1.4.2 (contract/1.0.0; linux-x64; node/22.9.0)`.

### Unknown data (the robustness rule)
Readers MUST ignore unknown JSON fields, unknown event types, unknown enum values, and unknown capabilities, and MUST NOT fail validation because of them. Writers MUST NOT emit anything not in the schema.

---

## CT-PAGE · Pagination, idempotency, rate limits, conditional requests

### Pagination (cursor-based, all list endpoints)
Request: `?limit=<1..200, default 50>&cursor=<opaque>`; optional `sort` per endpoint.
Response:
```json
{ "data": [ ... ], "next_cursor": "opaque-or-null", "has_more": true }
```
- Cursors are opaque, URL-safe, expire after 24 h, and are bound to the same filters. An expired, malformed or mismatched cursor returns `400 cursor_invalid`.
- Never offset-based. Order is stable within a cursor.

### Idempotency
- Every **POST** that creates or changes state accepts `Idempotency-Key: <ULID or UUID>` (≤ 64 chars).
- The server stores key → (request fingerprint, response) for **24 h**. Replaying the same key with the same body returns the stored response (status + body) with `Idempotency-Replayed: true`. Same key with a different body → `409 idempotency_conflict`.
- A duplicate that arrives while the first request with the same key is still running waits up to 10 s for its result, then returns `409 conflict` with `Retry-After: 1`.
- Required (rejected with `400 idempotency_key_required` otherwise) on: checkout creation, invite creation, usage event ingest, webhook endpoint creation.

### Rate limits
Headers on every API response (IETF `RateLimit` draft):
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds), plus `Retry-After` on 429.
Buckets (defaults, tunable server-side without a contract change): anonymous 30/min/IP; user 600/min; API key 1200/min; auth endpoints 20/min/IP; usage ingest 60/min/device. Websocket frame limits are in CT-WS-ENVELOPE.

### Conditional requests
Mutable resources return `ETag`. `PATCH`/`PUT`/`DELETE` accept `If-Match`; mismatch → `412 precondition_failed`.

### Sparse reads
`?fields=a,b,c` is NOT supported in v1 (keeps caching simple).

### Request size limits
JSON bodies ≤ 256 KiB except `POST /v1/usage/events` (≤ 1 MiB) and snapshot upload (≤ 32 MiB, direct to blob store via pre-signed URL).

---

## CT-STATUS · Health and status endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | Liveness. `200 {"status":"ok"}` if the process is up. Never touches dependencies. |
| `GET /readyz` | none | Readiness. `200` only if the instance can serve (DB reachable, Redis reachable, migrations at expected version). Else `503` with `{"status":"degraded","checks":{...}}` |
| `GET /v1/status` | none | Public status feed (below) |
| `GET /.well-known/jwks.json` | none | Token signing keys |

`GET /v1/status`:
```json
{
  "status": "operational | degraded | partial_outage | major_outage",
  "updated_at": "2026-10-05T18:07:41.123Z",
  "components": [{"id":"relay-eu","name":"Relay (EU)","status":"operational"}],
  "incidents": [{"id":"inc_01JA3Z8K2M5N7P9Q0R1S2T3V4W","title":"Elevated latency","status":"investigating","started_at":"…","updates":[{"at":"…","text":"…"}]}],
  "min_client_version": "1.2.0",
  "contract_version": "1.0.0",
  "deprecations": [{"what":"/v1/foo","sunset":"2027-03-01"}]
}
```
Incident `status` is one of `investigating | identified | monitoring | resolved`. Cached 15 s at the edge. Clients show degraded/outage banners from this and MUST NOT block local or LAN use because of it.
