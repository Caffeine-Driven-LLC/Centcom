# HTTP API client (lane C051)

One typed client for the whole REST API, so no lane writes `fetch`, headers, pagination or retry logic by hand. Wire behaviour is defined by the contracts, not here: [CT-ERR, CT-VER, CT-PAGE, CT-STATUS](../../../../contracts/00-foundations.md), [02-rest-api.md](../../../../contracts/02-rest-api.md) and [openapi.yaml](../../../../contracts/openapi.yaml).

```ts
import { createHttpClient, defaultUserAgent } from '@centcom/net';

const api = createHttpClient({ userAgent: defaultUserAgent('1.4.2'), getAccessToken: auth.current, onUnauthorized: auth.refresh });
const me = await api.call('getMe', {});                                   // me.data is typed from openapi.yaml
await api.call('getSession', { path: { id } });
await api.call('ingestUsageEvents', { body: { events } });                // Idempotency-Key added and kept across retries
for await (const s of api.paginate('listSessions', { query: { mine: true } })) { /* one page fetched at a time */ }
```

## Interface

| | |
|---|---|
| `createHttpClient(opts)` | Inert until a method is called: no network, no token request. |
| `call(op, { path, query, body }, { signal, idempotencyKey, ifMatch })` | Returns `{ data, status, headers, etag, replayed, requestId, rateLimit }`. |
| `listPage(op, { ...args, cursor, limit })` / `paginate(op, args, { limit })` | CT-PAGE cursors; limit 1..200 (default 50) checked locally. |
| `revalidate(op, args, etag)` | GET with `If-None-Match`; 304 is `{ notModified: true }` (for flags). |
| `getStatus()`, `getJwks()` | CT-STATUS documents. `min_client_version` is returned, never acted on. |
| `withAuthProvider(p)` | Same settings, another identity (own ETags, own refresh). |

Options: `baseUrl` (default `https://api.centcom.dev`; plain http only on loopback), `getAccessToken`, `onUnauthorized`, `userAgent` (must match CT-VER), `fetch`, `clock`, `rng`, `ids`, `logger`, `timeoutMs` (15000 per attempt), `maxAttempts` (5, cannot be raised).

## What it does for you

- **Headers**: `Authorization: Bearer` (only there, never in a URL), `User-Agent`, `X-Request-Id` (a new `req_` ULID per logical request, the same on every retry), `Idempotency-Key`, `If-Match`.
- **Retries** (`retry.ts`): 408/425/429 and 500/502/503/504 with full-jitter backoff (base 500 ms, cap 30 s, at most 5 attempts, at most 60 s of sleep in total). `Retry-After`/`retry_after_s` is honoured up to 30 s; a longer one (for example `quota_exceeded`'s 3600) is thrown with `retryAfterS` for the caller to show. 5xx are retried only for GET/PUT/DELETE, or a POST with a key. A POST without a key is never retried.
- **Idempotency** (`idempotency.ts`): every POST marked R or A in openapi.yaml gets a monotonic ULID key; a caller may pass its own. `Idempotency-Replayed: true` becomes `replayed: true`.
- **401**: `token_expired` calls `onUnauthorized` once and replays once. Concurrent requests share one refresh. Other 401 codes never refresh.
- **ETags**: remembered from GET/PATCH/PUT answers (up to 256 paths) and sent as `If-Match` on the next PATCH/PUT/DELETE of the same path.
- **Checks before sending**: JSON bodies over 256 KiB (1 MiB for `POST /v1/usage/events`) throw `RequestTooLargeError`; unknown query keys (so no `offset`, no `fields`), missing path parameters and wrong bodies throw `TypeError`.
- **Checks on answers**: every 2xx body is checked against the read-side shape of its OpenAPI schema (`validate.ts`): unknown fields and enum values pass (CT-VER), wrong types and missing required fields throw `ContractViolationError`. Answers over 8 MiB are refused.

## Errors

All extend the C006 `CentcomError`, so `userMessage()` and `nextAction()` work as they are.

| Error | When |
|---|---|
| `ApiError` | problem+json from the server. `code` (or `'unknown'` plus `rawCode`), `status`, `requestId`, `retryAfterS`, `fieldErrors`, `attempts`. |
| `AuthExpiredError` | a 401 `token_expired` the refresh did not fix (hook said no, threw, or the new token was refused). |
| `TransportError` | `transport`: `offline` (DNS/connection, after the retry budget), `timeout`, `aborted`, `tls`, `bad_response` (an HTML page from a proxy, malformed JSON). |
| `ContractViolationError` | a 2xx that does not fit the contract; carries `pointer` only. |
| `RequestTooLargeError` | refused locally before any I/O. |

No error carries a response body, a header value or a token.

## Logging

With a `logger`, one debug line per attempt: method, `route` (the path template, never the concrete path), status or transport kind, attempt, `duration_ms` and `request_id`. Nothing else.

## Generated table

`generated/operations.ts` is made from `contracts/openapi.yaml` by `scripts/gen-http.ts`: method, path, scopes, idempotency, auth, parameters, body limit, success statuses, the protocol type of each operation, and the read-side response shapes.

```sh
pnpm --filter @centcom/net gen:http           # after a contract change
pnpm --filter @centcom/net gen:http --check   # exit 1 when stale (CI runs this in tools/ci/gates.sh)
```

## Testing

Tests live in `packages/net/test/http/` and run offline against the C007 mock backend (`startMockBackend`) or a scripted `fetch`, with an injected clock that records every wait.

## Known gaps

- The operation shapes cover types and required fields, not formats or patterns (a tolerant reader does not need them).
- `openapi.yaml` and `schemas/release-manifest.schema.json` disagree (`min_supported_version` vs `min_supported`); the client follows openapi.yaml.
