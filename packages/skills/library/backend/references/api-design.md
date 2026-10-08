# API design

How to shape an API so clients can use it for years: resource modeling and
naming, versioning, pagination, filtering, partial responses, an error
envelope clients can branch on (RFC 9457), idempotency keys, HTTP semantics
done correctly, and the conventions for GraphQL, gRPC, tRPC and OpenAPI.
Examples are mostly HTTP/JSON because that is where most mistakes happen.

## Contents

1. Choosing a style
2. Resource modeling and naming
3. HTTP semantics done right
4. Request and response shapes
5. Errors: RFC 9457 problem details
6. Pagination
7. Filtering, sorting, searching
8. Partial responses and expansion
9. Idempotency keys
10. Versioning
11. Concurrency control (ETags)
12. Long-running operations
13. GraphQL: schema design and N+1
14. gRPC and protobuf conventions
15. tRPC
16. OpenAPI as the contract
17. Anti-patterns with fixes

## 1. Choosing a style

| Situation | Choose | Why |
|---|---|---|
| Public API, third-party integrators, mobile + web clients | REST/JSON | Universally understood, HTTP caching works, curl-debuggable, every language has a client |
| Many clients with very different read shapes over a shared graph; a team that can own the server-side complexity | GraphQL | One round trip per screen, typed schema, introspection. Costs: N+1 risk, no HTTP caching by default, query complexity limits, auth per field |
| Internal service-to-service where you own both ends; streaming; polyglot | gRPC | Strict schema, codegen, binary, bidirectional streams. Costs: not browser-native (needs grpc-web or Connect), harder to debug by hand |
| TypeScript monorepo, one frontend, one backend, nobody else will call it | tRPC | End-to-end types with zero codegen. Costs: locks you to TS; the moment a non-TS client appears you need something else |
| Browser needs server push | SSE (one-way) or WebSocket (two-way) over the REST API | SSE is just HTTP, reconnects for free, works through proxies |

Mixing is normal: a REST public API, gRPC between internal services, SSE
for live updates. What is not normal is two styles for the same boundary.

## 2. Resource modeling and naming

Model nouns, not verbs. An endpoint is a resource with a state; HTTP
methods are the verbs. Start from the domain's entities and the client's
screens, then reconcile.

```
GET    /orders                 list
POST   /orders                 create
GET    /orders/{orderId}       read
PATCH  /orders/{orderId}       partial update
DELETE /orders/{orderId}       delete (or cancel, see below)
GET    /orders/{orderId}/items sub-collection when items only exist inside an order
```

Rules of thumb and why:

- Plural nouns, kebab-case for multi-word paths (`/shipping-addresses`),
  camelCase or snake_case in JSON (pick what the repo uses; never both).
- Nest only when the child cannot exist without the parent and you always
  have the parent ID. Two levels max; `/users/{id}/orders/{id}/items/{id}`
  is a sign to flatten to `/order-items/{id}`.
- IDs are opaque strings in the contract even if they are integers today.
  Prefer non-guessable IDs (UUIDv7, ULID, or prefixed like `ord_01H...`)
  for anything exposed; sequential IDs leak volume and invite enumeration
  (`security/references/` covers IDOR; the modeling choice is yours).
- State transitions that are not simple field updates get their own
  sub-resource or action endpoint: `POST /orders/{id}/cancel`, `POST
  /invoices/{id}/send`. Purists prefer `PATCH {status: "cancelled"}`;
  the action form is clearer when the transition has side effects or
  needs its own payload. Pick one convention per API.
- Avoid `GET /getOrders`, `POST /orders/create`, `/api/v1/doOrderThing`.
  The method is the verb.

A resource's representation is not the database row. Omit internal
columns, rename for the client's vocabulary, add computed fields the
client otherwise recomputes (`total`, `canCancel`). Decoupling the
representation from the schema is what lets you change the schema later.

## 3. HTTP semantics done right

| Method | Idempotent | Safe | Body | Success status |
|---|---|---|---|---|
| GET | yes | yes | no | 200 |
| HEAD | yes | yes | no | 200 |
| POST | no (unless idempotency key) | no | yes | 201 + `Location` for creation; 200 or 202 for actions |
| PUT | yes | no | full representation | 200 (or 204) replace; 201 if created |
| PATCH | not inherently | no | partial | 200 (or 204) |
| DELETE | yes | no | usually no | 204; 404 or 204 on repeat (decide; 204 is friendlier for retries) |

Status codes clients actually branch on; use them precisely:

- `200` OK with body. `201` created, with `Location` header and the created
  representation. `202` accepted for async work, with a status URL. `204`
  success with no body (do not send a body with 204).
- `400` malformed request (bad JSON, wrong type). `422` well-formed but
  semantically invalid (fails validation rules). Many APIs use 400 for
  both; consistency matters more than the distinction. Match the repo.
- `401` not authenticated (missing or invalid credentials; include
  `WWW-Authenticate`). `403` authenticated but not allowed. Some APIs
  return `404` for forbidden resources to avoid existence leaks; decide
  per API and document it.
- `404` not found. `405` method not allowed (include `Allow`). `406`/`415`
  content negotiation failures.
- `409` conflict with current state (duplicate unique key, state machine
  violation, stale ETag with `If-Match` fails as `412`). `410` gone.
- `429` rate limited, with `Retry-After`. `413` payload too large.
- `500` unexpected server error. `502`/`503`/`504` upstream problems;
  `503` with `Retry-After` during maintenance or overload.

Headers that matter: `Content-Type: application/json; charset=utf-8` on
every JSON response including errors (`application/problem+json` for RFC
9457). `Cache-Control` explicitly on every GET (`no-store` for private
data, `private, max-age=60` for per-user cacheable, `public, max-age=...`
for shared). `ETag` on single resources. `X-Request-Id` (or
`traceparent`) echoed on every response.

## 4. Request and response shapes

Request bodies: one JSON object, never a bare array (cannot be extended
later). Dates as ISO 8601 strings in UTC with offset (`2026-10-07T14:03:00Z`).
Money as integer minor units plus currency (`{"amount": 1999, "currency":
"USD"}`) or a decimal string, never a float. Enums as lowercase strings.
Booleans as booleans, not `"true"`.

Response bodies for single resources: the object itself at the top level
(`{ "id": ..., "status": ... }`). For lists: an envelope, because you will
need pagination metadata.

```json
{
  "data": [ { "id": "ord_01H...", "status": "paid" } ],
  "pageInfo": { "nextCursor": "eyJpZCI6...", "hasMore": true }
}
```

Nulls: include the field with `null` when the field exists but has no
value; omit fields the caller is not allowed to see. Do not make clients
guess between "absent" and "null" for the same field. Never change a
field's type across responses (sometimes string, sometimes number).

Additive changes (new optional fields, new enum values the client was told
to tolerate) are non-breaking. Removing or renaming a field, changing a
type, tightening validation, or changing a status code are breaking; see
Versioning.

## 5. Errors: RFC 9457 problem details

Use RFC 9457 (which obsoletes 7807) unless the repo has an envelope; then
match the repo exactly. The shape:

```json
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "2 fields are invalid.",
  "instance": "/orders",
  "code": "validation_error",
  "requestId": "req_7f3a...",
  "errors": [
    { "field": "items[0].qty", "code": "min", "message": "must be at least 1" },
    { "field": "email", "code": "format", "message": "must be a valid email" }
  ]
}
```

Design decisions and why:

- `type` is a stable URI identifying the error class; it does not have to
  resolve, but it is nice when it does. `code` is a shorter stable string
  for programmatic branching (`insufficient_stock`, `card_declined`).
  Clients branch on `code` or `type`, never on `detail` text.
- `title` is constant per type; `detail` is per occurrence and
  human-readable. Neither should leak internals (stack traces, SQL, file
  paths) in production.
- `errors[]` for field-level validation with `field` as a JSON pointer or
  dotted path matching the request body.
- Always include the request ID so a user report can be matched to a log.
- Every error, including those from framework defaults (404 for unknown
  route, 405, 415, JSON parse failure, auth middleware), must go through
  the same envelope. Register a global handler that catches everything and
  maps it; the catalogue of known domain errors maps to statuses, and
  anything unknown becomes a 500 with a generic detail and a logged stack.

A domain error type that carries its status and code is the simplest way
to keep this in one place:

```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) { super(message); }
}
export const notFound = (what: string) => new AppError("not_found", 404, `${what} not found`);
export const conflict = (code: string, msg: string) => new AppError(code, 409, msg);
```

And the single place that renders it (Express-flavored; every framework
has an equivalent, see the stack references):

```ts
app.use((err, req, res, _next) => {
  const requestId = req.id;
  if (err instanceof AppError) {
    return res.status(err.status).type("application/problem+json").json({
      type: `https://api.example.com/problems/${err.code}`,
      title: err.message, status: err.status, code: err.code,
      instance: req.originalUrl, requestId, errors: err.details,
    });
  }
  if (err instanceof ZodError) { /* map to 422 with errors[] */ }
  req.log.error({ err }, "unhandled error");
  res.status(500).type("application/problem+json").json({
    type: "about:blank", title: "Internal Server Error", status: 500, code: "internal", requestId,
  });
});
```

## 6. Pagination

Three shapes; choose by the data's properties.

**Cursor (keyset)**: default for anything unbounded or frequently
inserted. The cursor encodes the sort key of the last item (opaque to the
client; base64 of `{"createdAt": "...", "id": "..."}`). Stable under
inserts, O(1) per page with an index on the sort key, no "page 400 is
slow" problem. Cannot jump to page N; fine, nobody needs page 400.

```
GET /orders?limit=50&cursor=eyJjIjoiMjAyNi0xMC0wN1QxNDowMzowMFoiLCJpIjoib3JkXzAxSCJ9
→ { "data": [...], "pageInfo": { "nextCursor": "...", "hasMore": true } }
```

Server side: `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC,
id DESC LIMIT $3 + 1`, fetch one extra row to compute `hasMore`. The tie
breaker column (`id`) is mandatory or you will skip rows with equal
timestamps. Index design is in `database/references/`.

**Offset**: acceptable for small, admin-facing, or rarely changing sets
where "jump to page 7" matters. Always cap `limit` (e.g. max 100) and
offset (e.g. max 10,000) server side. Return `total` only if the count
query is cheap; on big tables it is not, so make it optional
(`?include=total`) or estimate.

**Page token with time bound**: for feeds, include a `since`/`until`
window with the cursor so very old pages can be rejected.

Always: default `limit` (20-50), hard max, `limit` validated as an integer,
sort order documented and stable, cursor tamper-safe (sign it or make it
harmless if edited; encoding is not security).

## 7. Filtering, sorting, searching

Filtering via query params on the collection: `GET
/orders?status=paid&customerId=cus_123&createdAfter=2026-01-01T00:00:00Z`.
Allowlist the filterable fields explicitly; each one should be backed by
an index or be combined with one that is. Do not expose a generic
`?where=` or `?filter[field][op]=value` grammar unless you can validate
it into a safe query (it becomes a DoS and injection surface).

Sorting: `?sort=-createdAt,total` (leading minus for descending) or
`?sort=createdAt&order=desc`. Allowlist sortable fields; the sort must be
compatible with the cursor (the cursor encodes the sort key).

Search: `?q=` for free text, delegated to the database's full-text search
or a search index, never `LIKE '%q%'` on a large table. Return
relevance-sorted results with cursor pagination.

Complex queries that do not fit a URL: `POST /orders/search` with a JSON
body, documented as a read (not cached by HTTP; fine).

## 8. Partial responses and expansion

Two problems: the client wants fewer fields (bandwidth) or more (avoid a
second round trip).

Sparse fieldsets: `?fields=id,status,total`. Implement by projecting the
serialized object; keep `id` always. Worth it for list endpoints on
mobile; skip it if nobody asked.

Expansion: `?expand=customer,items.product` (Stripe style). The unexpanded
form is the ID; the expanded form is the object. Cap depth at 2-3. This is
where N+1 appears: load expansions in batch (`WHERE id IN (...)`) per level,
not per item. In GraphQL this is the DataLoader problem (section 13).

## 9. Idempotency keys

For any POST that creates or charges, accept `Idempotency-Key: <uuid>`
from the client. Semantics (follow Stripe's, which clients know):

1. Key is scoped to the authenticated principal.
2. First request: process, store `{key, requestHash, status, responseBody}`
   with a TTL (24h is common), return the response.
3. Same key, same request body: return the stored response with the same
   status, do not reprocess.
4. Same key, different body: `422` with `code: "idempotency_key_reused"`.
5. Same key while the first is still in flight: `409` with `code:
   "idempotency_in_progress"` (acquire a lock on the key before processing).

Implementation sketch (store is Redis or a table; the lock and the insert
must be atomic):

```ts
async function withIdempotency(key: string, principal: string, body: unknown, run: () => Promise<Response>) {
  const scoped = `idem:${principal}:${key}`;
  const hash = sha256(stableStringify(body));
  const existing = await store.get(scoped);
  if (existing) {
    if (existing.hash !== hash) throw new AppError("idempotency_key_reused", 422, "Key reused with different payload");
    if (existing.state === "in_progress") throw new AppError("idempotency_in_progress", 409, "Request in progress");
    return existing.response;
  }
  const acquired = await store.setIfAbsent(scoped, { hash, state: "in_progress" }, ttlSeconds(86400));
  if (!acquired) throw new AppError("idempotency_in_progress", 409, "Request in progress");
  try {
    const response = await run();
    await store.set(scoped, { hash, state: "done", response }, ttlSeconds(86400));
    return response;
  } catch (e) {
    await store.delete(scoped); // let the client retry
    throw e;
  }
}
```

Where a natural key exists (external event ID, order number from the
client's system), use it as a unique constraint instead and translate the
unique violation into "already exists, return the existing one". Cheaper
and never expires.

## 10. Versioning

Honest ranking:

1. **Don't break.** Additive changes only; tolerant readers (clients ignore
   unknown fields, tolerate new enum values). Most APIs never need more.
2. **URL version** (`/v1/orders`). Ugly but explicit, cacheable,
   routable, visible in logs. The common choice for public APIs.
3. **Header version** (`Accept: application/vnd.example.v2+json` or a
   custom `Api-Version: 2026-10-01` date header, Stripe style). Cleaner URLs,
   harder to test with a browser, invisible in access logs unless you add
   it. Date-based versions pair well with per-account pinning.
4. **Query param** (`?version=2`). Avoid; it interacts badly with caching
   and gets dropped by clients.

When you must break: ship v2 alongside v1, run both, put a `Deprecation`
and `Sunset` header on v1 responses with a date, log usage per version
per client, and remove v1 only when the logs say nobody is left. Version
the whole API, not individual endpoints; per-endpoint versions multiply
the client's mental model.

Internal APIs between services you deploy together: do not version;
coordinate the deploy or use expand/contract (add the new field, migrate
consumers, remove the old).

## 11. Concurrency control (ETags)

For resources updated by multiple clients, return `ETag` on GET and
require `If-Match` on PUT/PATCH:

```
GET /documents/doc_1      → 200, ETag: "v17"
PATCH /documents/doc_1    If-Match: "v17"  → 200, ETag: "v18"
PATCH /documents/doc_1    If-Match: "v17"  → 412 Precondition Failed
```

Server side, the ETag is a version column or a hash of the row; the update
is `UPDATE ... WHERE id = $1 AND version = $2`, and zero rows affected
means 412. This is optimistic locking; the transaction-level detail is in
`database/references/`.

`If-None-Match` on GET gives you 304 Not Modified for free caching; see
`caching.md`.

## 12. Long-running operations

Anything over a few seconds does not belong in a request. Pattern:

```
POST /exports            → 202 Accepted
                           Location: /operations/op_123
                           { "id": "op_123", "status": "pending" }
GET  /operations/op_123  → 200 { "status": "running", "progress": 0.4 }
GET  /operations/op_123  → 200 { "status": "succeeded", "result": { "url": "..." } }
                           (or "failed" with a problem details object in "error")
```

The operation resource is a row the worker updates (`jobs-and-async.md`).
Offer a webhook or SSE stream for completion if clients would otherwise
poll aggressively; document a polling interval and return `Retry-After`.

## 13. GraphQL: schema design and N+1

Schema rules that age well:

- Nouns as types, verbs as mutations named `verbNoun` (`createOrder`,
  `cancelOrder`). One input object per mutation (`CreateOrderInput`), one
  payload type per mutation (`CreateOrderPayload { order, userErrors }`)
  so you can add fields later.
- Model expected failures as data (`userErrors: [UserError!]!` with
  `field` and `code`), not as GraphQL errors; GraphQL `errors[]` is for
  unexpected failures and auth. Clients handle both differently.
- Connections for lists (`orders(first: 50, after: $cursor): OrderConnection`)
  per the Relay spec; it is the one pagination shape every client library
  understands.
- Nullability is a contract: non-null (`!`) means "this will never be
  missing"; a non-null field that errors nulls its parent. Make
  leaf scalars non-null when the data guarantees it, keep object fields
  nullable when a resolver can fail independently.
- Never expose the ORM model as the type. Same reasoning as REST.

N+1 is the default behavior of a naive resolver: `orders { customer {
name } }` runs one customer query per order. The fix is a per-request
DataLoader that batches by key and caches within the request:

```ts
// loaders.ts: created once per request, attached to context
import DataLoader from "dataloader";
export const makeLoaders = (db: Db) => ({
  customerById: new DataLoader<string, Customer | null>(async (ids) => {
    const rows = await db.customers.findMany({ where: { id: { in: [...ids] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);     // must return same length, same order
  }),
});
// resolver
Order: { customer: (order, _args, ctx) => ctx.loaders.customerById.load(order.customerId) }
```

The batch function must return results in the same order as the keys,
with `null` or an `Error` instance for misses. Python: `aiodataloader` or
Strawberry's built-in `DataLoader`; Go: `gqlgen` with `dataloadgen`;
Ruby: `graphql-batch`; Java: `java-dataloader`.

Other required defenses: query depth limit (e.g. 10), complexity/cost
limit (assign weights to list fields), disable introspection in production
only if you have a reason (it mostly inconveniences your own team), set a
timeout per operation, persisted queries or an allowlist for public
clients, and `APQ` (automatic persisted queries) for cacheability.
Authorization is per field or per type via a directive or a middleware
that calls the same policy functions your REST layer uses.

## 14. gRPC and protobuf conventions

Follow the Google API Design Guide (AIP) conventions; clients and
generated code expect them.

```proto
syntax = "proto3";
package example.orders.v1;                    // version in the package

import "google/protobuf/timestamp.proto";
import "google/protobuf/field_mask.proto";

service OrderService {
  rpc GetOrder(GetOrderRequest) returns (Order);
  rpc ListOrders(ListOrdersRequest) returns (ListOrdersResponse);
  rpc CreateOrder(CreateOrderRequest) returns (Order);
  rpc UpdateOrder(UpdateOrderRequest) returns (Order);
  rpc WatchOrders(WatchOrdersRequest) returns (stream OrderEvent);
}

message Order {
  string name = 1;                            // "orders/{order}" resource name
  string id = 2;
  OrderStatus status = 3;
  google.protobuf.Timestamp create_time = 4;
  repeated LineItem items = 5;
}

enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;               // zero value is always UNSPECIFIED
  ORDER_STATUS_PENDING = 1;
  ORDER_STATUS_PAID = 2;
}

message ListOrdersRequest {
  int32 page_size = 1;
  string page_token = 2;
  string filter = 3;
}
message ListOrdersResponse {
  repeated Order orders = 1;
  string next_page_token = 2;
}
message UpdateOrderRequest {
  Order order = 1;
  google.protobuf.FieldMask update_mask = 2;  // partial updates
}
```

Why these: one request/response message per RPC so fields can be added;
field numbers are the wire contract (never reuse or renumber; `reserved`
removed ones); `snake_case` fields; enums prefixed with the type name and
a zero `UNSPECIFIED`; `Timestamp` and `Duration` over ints; `FieldMask`
for PATCH semantics; `page_token` pagination.

Errors: return `google.rpc.Status` codes (`NOT_FOUND`, `INVALID_ARGUMENT`,
`ALREADY_EXISTS`, `FAILED_PRECONDITION`, `PERMISSION_DENIED`,
`UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`)
with `google.rpc.ErrorInfo`/`BadRequest` details for field errors. Map them
1:1 to HTTP when you expose a gateway.

Deadlines propagate: every client call sets one, every server reads
`ctx.Done()`/`context.deadline()` and stops work. Use `buf` for linting
and breaking-change detection in CI. For browsers, use Connect
(connectrpc) or grpc-web; plain gRPC does not work from a browser.

## 15. tRPC

```ts
export const orderRouter = router({
  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => getOrder(ctx.actor, input.id)),   // use case, not inline logic
  create: protectedProcedure
    .input(createOrderSchema)
    .mutation(({ ctx, input }) => createOrder(ctx.actor, input)),
});
```

The procedure is a transport adapter like any handler: input schema in,
use case call, nothing else. Throw `TRPCError({ code: "NOT_FOUND" })` from
an error mapper, not ad hoc; tRPC codes map to HTTP statuses. Use
`protectedProcedure` middleware for auth so every procedure does not
repeat it. Keep routers per domain, merged at the root. If a non-TS
client ever appears, put a REST layer in front of the same use cases;
the use cases should not know they were called from tRPC.

## 16. OpenAPI as the contract

Two workflows; pick the one the repo already uses.

**Spec-first**: `openapi.yaml` is the source of truth. Generate server
stubs/types (`openapi-typescript`, `oapi-codegen` for Go, `openapi-
generator` for Java/Kotlin, `datamodel-code-generator` for Python) and
client SDKs. Validate requests against the spec at runtime in dev/test
(`express-openapi-validator`, `connexion`, `kin-openapi`). Breaking-change
detection in CI with `oasdiff`.

**Code-first**: the framework emits the spec from types and decorators
(FastAPI from pydantic, NestJS `@nestjs/swagger`, Fastify with
`@fastify/swagger` from JSON schemas, `springdoc`, `rswag`, `utoipa` for
Rust). Commit the generated spec and diff it in CI so changes are reviewed.

Either way: every response including errors is documented (reference a
shared `ProblemDetails` schema); examples are real; `operationId`s are
stable because generated clients name methods after them; security
schemes are declared; the spec is served at `/openapi.json` and a UI at
`/docs` in non-production (or behind auth).

## 17. Anti-patterns with fixes

- **Verbs in paths** (`/createUser`). Fix: `POST /users`.
- **200 with `{success: false}`**. Fix: status codes plus problem details.
- **Different error shapes from different layers** (framework 404 is
  HTML, validation is `{errors}`, domain is `{message}`). Fix: one global
  handler that renders everything through the envelope.
- **Bare array response**. Fix: `{data: [...], pageInfo}`.
- **Offset pagination with no cap**. Fix: cursor, capped limit.
- **Floats for money, local-time strings for dates**. Fix: minor units +
  currency; ISO 8601 UTC.
- **`?filter=` free-form grammar passed to the ORM**. Fix: allowlisted
  params.
- **Exposing DB rows directly** (including `password_hash`, `internal_
  notes`). Fix: an explicit serializer per representation.
- **GET with side effects** (`GET /orders/1/cancel`). Crawlers and
  prefetchers will trigger it. Fix: POST.
- **PUT that behaves like PATCH** (ignores missing fields). Fix: PATCH, or
  document PUT as full replacement and enforce it.
- **Versioning in a panic** (`/v2` for one field). Fix: additive change.
- **GraphQL mutations returning the bare type** so errors cannot be
  expressed. Fix: payload type with `userErrors`.
- **GraphQL resolvers hitting the DB per item**. Fix: DataLoader per
  request.
- **Proto fields renumbered or reused**. Fix: `reserved`, append only.
- **Idempotency key ignored on retry** (second request creates a second
  charge). Fix: section 9.
