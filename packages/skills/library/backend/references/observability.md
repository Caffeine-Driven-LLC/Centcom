# Observability

Structured logs with consistent fields and levels that mean something,
correlation and request IDs that survive hops, metrics using RED and USE
with naming and cardinality rules, distributed tracing with OpenTelemetry,
error tracking, what is worth alerting on (and what is not), and keeping
PII and secrets out of all of it. The goal: when something breaks at 3am,
the person on call can answer "what happened, to whom, where" from the
telemetry without redeploying with more logging.

## Contents

1. The three signals and what each is for
2. Structured logging
3. Log levels that mean something
4. Correlation: request IDs, trace IDs, and propagation
5. Metrics: RED, USE, naming, cardinality
6. Tracing with OpenTelemetry
7. Error tracking
8. Alerting: symptoms, not causes
9. Redaction of PII and secrets
10. Sampling, cost and retention
11. Per-stack setup pointers
12. Anti-patterns with fixes

## 1. The three signals and what each is for

- **Logs** answer "what exactly happened in this request/job?" Discrete
  events with context. Expensive per event; indexed by fields.
- **Metrics** answer "how is the system doing right now and over time?"
  Aggregated numbers (counters, gauges, histograms). Cheap; the basis of
  dashboards and alerts; cannot tell you about one request.
- **Traces** answer "where did the time go across services for this
  request?" A tree of spans with timing. The only signal that shows
  causality across hops.

They are joined by IDs: the trace ID appears in logs, and exemplars link
metrics to traces. Design for that join from the start: every log line in
a request carries the trace/request ID; every span carries the same
attributes you would filter logs by (`tenant_id`, `route`).

## 2. Structured logging

Emit JSON (one object per line) in production; a human-readable formatter
in development only. Every line has the same base fields; event-specific
fields are added as keys, never interpolated into the message.

Base fields (pick names once, use them everywhere, align with
OpenTelemetry semantic conventions where they exist):

| Field | Example | Notes |
|---|---|---|
| `timestamp` / `time` | `2026-10-07T14:03:00.123Z` | UTC, ISO 8601, ms precision |
| `level` | `info` | lowercase string |
| `message` / `msg` | `order created` | short, static, lowercase; no IDs embedded |
| `service.name` | `orders-api` | |
| `service.version` | `1.42.0` / git sha | |
| `deployment.environment` | `production` | |
| `trace_id`, `span_id` | hex | from the active span |
| `request_id` | uuid | same as `X-Request-Id` header |
| `http.method`, `http.route`, `http.status_code` | `POST`, `/orders/{id}`, `201` | `route` is the template, not the URL with IDs |
| `duration_ms` | `37` | number, not `"37ms"` |
| `user.id`, `tenant.id` | ids | IDs only, never names or emails |
| `error.type`, `error.message`, `error.stack` | | only on failures; stack only at `error` |

Rules:

- One request log line per request, emitted at the end by middleware,
  with method, route, status, duration, bytes, request ID, user/tenant.
  Not two (start and end) unless you need to detect hung requests; if
  so, make the start line `debug`.
- One line per job attempt, same idea.
- Business events worth searching for (`order created`, `payment
  captured`, `user invited`) at `info` with their IDs.
- Messages are constant strings so they can be grouped; variable data is
  in fields. `log.info({ orderId, total }, "order created")`, never
  `log.info(\`order ${orderId} created with total ${total}\`)`.
- Log the error object once, where it is handled (the top-level handler),
  with the stack. Do not log at every layer it passes through; wrap it
  with context instead and let the top log the chain.
- Request-scoped context (request ID, user, tenant) is bound once in
  middleware and inherited by every log call in that request via a child
  logger, `AsyncLocalStorage`, contextvars, MDC, `tracing` spans, or Go
  context + handler. Threading a logger through every function signature
  is a sign the repo lacks that mechanism; add it once.

## 3. Log levels that mean something

| Level | Meaning | Who looks | Example |
|---|---|---|---|
| `fatal` | Process cannot continue; exiting | Pager (via restart alerts) | Config missing at boot, cannot bind port |
| `error` | Something failed that should not have; a human should look eventually; counts toward error-rate alerts | On-call via alerts on rate | Unhandled exception (5xx), job dead-lettered, dependency circuit opened |
| `warn` | Unexpected but handled; might indicate a trend | Dashboards, weekly review | Retry succeeded on 2nd attempt, fallback used, deprecated endpoint called, slow query > threshold |
| `info` | Normal operation events worth having in an audit | Debugging a specific request | Request line, job completed, business event, startup/shutdown steps |
| `debug` | Developer detail | Developers, locally or temporarily enabled | Cache hit/miss per key, SQL text, payload summaries |
| `trace` | Firehose | Almost never | Every function entry |

The test for `error`: would you want to be woken up if this happened 100
times in a minute? If not, it is `warn`. A 4xx caused by the client is
`info` (it is in the request line) or `warn` if it indicates abuse; it is
never `error`. A 5xx is `error`. Expected domain failures ("insufficient
stock") are `info` events, not errors.

Default production level is `info`; `debug` is enabled per service or per
request (a header or flag checked by the logger) when investigating, not
globally. Make the level changeable at runtime (env var read on SIGHUP,
admin endpoint behind auth, or a config service) so you do not redeploy
to see more.

## 4. Correlation: request IDs, trace IDs, and propagation

- **Request ID**: accept `X-Request-Id` from a trusted proxy/load
  balancer if present (so the LB's logs join yours), otherwise generate a
  UUID (v4 or v7) at the edge. Echo it in the response header. Put it in
  the error envelope so a user report can be matched to logs.
- **Trace ID**: comes from the W3C `traceparent` header (`00-<trace-id>-
  <span-id>-<flags>`), created at the first service if absent. OpenTelemetry
  SDKs do the propagation on inbound and outbound HTTP, gRPC, and most
  queue clients automatically once instrumented.
- **Propagate outbound**: every outbound HTTP call, gRPC call, and queue
  message carries `traceparent` (and `X-Request-Id` for systems that log
  it). For jobs, store the trace context in the payload at enqueue and
  start the job span as a child (or a linked span if the job runs much
  later and a separate trace is clearer).
- **Log the trace ID**: configure the logger to include `trace_id` and
  `span_id` from the active context (pino with `@opentelemetry/
  instrumentation-pino`, structlog processor, Logback MDC via Micrometer
  Tracing, Go slog handler reading `trace.SpanFromContext`, `tracing-
  opentelemetry`). This is the join between logs and traces.
- Do not use the request ID as the trace ID; they have different
  lifetimes (a trace spans services and jobs, a request ID is one hop) and
  formats.

## 5. Metrics: RED, USE, naming, cardinality

**RED** for every request-serving thing (HTTP endpoint, gRPC method,
queue consumer): **R**ate (requests/s), **E**rrors (failed/s, and the
ratio), **D**uration (histogram; p50/p95/p99). **USE** for every resource
(CPU, memory, connection pool, queue, disk): **U**tilization (% busy),
**S**aturation (queue length / wait time), **E**rrors.

Minimum set for a service:

```
http_server_request_duration_seconds{method, route, status_code}   histogram  (RED for HTTP; rate and errors derive from it)
http_client_request_duration_seconds{peer, method, status_code}    histogram  (per dependency)
db_client_query_duration_seconds{operation, table}                 histogram
db_pool_connections{state="idle|in_use|waiting"}                   gauge
db_pool_acquire_wait_seconds                                       histogram
cache_requests_total{cache, result="hit|miss|stale|error"}         counter
job_duration_seconds{job_type, status}                             histogram
job_queue_depth{queue}                                             gauge
job_oldest_age_seconds{queue}                                      gauge
circuit_breaker_state{dependency}                                  gauge (0 closed, 1 half, 2 open)
process_* / runtime_*                                              from the runtime exporter
```

Naming: follow OpenTelemetry/Prometheus conventions (`snake_case`, unit
suffix `_seconds`/`_bytes`/`_total`, base units). Use histograms for
durations (so you can compute percentiles and SLO burn rates) with
buckets spanning your SLO (e.g. 5 ms to 10 s); counters for events;
gauges for current values. Never put percentiles in the service (summary
type) if you need to aggregate across instances.

Cardinality: labels multiply time series. Allowed: `route` (template),
`method`, `status_code` (or class `2xx`), `job_type`, `queue`, `dependency`,
`tenant_tier`. Not allowed as labels: user IDs, request IDs, raw URLs,
email addresses, tenant IDs when there are thousands, free text, anything
unbounded. A single unbounded label can take down your metrics backend.
Per-tenant metrics for many tenants belong in logs or a dedicated analytics
pipeline.

Business metrics (`orders_created_total{channel}`, `checkout_value_cents_
total`) are cheap and make incident impact legible ("orders dropped 40%"),
so add them for the core funnel.

## 6. Tracing with OpenTelemetry

Use OpenTelemetry (OTel) everywhere; it is vendor-neutral and exports to
Jaeger, Tempo, Honeycomb, Datadog, New Relic, X-Ray, Cloud Trace. Set up
once per service:

1. Install the SDK and auto-instrumentation for the stack (HTTP server
   and client, DB driver, Redis, queue client, gRPC). Auto-instrumentation
   gives you a span per inbound request, per outbound call, per query,
   with standard attributes, for near-zero code.
2. Configure resource attributes: `service.name`, `service.version`,
   `deployment.environment`. Export via OTLP to a collector (sidecar or
   gateway), not directly to a vendor from the app; the collector handles
   batching, retries, sampling and vendor routing.
3. Add manual spans around meaningful business steps that auto-
   instrumentation cannot see (`reserve_inventory`, `price_cart`, `render_
   invoice`), with attributes that you would filter by (`order.id`,
   `tenant.id`, `items.count`). Keep attribute cardinality sane (IDs are
   fine on spans; they are not metrics).
4. Record exceptions on spans (`span.recordException(e); span.setStatus
   (ERROR)`) at the point of handling.
5. Propagate context across async boundaries explicitly where the SDK
   cannot (queue payloads, custom thread pools, `Promise.all` is fine,
   worker threads need manual propagation).

```ts
// Node, instrumentation.ts loaded first via --require or --import
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";

export const otel = new NodeSDK({
  resource: resourceFromAttributes({ "service.name": "orders-api", "service.version": process.env.GIT_SHA, "deployment.environment": process.env.APP_ENV }),
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(Number(process.env.OTEL_SAMPLE_RATIO ?? 0.1)) }),
  instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })],
});
otel.start();

// manual span
const tracer = trace.getTracer("orders");
await tracer.startActiveSpan("reserve_inventory", { attributes: { "order.id": order.id, "items.count": items.length } }, async (span) => {
  try { await inventory.reserve(items); }
  catch (e) { span.recordException(e as Error); span.setStatus({ code: SpanStatusCode.ERROR }); throw e; }
  finally { span.end(); }
});
```

Python: `opentelemetry-distro` + `opentelemetry-instrument` CLI or
`FastAPIInstrumentor`, `DjangoInstrumentor`, `SQLAlchemyInstrumentor`,
`CeleryInstrumentor`. Go: `otelhttp.NewHandler`, `otelhttp.NewTransport`,
`otelsql`/`otelpgx`, manual `tracer.Start(ctx, "name")`. Java: the OTel
Java agent (`-javaagent:opentelemetry-javaagent.jar`) or Spring Boot's
Micrometer Tracing bridge. Ruby: `opentelemetry-sdk` + `opentelemetry-
instrumentation-all`. Rust: `tracing-opentelemetry`. PHP: `open-telemetry/
opentelemetry` with auto-instrumentation extensions.

Span naming: low-cardinality operation names (`GET /orders/{id}`, `SELECT
orders`, `reserve_inventory`), never with IDs in the name. Use the HTTP
route template, not the path.

## 7. Error tracking

Sentry, Bugsnag, Honeybadger, Rollbar, Datadog Error Tracking, GlitchTip:
they group exceptions by stack fingerprint, attach request context and
breadcrumbs, and alert on new or spiking issues. Set up once: DSN from
config, `release` = git sha, `environment`, user context limited to ID,
`beforeSend` scrubbing (section 9), and sampling for noisy errors.

Report unhandled exceptions (5xx) and dead-lettered jobs; do not report
expected 4xx or domain errors (filter `AppError` with status < 500, or
mark them `dontReport`). Link the issue to the trace (`trace_id` tag) and
the request ID. Treat the error tracker as a queue: triage new issues,
resolve or ignore, and alert on regressions.

## 8. Alerting: symptoms, not causes

Page on what users feel, not on every internal metric:

- **Error rate** over an SLO (e.g. > 1% of requests 5xx over 5 min; multi-
  window burn rate if you run SLOs properly).
- **Latency** p99 (or p95) over threshold on the key routes (e.g. checkout
  p99 > 2 s for 10 min).
- **Availability**: synthetic check on the health/readiness or a key
  endpoint failing from outside.
- **Saturation about to cause the above**: DB pool wait p99 > 500 ms, queue
  oldest-job age > N minutes for critical queues, disk > 85%, memory
  trending to OOM, certificate expiring in < 14 days.
- **Dead-letter queue non-empty / growing** for critical job types.
- **Business metric anomaly**: orders/min drops to zero during business
  hours (catches outages the error rate misses).

Tickets, not pages: elevated `warn` logs, single-instance restarts,
breaker opened and closed, non-critical queue lag, slow-query count.

Every alert has a runbook link, an owner, and a threshold someone can
defend. An alert that fires and is ignored twice gets deleted or fixed.
Test alerts by causing the condition in staging.

## 9. Redaction of PII and secrets

Telemetry is copied to vendors, retained for months, and searched by many
people. Treat it as semi-public.

- **Never log**: passwords, tokens, API keys, session IDs, cookies,
  `Authorization` headers, full card numbers, CVV, secrets of any kind,
  private keys, full request/response bodies by default.
- **Avoid logging**: emails, names, phone numbers, addresses, IPs (PII
  under GDPR), free-text user content. Log IDs; join to PII in the
  database with access control when needed.
- Allowlist the fields you log instead of denylisting. `log.info({ userId,
  orderId, total }, ...)` cannot leak the body. If you must log a
  structure, pass it through a redactor.
- Configure logger-level redaction as a backstop: pino `redact` paths,
  structlog processor, Logback `MaskingPatternLayout`, Rails `filter_
  parameters`, Laravel `Log` processors, slog `LogValuer`/`ReplaceAttr`,
  `tracing` field skipping. Known keys: `password, passwd, secret, token,
  authorization, cookie, set-cookie, api_key, apikey, access_token,
  refresh_token, card_number, cvv, ssn`.
- Error trackers: scrub headers and bodies in `beforeSend`; disable
  default PII capture (`sendDefaultPii: false`); send user ID only.
- Spans: do not put payloads or query parameters with user data in
  attributes; `db.statement` should be the parameterized SQL, not with
  values inlined (most instrumentations do this; check).
- URLs: strip query strings or specific params (tokens in links) before
  logging.
- Retention: set it (30-90 days for logs is typical) and have a deletion
  path for user-erasure requests if PII could have slipped through. The
  policy and the audit of existing leaks belong to `security`.

## 10. Sampling, cost and retention

- Logs: keep `info` and above in production; sample very high-volume
  `info` lines (health checks: do not log them at all; successful cache
  hits: `debug`). Dynamic sampling that keeps 100% of errors and slow
  requests and 1-10% of fast successes is ideal if the pipeline supports it.
- Traces: head sampling (ratio at the root, 1-10%) is simple; tail
  sampling (collector keeps all error/slow traces and a fraction of the
  rest) is far more useful and is a collector config, not app code.
  Always sample 100% in staging.
- Metrics: cheap unless cardinality explodes; watch series counts.
- Set budgets per signal and alert on ingestion spikes (a debug log left
  on in a hot loop can cost real money overnight).

## 11. Per-stack setup pointers

- Node: `pino` + `pino-http`, OTel Node SDK with auto-instrumentations,
  `prom-client` or OTel metrics, Sentry `@sentry/node`. Load instrumentation
  before any other import.
- Python: `structlog` (or `logging` + JSON formatter), OTel distro,
  `prometheus-client` or OTel metrics, `sentry-sdk` with framework
  integration. Django: `django-structlog`; FastAPI: a middleware binding
  contextvars.
- Go: `slog` with a context-aware handler, `otelhttp`/`otelsql`, Prometheus
  client or OTel metrics, `sentry-go`.
- Java/Kotlin: Logback + `logstash-logback-encoder` or Boot structured
  logging, Micrometer (metrics and tracing bridge to OTel), Actuator
  `/actuator/prometheus`, OTel Java agent, `sentry-spring-boot-starter`.
- Ruby: `lograge` or `rails_semantic_logger`, `opentelemetry-ruby`,
  `prometheus_exporter` or `yabeda`, `sentry-ruby`.
- PHP: Monolog JSON formatter + `Log::withContext`, OTel PHP, Prometheus
  via `promphp`, `sentry-laravel`.
- Rust: `tracing` + `tracing-subscriber` JSON, `tracing-opentelemetry`,
  `metrics` + `metrics-exporter-prometheus`, `sentry` crate with `tracing`
  integration.

In all cases: if the repo already has a logger, a metrics client or a
tracer, extend it. Adding a second one is the AI failure mode here.

## 12. Anti-patterns with fixes

- **`console.log` / `print` / `puts` in services.** Fix: the logger.
- **Interpolated messages** (`"user 42 logged in"`). Fix: static message +
  fields.
- **Logging the whole request/response body.** Fix: allowlisted fields;
  redaction backstop.
- **Everything at `error`**, or 4xx at `error`. Fix: section 3.
- **No request ID in error responses or logs.** Fix: middleware first in
  the chain; envelope includes it.
- **Request ID generated but not propagated** to outbound calls and jobs.
  Fix: client wrapper adds headers; job payload carries context.
- **Metrics with user ID or URL path as a label.** Fix: route template,
  bounded labels.
- **Percentiles computed in-process** (summaries) that cannot aggregate.
  Fix: histograms.
- **Tracing installed but no manual spans**, so every trace is "HTTP →
  SQL" with a 2 s gap in the middle. Fix: spans around business steps.
- **Health checks flooding the logs.** Fix: skip logging for probe paths.
- **Alerts on CPU %** that fire during deploys and never during outages.
  Fix: symptom-based alerts (section 8).
- **Error tracker spammed with 404s and validation errors.** Fix: filter
  by status / exception class.
- **Debug level in production permanently.** Fix: `info` default, runtime
  toggle.
- **Second logger/tracer added next to the existing one.** Fix: extend.
