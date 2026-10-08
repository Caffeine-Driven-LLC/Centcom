# Resilience

Timeouts everywhere with actual numbers, retries that respect a budget,
circuit breakers, bulkheads, backpressure and load shedding, graceful
degradation, health and readiness probes that mean something, and the
exact sequence a process should follow when told to stop. Code in several
stacks because the defaults are wrong in all of them.

## Contents

1. The failure model you are designing for
2. Timeouts: every call, with numbers
3. HTTP client configuration per stack
4. Retries with budgets
5. Circuit breakers
6. Bulkheads and connection pools
7. Backpressure and load shedding
8. Graceful degradation and fallbacks
9. Health and readiness
10. Shutdown sequencing
11. Serverless and edge specifics
12. Testing resilience
13. Anti-patterns with fixes

## 1. The failure model you are designing for

Dependencies fail in three ways, and the second is the dangerous one:

1. **Fast failure**: connection refused, immediate 500. Cheap; your error
   handling catches it.
2. **Slow failure**: the dependency accepts the connection and never
   answers, or answers in 30 seconds. Each waiting request holds a thread,
   a connection, a goroutine, memory. Under load, your service runs out of
   those and fails for everyone, including requests that never touched
   the slow dependency. This is how one degraded downstream takes out an
   entire system.
3. **Partial / wrong**: returns 200 with stale or malformed data. Validate
   responses; treat schema violations as errors.

Everything below is about converting slow failures into fast ones
(timeouts), not amplifying them (retry budgets, breakers), containing
them (bulkheads), and staying partially useful (degradation).

## 2. Timeouts: every call, with numbers

Every outbound call needs a deadline. The default in most clients is
"forever" (Node `fetch`/undici, Python `requests`, Go `http.DefaultClient`,
Java `RestTemplate` from `new`, PHP `Http` 30s, Ruby `Net::HTTP` 60s open/
read). Set them explicitly.

Starting numbers; tune from p99 of the dependency plus margin, not from
hope:

| Call type | Connect | Read / total | Notes |
|---|---|---|---|
| Internal service, same region | 200-500 ms | 1-3 s | p99 of a healthy internal API is usually < 500 ms |
| Third-party API (payments, email) | 1 s | 5-10 s | Check their SLA; Stripe recommends 30s+ for some calls but that belongs in a job |
| Database query (OLTP) | pool acquire 1-3 s | statement 1-5 s | `statement_timeout` at the connection; longer per query for reports |
| Cache (Redis/Memcached) | 100-200 ms | 50-200 ms | A slow cache is worse than no cache; fail open to the origin |
| Queue publish | 500 ms | 1-2 s | Or use the outbox and never publish inline |
| DNS | system default (~5 s) | n/a | Cache; consider a local resolver |
| Inbound request (server-side) | n/a | 10-30 s total | Set at the server; longer work goes to a job |

Deadline propagation: the inbound request has a budget (say 10 s). Each
outbound call gets `min(its own timeout, remaining budget)`. Go's
`context` does this natively; gRPC propagates deadlines; in other stacks,
compute `remaining = deadline - now()` and pass it. A call that would not
finish inside the remaining budget should fail immediately rather than
start.

Distinguish connect timeout (network reachability, short) from read/
response timeout (the dependency's work) from total timeout (the whole
exchange including retries). Set all three where the client allows.

## 3. HTTP client configuration per stack

One configured client instance per dependency, reused (connection pool,
keep-alive), with timeouts, a bounded pool, and a `User-Agent` that
identifies you.

Node (undici / fetch):

```ts
import { Agent, fetch } from "undici";
const stripeAgent = new Agent({ connect: { timeout: 1_000 }, headersTimeout: 5_000, bodyTimeout: 5_000, connections: 50 });

export async function stripeFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(init.timeoutMs ?? 5_000), init.signal].filter(Boolean) as AbortSignal[]);
  return fetch(`https://api.stripe.com${path}`, { ...init, dispatcher: stripeAgent, signal });
}
```

Python (httpx):

```python
timeout = httpx.Timeout(connect=1.0, read=5.0, write=5.0, pool=1.0)
limits = httpx.Limits(max_connections=50, max_keepalive_connections=20)
stripe = httpx.AsyncClient(base_url="https://api.stripe.com", timeout=timeout, limits=limits, headers={"User-Agent": "orders-api/1.0"})
# requests: session.get(url, timeout=(1.0, 5.0)) on every call; mount HTTPAdapter(pool_maxsize=50)
```

Go:

```go
var stripeClient = &http.Client{
    Timeout: 8 * time.Second,                       // total, including redirects and body read
    Transport: &http.Transport{
        DialContext:           (&net.Dialer{Timeout: 1 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
        TLSHandshakeTimeout:   2 * time.Second,
        ResponseHeaderTimeout: 5 * time.Second,
        MaxIdleConns:          100,
        MaxIdleConnsPerHost:   50,                  // default is 2; fan-out starves on it
        IdleConnTimeout:       90 * time.Second,
    },
}
// per call: ctx, cancel := context.WithTimeout(ctx, 5*time.Second); req, _ := http.NewRequestWithContext(ctx, ...)
```

Java (Spring `RestClient`):

```java
@Bean RestClient stripeClient(RestClient.Builder b) {
    var f = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build());
    f.setReadTimeout(Duration.ofSeconds(5));
    return b.baseUrl("https://api.stripe.com").requestFactory(f).build();
}
```

Ruby: `Faraday.new(url:) { |f| f.options.open_timeout = 1; f.options.timeout
= 5; f.adapter :net_http_persistent }`. PHP: `Http::connectTimeout(1)->
timeout(5)`. Rust: `reqwest::Client::builder().connect_timeout(1s).timeout
(5s).pool_max_idle_per_host(50).build()`.

## 4. Retries with budgets

Retry when the operation is idempotent (GET, PUT, DELETE, POST with an
idempotency key) and the failure is transient: connect errors, timeouts
(careful: a timed-out POST may have succeeded), 408, 425, 429, 500, 502,
503, 504. Never retry 400, 401, 403, 404, 409, 422, or on business errors.

Policy: 2-3 attempts total for synchronous calls (the user is waiting;
more attempts just add latency), exponential backoff with full jitter
(`random(0, base * 2^n)`, base 100-200 ms, cap 1-2 s), honor `Retry-After`
when present, and a total time cap that fits the remaining request
budget.

Retry budget: retries across the whole service to one dependency should
not exceed ~10-20% of first attempts. When the dependency is down, naive
retries triple its load and your latency. Implement as a token bucket per
dependency (each first attempt adds 0.1-0.2 tokens, each retry consumes
1) or let a circuit breaker do it. Libraries: `cockatiel` (Node), `tenacity`
(Python), `hashicorp/go-retryablehttp` or `cenkalti/backoff` (Go),
`resilience4j-retry` (Java), `faraday-retry` (Ruby), `reqwest-retry`
(Rust), Laravel `Http::retry(2, 200, throw: false, when: ...)`.

```ts
import { retry, ExponentialBackoff, handleWhen } from "cockatiel";
const transient = handleWhen((e) => e instanceof TimeoutError || (e instanceof HttpError && [429, 502, 503, 504].includes(e.status)));
export const retryPolicy = retry(transient, { maxAttempts: 3, backoff: new ExponentialBackoff({ initialDelay: 150, maxDelay: 1500 }) });
// await retryPolicy.execute(({ signal }) => stripeFetch("/v1/charges", { method: "POST", signal, headers: { "Idempotency-Key": key } }))
```

```python
from tenacity import retry, stop_after_attempt, wait_random_exponential, retry_if_exception_type

@retry(stop=stop_after_attempt(3), wait=wait_random_exponential(multiplier=0.15, max=1.5),
       retry=retry_if_exception_type((httpx.ConnectError, httpx.ReadTimeout, TransientHTTPError)), reraise=True)
async def get_price(sku: str) -> Price: ...
```

In background jobs, retries are the queue's job (`jobs-and-async.md`), not
an inner loop; do one attempt per job execution and let the queue
reschedule with its backoff.

## 5. Circuit breakers

A breaker tracks failures to a dependency and, when they exceed a
threshold, stops calling it for a cooling period (fail fast), then lets a
trial request through (half-open) before resuming. It protects your
service from slow failures and gives the dependency room to recover.

Parameters that work as a start: window 10-30 s or last 20-50 calls;
open when failure rate ≥ 50% with at least 10-20 calls in the window
(avoid opening on 1 of 2); open duration 10-30 s; half-open allows 1-3
trial calls. Count timeouts as failures. Do not count 4xx as failures
(the dependency is healthy; your request is wrong), except 429 if you
want to back off.

Libraries: `cockatiel`/`opossum` (Node), `pybreaker`/`aiobreaker` (Python),
`sony/gobreaker` (Go), `resilience4j-circuitbreaker` (Java), `circuitbox`/
`stoplight` (Ruby), `failsafe-rs` (Rust), Laravel has none built in (use
Redis counters or `ackintosh/ganesha`).

```go
var pricingBreaker = gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "pricing",
    MaxRequests: 2,                                  // half-open trials
    Interval:    30 * time.Second,                   // counts reset window
    Timeout:     15 * time.Second,                   // open → half-open
    ReadyToTrip: func(c gobreaker.Counts) bool { return c.Requests >= 20 && float64(c.TotalFailures)/float64(c.Requests) >= 0.5 },
    OnStateChange: func(name string, from, to gobreaker.State) { slog.Warn("breaker state change", "name", name, "from", from.String(), "to", to.String()) },
})

func GetPrice(ctx context.Context, sku string) (Price, error) {
    v, err := pricingBreaker.Execute(func() (any, error) { return pricingClient.Get(ctx, sku) })
    if errors.Is(err, gobreaker.ErrOpenState) { return cachedOrDefaultPrice(sku), nil }   // degrade (section 8)
    ...
}
```

One breaker per dependency (or per dependency × operation if operations
have different health). Expose the state as a metric and log transitions.
A service mesh (Istio outlier detection) or an API gateway can provide
breakers at the network level; in-process breakers still help because
they know about your fallbacks.

## 6. Bulkheads and connection pools

A bulkhead limits how much of your capacity one dependency or one class
of work can consume, so a slow dependency cannot drain everything.

- **Per-dependency connection pools and concurrency limits**: the HTTP
  client's pool size (section 3) is a bulkhead; also cap in-flight calls
  with a semaphore (`p-limit`, `asyncio.Semaphore`, `golang.org/x/sync/
  semaphore`, `resilience4j-bulkhead`, `tokio::sync::Semaphore`). When the
  limit is hit, fail fast (503 or fallback) rather than queue indefinitely.
- **Separate thread/worker pools** for different work classes (Java
  executor per dependency; Celery/Sidekiq queues with dedicated workers;
  Go worker pools sized per task type).
- **Database pool sizing**: the DB has a connection limit (Postgres
  default 100, less usable). `pool size × process count × replicas` must
  fit under it with headroom for migrations and admins. A pool of 10 per
  process is a good default; more connections do not make a saturated
  database faster. Use a pooler (PgBouncer, RDS Proxy, Supavisor) when
  many processes or serverless functions connect. Set an acquire timeout
  (1-3 s) so pool exhaustion surfaces as a fast 503 instead of a hang.
- **Separate read and write paths** (replica for heavy reads) when reads
  threaten the primary; the app must tolerate replica lag.

## 7. Backpressure and load shedding

When demand exceeds capacity, queue depth grows, latency climbs past
timeouts, and every request fails slowly. Better to reject some requests
fast and serve the rest well.

- **Bound every queue**: HTTP server accept backlog and max concurrent
  requests (Node has none by default: use `toobusy-js`-style event-loop
  lag checks or a concurrency limiter; Go `netutil.LimitListener` or a
  semaphore middleware; Java Tomcat `max-threads`/`accept-count`; Gunicorn
  `--backlog`; Rust `tower::limit::ConcurrencyLimitLayer` + `LoadShedLayer`).
  Return 503 with `Retry-After: 1-5` when full.
- **Rate limiting** per client/key/IP (token bucket or sliding window in
  Redis; `rate-limiter-flexible`, `slowapi`/`django-ratelimit`, `ulule/
  limiter`, `bucket4j`, `rack-attack`, Laravel `throttle`, `tower_governor`)
  returns 429 with `Retry-After` and `RateLimit-*` headers. Limits per
  endpoint class: login attempts (5/min/IP + 10/hour/account), writes
  (60/min/user), reads (600/min/user), unauthenticated (30/min/IP) as a
  starting point; tune from traffic.
- **Priority shedding**: under pressure, shed cheap-to-drop traffic first
  (analytics beacons, prefetches, non-critical background sync) and keep
  checkout and auth. Identify request class in middleware.
- **Adaptive concurrency** (Netflix `concurrency-limits`, Envoy adaptive
  concurrency) adjusts the limit from observed latency; valuable at scale,
  overkill for most services.
- **Queue-level backpressure**: bounded channels (Go, Rust `mpsc`
  bounded), bounded executors (Java `ThreadPoolExecutor` with a bounded
  queue and `CallerRunsPolicy` or abort), consumer prefetch limits
  (RabbitMQ `prefetch`, Kafka `max.poll.records`).

Clients receiving 429/503 should back off with jitter; document that in
your API.

## 8. Graceful degradation and fallbacks

When a dependency is unavailable, decide per feature what the product
does, and encode it:

- **Serve stale**: cache with stale-while-revalidate/stale-if-error
  (`caching.md`); show the last known price with a "may be outdated" flag.
- **Default or skip**: recommendations service down → show bestsellers or
  hide the module; fraud scoring down → queue for manual review instead
  of blocking checkout (or block, if that is the business rule; it is a
  product decision, so ask when unclear).
- **Partial response**: return the order without the shipping estimate
  and a `warnings: ["shipping_estimate_unavailable"]` field, rather than
  failing the whole request.
- **Queue for later**: the write that must happen (send to warehouse)
  becomes a job that retries; the user gets 202.
- **Feature flag kill switch**: a flag that disables a dependency's
  integration without a deploy (`config-and-environments.md`).

Fallbacks must be cheaper and more reliable than the primary (a fallback
that calls another flaky service is not a fallback), and must be tested,
or they will fail the first time they are needed. Log and count every
fallback activation so degraded operation is visible.

## 9. Health and readiness

Two different questions, two endpoints:

- **Liveness** (`/healthz`, `/livez`): "should the orchestrator restart
  me?" Returns 200 if the process is running and the event loop/thread
  pool is responsive. Checks nothing external (a dependency outage must
  not cause a restart storm). Cheap, no auth, no logging per hit.
- **Readiness** (`/readyz`): "should the load balancer send me traffic?"
  Returns 200 only if the process can serve: config loaded, DB pool
  connected (a lightweight `SELECT 1` with a 1 s timeout, cached for a
  few seconds), required caches/queues reachable if truly required,
  migrations at the expected version, warm-up done. Returns 503 during
  startup and during shutdown. Dependencies that have a fallback are
  *not* readiness-blocking.
- **Startup probe** (Kubernetes) for slow-booting apps so liveness does
  not kill them during JIT warm-up or cache load.

Response body: `{ "status": "ok" | "degraded" | "fail", "checks": { "db":
{ "status": "ok", "latency_ms": 3 }, ... }, "version": "...", "uptime_s":
... }`. Do not expose internal hostnames or config publicly; restrict
detailed health to an internal network or auth. Set probe timeouts and
thresholds in the orchestrator (period 10 s, failure threshold 3) so one
slow check does not flap. Deep "all dependencies" checks belong in a
separate monitoring job, not in the readiness probe.

## 10. Shutdown sequencing

The platform sends SIGTERM, waits a grace period (Kubernetes default 30 s,
Heroku 30 s, ECS `stopTimeout` default 30 s, Lambda none), then SIGKILL.
Your sequence must finish inside it:

1. **Catch SIGTERM** (and SIGINT for local). Ignore a second signal or
   treat it as "force".
2. **Flip readiness to 503** so the load balancer stops sending new
   requests. Keep *serving* for a few seconds (2-5 s; Kubernetes
   `preStop` sleep or an in-app delay) because the endpoint removal
   propagates asynchronously; closing the listener immediately causes
   connection refused for in-flight routing.
3. **Stop accepting** new connections; close idle keep-alive connections
   (Node `server.closeIdleConnections()`, Go `srv.Shutdown`, Tomcat
   graceful shutdown, Uvicorn/Gunicorn graceful timeout).
4. **Drain in-flight requests** with a cap (e.g. 20 s). Requests that run
   past it get a 503 (or are abandoned; log them).
5. **Stop workers**: stop fetching jobs, finish or release the current
   one, stop schedulers.
6. **Flush**: telemetry (OpenTelemetry `shutdown`), logs, metrics push,
   outbox relay.
7. **Close**: DB pools, Redis, broker connections, file handles.
8. **Exit 0**. A forced-exit timer (grace period minus 5 s) exits 1 if
   anything hangs.

Total budget example on a 30 s grace period: 3 s drain delay + 20 s
request drain + 5 s close + 2 s margin. If the platform's grace period is
shorter than your worst-case request, raise `terminationGracePeriodSeconds`
or shorten the requests.

Stack snippets: Node and Go are in their references; Spring `server.
shutdown=graceful` + `spring.lifecycle.timeout-per-shutdown-phase=25s`;
Uvicorn `--timeout-graceful-shutdown 25`; Gunicorn `--graceful-timeout 25`;
Puma `-t` with `worker_shutdown_timeout`; Laravel Octane `--max-requests`
and `octane:reload`; Sidekiq `-t 25`.

## 11. Serverless and edge specifics

- No long-lived process: pools do not persist reliably; use a pooler
  (RDS Proxy, PgBouncer, Neon/Supabase poolers, Cloudflare Hyperdrive) or
  an HTTP-based data API.
- Cold starts: keep bundles small, initialize lazily, use provisioned
  concurrency for latency-sensitive paths.
- Hard execution caps (Lambda 15 min, Vercel 10-300 s, Workers CPU ms):
  long work goes to a queue (SQS → Lambda, QStash, Inngest).
- Retries are often built in (SQS/EventBridge → Lambda retries on error):
  your function must be idempotent.
- Timeouts: the function's own timeout must exceed your outbound
  timeouts plus margin, and the API gateway's timeout (often 29-30 s)
  bounds everything.
- `context.waitUntil` / background promises for post-response work are
  best effort; use a queue for anything that must happen.

## 12. Testing resilience

- **Timeout test**: point the client at a stub that sleeps longer than the
  timeout (`httptest` handler with `time.Sleep`, WireMock `withFixedDelay`,
  `respx` with a side effect raising `ReadTimeout`, `nock` with `.delay()`)
  and assert the call fails within timeout + margin with the mapped error.
- **Retry test**: stub returns 503 then 200; assert exactly two calls and
  the second's idempotency key equals the first's. Stub returns 400;
  assert one call.
- **Breaker test**: drive N failures, assert the next call fails fast
  without hitting the stub, advance time, assert half-open trial.
- **Shutdown test**: start the app, begin a slow request, send SIGTERM,
  assert the request completes and the process exits 0 within the budget;
  assert a new connection during drain is refused or 503.
- **Fault injection in staging**: Toxiproxy or `tc netem` to add latency
  and drop connections to a dependency and watch the dashboards; chaos
  tooling (Litmus, Gremlin) if the organization uses it.
- **Load test** (k6, Locust, vegeta, Gatling) to find the concurrency at
  which latency breaks, and set limits below it.

## 13. Anti-patterns with fixes

- **No timeout** on an outbound call. Fix: section 2 and 3; grep for every
  client construction and every call site.
- **Timeout longer than the caller's budget** (10 s outbound inside a 5 s
  request). Fix: propagate deadlines.
- **Retrying non-idempotent POSTs** without idempotency keys. Fix: keys,
  or do not retry.
- **Retrying forever / fixed delay / no jitter.** Fix: 2-3 attempts,
  exponential with full jitter, budget.
- **Retry inside a job handler** in addition to the queue's retry. Fix:
  one attempt per execution.
- **Breaker that opens on the first failure** or counts 4xx. Fix: minimum
  volume and failure rate.
- **One shared thread pool / connection pool for everything.** Fix:
  bulkheads per dependency.
- **Unbounded in-memory queues** (`[]` that grows, unbounded channels,
  unbounded executors). Fix: bound and shed.
- **Liveness probe that checks the database** → restart storm during a DB
  blip. Fix: liveness checks only the process.
- **Readiness that never goes false during shutdown.** Fix: flip it first.
- **`process.exit()` on SIGTERM** → dropped in-flight requests and jobs.
  Fix: section 10.
- **Fallback never exercised** until production. Fix: test it; flag it;
  count it.
- **Pool size = 100 because "more is faster".** Fix: 10 per process,
  measured; a pooler.
