# Webhooks and third-party integrations

Receiving webhooks (signature verification, idempotency, acknowledge fast
and process async, ordering and replay), sending webhooks (signing,
retries, delivery logs, endpoint management), and building clients for
third-party APIs (timeouts, rate limits, pagination, backoff, error
mapping, sandbox vs live). The common thread: the other side is outside
your control and will misbehave; design for it.

## Contents

1. Receiving webhooks: the shape of a correct handler
2. Signature verification per provider
3. Idempotency and ordering on receipt
4. Fast ack, async processing
5. Replay, backfill, and reconciliation
6. Sending webhooks: contract
7. Sending webhooks: signing, retries, delivery logs
8. Third-party API clients: structure
9. Rate limits, pagination, and backoff against providers
10. Sandbox, test mode, and fixtures
11. Observability for integrations
12. Anti-patterns with fixes

## 1. Receiving webhooks: the shape of a correct handler

```
POST /webhooks/stripe
  1. Read the raw body bytes (before any JSON parsing / body-parser middleware).
  2. Verify the signature over the raw body with the shared secret; reject 400/401 on failure.
  3. Check the timestamp in the signature for replay (tolerance 5 min).
  4. Parse JSON; extract event id and type.
  5. INSERT INTO webhook_events (provider, event_id, type, payload, received_at)
     ON CONFLICT (provider, event_id) DO NOTHING; if no row inserted → already seen → return 200.
  6. Enqueue ProcessWebhookEvent(provider, event_id) (same transaction if DB-backed queue; otherwise after commit).
  7. Return 200 (or 202) with an empty body. Total time < 1 s.
```

Everything that can be slow or fail (business logic, calls to other
systems, sending email) happens in the job. The HTTP handler's only jobs
are authenticate, dedupe, persist, enqueue, ack.

Node/Express with Stripe as the example (the raw-body requirement is the
most common bug):

```ts
// Register BEFORE express.json(), or use express.raw for this route only
app.post("/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res, next) => {
  try {
    const sig = req.get("stripe-signature");
    if (!sig) return res.status(400).end();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, config.stripeWebhookSecret);   // verifies HMAC + timestamp
    } catch {
      req.log.warn({ provider: "stripe" }, "webhook signature invalid");
      return res.status(400).end();
    }
    const inserted = await db.webhookEvents.insertIgnore({ provider: "stripe", eventId: event.id, type: event.type, payload: event, receivedAt: new Date() });
    if (inserted) await jobs.enqueue("process-webhook", { provider: "stripe", eventId: event.id }, { jobId: `wh:stripe:${event.id}` });
    res.status(200).end();
  } catch (e) { next(e); }   // 500 → provider retries, which is what we want for transient failures
});
```

Return 5xx only for failures where you want the provider to retry (DB
down). Return 2xx for duplicates and for events you do not handle (so the
provider stops sending them). Return 4xx for bad signatures (providers
usually stop retrying on 4xx; some disable the endpoint after many).

Payload size: cap it (1 MB is generous). Content type: accept what the
provider sends (`application/json`; some send form-encoded, e.g. Twilio).

## 2. Signature verification per provider

Always: HMAC over the exact raw bytes received, constant-time comparison
(`crypto.timingSafeEqual`, `hmac.compare_digest`, `subtle.ConstantTimeCompare`,
`MessageDigest.isEqual`, `ActiveSupport::SecurityUtils.secure_compare`,
`hash_equals`), timestamp tolerance to prevent replay, secret from config
(never from the payload or a header). Use the provider SDK's verifier when
one exists; it encodes their exact scheme.

| Provider | Header | Scheme | Notes |
|---|---|---|---|
| Stripe | `Stripe-Signature: t=...,v1=...` | HMAC-SHA256 over `${t}.${rawBody}` | SDK `constructEvent`; 300 s tolerance; one secret per endpoint |
| GitHub | `X-Hub-Signature-256: sha256=...` | HMAC-SHA256 over raw body | Also check `X-GitHub-Event` and `X-GitHub-Delivery` (id) |
| Shopify | `X-Shopify-Hmac-Sha256` | base64 HMAC-SHA256 over raw body with app secret | Also validate `X-Shopify-Shop-Domain` against the installed shop |
| Slack | `X-Slack-Signature: v0=...`, `X-Slack-Request-Timestamp` | HMAC-SHA256 over `v0:${ts}:${rawBody}` | 5 min tolerance; must respond in 3 s |
| Twilio | `X-Twilio-Signature` | HMAC-SHA1 over full URL + sorted form params, base64 | Use SDK `validateRequest`; URL must match exactly including scheme and port behind proxies |
| SendGrid | `X-Twilio-Email-Event-Webhook-Signature` + `-Timestamp` | ECDSA with their public key | SDK `EventWebhook` |
| Svix-based (Clerk, Resend, many) | `svix-id`, `svix-timestamp`, `svix-signature` | HMAC-SHA256 over `${id}.${ts}.${rawBody}`, base64, multiple `v1,` entries | `svix` library verifies and handles key rotation |
| Standard Webhooks spec | `webhook-id`, `webhook-timestamp`, `webhook-signature` | Same as Svix | Adopt this when *sending* |
| Paddle, Lemon Squeezy, Paypal, Square, Adyen | varies | HMAC or public-key | Read the doc; use the SDK |

If a provider offers no signature (some do not), restrict by source IP
allowlist (fragile) and/or require a secret token in the URL path or a
header you configured on their side, and treat the payload as a hint to
fetch the real state from their API rather than trust it.

Secret rotation: support two active secrets during rotation (verify
against either); the threat side (secret storage, exposure) is in
`security/references/`.

## 3. Idempotency and ordering on receipt

Providers retry on any non-2xx, on timeout (their timeout is often 5-30 s),
and sometimes spuriously. You will receive duplicates. Dedupe on the
provider's event ID with a unique constraint (section 1 step 5). If the
provider has no event ID, derive one: `sha256(provider + type + raw body)`
or a natural key (`invoice_id + status`).

Ordering is not guaranteed by any major provider: `invoice.paid` can
arrive before `invoice.created`; `customer.updated` events can arrive out
of order. Strategies:

- **Treat events as notifications, fetch truth**: on `invoice.paid`, call
  `GET /invoices/{id}` and reconcile your record with the current state.
  Idempotent, order-independent, costs one API call. The most robust
  pattern for state-bearing events.
- **Use the payload's version/timestamp**: ignore events whose
  `object.updated_at` (or a version) is older than what you have stored.
- **Buffer and reorder** by sequence when the provider gives one (rare).
- **Design handlers to converge**: `upsert` the state the event describes,
  with dependencies handled lazily (create the parent placeholder if the
  child arrives first).

Store the raw payload for a while (30-90 days) so you can reprocess after
a bug fix without asking the provider to resend.

## 4. Fast ack, async processing

The job that processes the event:

```python
@shared_task(bind=True, acks_late=True, autoretry_for=(TransientError,), retry_backoff=True, retry_jitter=True, max_retries=8)
def process_webhook_event(self, provider: str, event_id: str) -> None:
    ev = WebhookEvent.objects.get(provider=provider, event_id=event_id)
    if ev.processed_at:
        return
    handler = HANDLERS.get((provider, ev.type))
    if handler is None:
        ev.mark_ignored(); return
    with transaction.atomic():
        handler(ev.payload)                         # idempotent: upserts, converges to provider state
        ev.processed_at = now(); ev.save(update_fields=["processed_at"])
```

Per-event-type handlers are small functions in a registry; unknown types
are marked ignored (logged at `info`), not errors. Failures retry with
backoff; after max attempts the event is marked `failed` and an alert
fires (dead letter, see `jobs-and-async.md`). Provide an admin action to
reprocess by event ID or by type and time range.

Concurrency: two events for the same object processed in parallel can
race. Serialize per object key (queue concurrency keys, a row lock on
your record inside the transaction, or `SELECT ... FOR UPDATE` on the
local entity) when handlers are not naturally commutative.

## 5. Replay, backfill, and reconciliation

Webhooks will be missed (your endpoint was down beyond the provider's
retry window, a bug dropped them, the secret rotated badly). Build the
recovery paths:

- **Provider replay**: Stripe, GitHub, Shopify and others let you resend
  events from the dashboard or API; your dedupe makes this safe.
- **Backfill job**: a scheduled job that lists objects changed since the
  last successful sync (`GET /invoices?updated_since=...`) and runs the
  same converge logic. This is the safety net that makes webhooks "fast
  path" rather than "only path".
- **Reconciliation report**: periodically compare provider state to yours
  for the objects that matter (subscriptions, payouts) and alert on drift.

If your handler fetches truth from the API (section 3), replay and
backfill share its code.

## 6. Sending webhooks: contract

When your system emits webhooks to customers:

- Event envelope: `{ "id": "evt_...", "type": "order.paid", "created_at":
  "...", "api_version": "2026-10-01", "data": { ...object... } }`. Stable
  `type` names (`resource.verb`), the full object (or `id` + a fetch URL if
  payloads are large or sensitive), monotonically unique `id`.
- Endpoint management: customers register URLs (HTTPS only; validate the
  URL is not private/internal to prevent SSRF, see `security`), choose
  event types, get a signing secret shown once, can rotate it, can
  disable/enable, can see delivery logs and retry from the UI/API.
- Document: the signature scheme (adopt Standard Webhooks), retry
  schedule, timeout (e.g. 10 s), expected response (2xx, body ignored),
  ordering (none), duplicates (possible), IP ranges if you have stable
  egress, and a test event endpoint.

## 7. Sending webhooks: signing, retries, delivery logs

```ts
async function deliver(delivery: Delivery) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(delivery.event);
  const toSign = `${delivery.event.id}.${ts}.${body}`;
  const sig = crypto.createHmac("sha256", decode(delivery.endpoint.secret)).update(toSign).digest("base64");
  const res = await fetch(delivery.endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": delivery.event.id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}`, "user-agent": "example-webhooks/1.0" },
    body, signal: AbortSignal.timeout(10_000), redirect: "manual",          // never follow redirects (SSRF, credential leak)
  });
  await db.webhookDeliveries.insert({ eventId: delivery.event.id, endpointId: delivery.endpoint.id, attempt: delivery.attempt, status: res.status, responseSnippet: (await res.text()).slice(0, 1024), durationMs: ..., at: new Date() });
  if (res.status >= 200 && res.status < 300) return "delivered";
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return "failed_permanent";   // their bug; don't hammer
  throw new TransientDeliveryError(res.status);                                // → queue retry
}
```

Delivery is a job per (event, endpoint), retried with exponential backoff
over roughly a day: `1m, 5m, 30m, 2h, 5h, 10h, 24h` (Stripe retries for 3
days; GitHub does not retry at all; pick and document). After the final
failure mark the delivery failed and, after N consecutive failures across
events (e.g. 50 or 7 days), auto-disable the endpoint and notify the
customer by email. Resolve DNS and reject private ranges at delivery time
too (DNS rebinding); outbound egress through a fixed IP set if customers
want to allowlist.

Delivery logs (attempt, status, response snippet, duration) are what
customers debug with; expose them. Offer a "send test event" button and a
"retry this delivery" action. Fan-out: one job per endpoint, not one job
looping over all endpoints (a slow endpoint would delay the others).

## 8. Third-party API clients: structure

One module per provider that owns the HTTP details and exposes domain-
shaped methods; the rest of the codebase never sees the provider's HTTP.

```
integrations/stripe/
  client.ts        configured HTTP client: base URL, auth, timeouts, retries, user-agent, telemetry
  types.ts         response schemas (zod) for the subset of fields you use
  payments.ts      createPaymentIntent(), refund(): map to/from your domain, translate errors
  webhooks.ts      verification + handler registry
  __tests__/       recorded fixtures, failure cases
```

Rules:

- Use the official SDK when it is maintained and typed; it handles auth,
  retries, idempotency keys and pagination correctly. Wrap it anyway so
  you can swap, fake, and add timeouts (SDK defaults are often generous:
  Stripe Node 80 s).
- Validate responses against a schema for the fields you use; providers
  change shapes and send nulls. Tolerate unknown fields.
- Map provider errors to your domain errors in one place: `card_declined`
  → `PaymentDeclined` (a 4xx to your client, not a 500); 429/5xx/timeouts
  → `UpstreamUnavailable` (503 to your client, or a retry/job).
- Idempotency keys on every create/charge call (`Idempotency-Key`,
  Stripe's header, AWS `ClientToken`), derived deterministically from your
  operation (`order:{id}:charge`), so a retry after a timeout does not
  double-charge.
- Timeouts per call type (`resilience.md`): a payment confirmation may
  need 15-30 s; a lookup 3 s. Long operations go to a job.
- Secrets from config; per-environment keys (test vs live); never log the
  key, never log full request/response bodies (card data, PII).
- Instrument: a span per call with provider, operation, status; a
  histogram per provider; log failures with the provider's request ID
  header (`Request-Id`, `x-amzn-RequestId`, `X-GitHub-Request-Id`) so you
  can open a support ticket.

## 9. Rate limits, pagination, and backoff against providers

- **Read the limits** (per second, per minute, per endpoint, per account,
  concurrent). Encode them: a client-side token bucket sized a little under
  the documented limit, shared across your processes via Redis if you run
  several.
- **Honor response headers**: `Retry-After` (seconds or date),
  `X-RateLimit-Remaining`/`Reset`, GitHub's `x-ratelimit-*`, Shopify's
  leaky-bucket header, Stripe's 429 with no header (backoff). On 429:
  sleep for `Retry-After` (or exponential with jitter), then retry; in a
  job, reschedule for that delay instead of sleeping a worker.
- **Pagination**: follow the provider's model exactly (cursor `starting_
  after`/`next_cursor`, `Link` header with `rel="next"`, page tokens, or
  offset). Loop until no next; cap total pages for safety; persist the
  cursor for resumable backfills; respect rate limits inside the loop
  (do not fetch 500 pages at full speed).
- **Bulk endpoints** over per-item loops whenever the provider offers them
  (batch APIs, GraphQL for Shopify, bulk exports).
- **Caching** provider responses that change slowly (exchange rates,
  catalogs) with a TTL (`caching.md`) to stay under limits.
- **Backoff on 5xx and timeouts**: 2-3 attempts inline for reads; writes
  only with idempotency keys; longer retry via the queue for jobs.
- **Circuit breaker per provider** so an outage at the provider degrades
  your feature instead of exhausting your workers.

```go
func (c *Client) ListAllCustomers(ctx context.Context, fn func(Customer) error) error {
    cursor := ""
    for page := 0; page < 10_000; page++ {
        if err := c.limiter.Wait(ctx); err != nil { return err }              // golang.org/x/time/rate
        resp, err := c.listCustomers(ctx, cursor, 100)
        if err != nil { return fmt.Errorf("list customers page %d: %w", page, err) }
        for _, cu := range resp.Data { if err := fn(cu); err != nil { return err } }
        if !resp.HasMore { return nil }
        cursor = resp.Data[len(resp.Data)-1].ID
    }
    return errors.New("pagination exceeded safety cap")
}
```

## 10. Sandbox, test mode, and fixtures

- Separate credentials per environment; test-mode keys in development and
  CI, live keys only in production, enforced by config validation (a
  `sk_live_` key with `APP_ENV=development` should fail boot).
- Record real sandbox responses once as fixtures (VCR, `vcrpy`, `nock`
  recorder, `go-vcr`, WireMock recording) and replay in tests; refresh
  periodically. Never let the unit/integration suite call the real
  provider.
- Test the failure modes explicitly: timeout, 429 with `Retry-After`,
  500, malformed JSON, a response missing a field you rely on, a webhook
  with a bad signature, a duplicate webhook, an out-of-order webhook.
- Local webhook development: Stripe CLI `listen --forward-to`, `ngrok`/
  `cloudflared` tunnels, or the provider's "send test event" plus a script
  that signs a stored payload with your test secret and POSTs it to
  localhost.
- Contract drift: a nightly job in CI that hits the sandbox and validates
  response schemas catches provider changes before customers do.

## 11. Observability for integrations

Per provider: request rate, error rate by class (4xx/5xx/timeout/429),
latency histogram, breaker state, rate-limit remaining (gauge from
headers), webhook events received by type, processing lag (received →
processed), failed deliveries. Log the provider's request ID on every
error. Alert on: webhook processing lag > N minutes, dead-lettered webhook
events, provider error rate > X%, breaker open > Y minutes, outbound
delivery failure rate per endpoint spiking. Dashboards per integration
make "is it us or them" a 10-second question.

## 12. Anti-patterns with fixes

- **Parsing JSON before verifying the signature**, or verifying over the
  re-serialized body. Fix: raw bytes, verify first.
- **`==` string comparison of signatures.** Fix: constant-time compare.
- **No timestamp check** → replay. Fix: 5 min tolerance.
- **Processing the webhook inline**, taking 8 s, timing out at the
  provider, which retries, which runs it again concurrently. Fix: persist,
  enqueue, ack.
- **No dedupe** → double fulfillment on retry. Fix: unique (provider,
  event_id).
- **Trusting payload state and assuming order.** Fix: fetch truth or
  version-check; converge.
- **Returning 500 for unknown event types** → provider retries forever and
  disables you. Fix: 200 and ignore.
- **Webhook endpoint behind auth middleware** that expects a session.
  Fix: exclude the route; signature is the auth.
- **Following redirects / posting to arbitrary URLs when sending.** Fix:
  `redirect: manual`, SSRF validation, DNS re-check.
- **One job that loops over all customer endpoints.** Fix: a job per
  delivery.
- **SDK default timeouts (60-80 s) left in place.** Fix: configure per
  call type.
- **No idempotency key on charges.** Fix: deterministic key per operation.
- **Provider HTTP shapes leaking into the domain** (`stripe.Customer` in
  your `User` model). Fix: the integration module maps at the boundary.
- **Tests hitting the real sandbox on every run.** Fix: recorded fixtures;
  a separate nightly contract job.
- **Logging full provider responses** (PII, card metadata). Fix: log IDs
  and status.
- **Live key in `.env.example` or in CI.** Fix: test keys; config
  validation; `security` for secret handling.
