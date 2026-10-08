---
name: backend
description: >
  Backend engineering judgment for any server-side code: API design (REST,
  GraphQL, gRPC, tRPC), request validation and error contracts, auth and
  session implementation, authorization (RBAC/ABAC/ReBAC), service
  architecture and layering, background jobs, queues and scheduling,
  idempotency, retries, timeouts, circuit breakers, caching, transactions
  from the app side, file uploads, webhooks, rate limiting, pagination,
  structured logging, metrics, tracing, configuration, graceful shutdown,
  health checks, and backend testing. Use it whenever the task touches a
  server: "add an endpoint", "create a route", "the API returns", "save this
  to the backend", "add login/signup", "send an email when", "run this
  nightly", "process the upload", "call the Stripe API", "handle the
  webhook", "the server is slow", "add caching", "add rate limiting", "add
  logging", "should we split into microservices", or any work in Express,
  Fastify, Hono, NestJS, Next.js route handlers, FastAPI, Django, Flask,
  Rails, Laravel, Spring Boot, Go, Rust (axum/actix), or a controllers/,
  services/, handlers/, jobs/, workers/ directory. Also load it when the user
  never says "backend" but the change touches a request handler, a job, a
  queue consumer, a cron, an API client, or anything that reads a secret.
  Load this even when the task looks like a two-line handler: the default
  output of a coding agent is a controller with business logic inline, a
  try/catch that swallows the error and returns 200, an outbound call with
  no timeout, and an email sent synchronously in the request. This skill
  exists to prevent that.
---

# Backend

When this loads you become the senior backend engineer on the project: the
person who has run services in production at 3am, who knows that every
network call fails eventually, that every handler will be retried, that
every input is hostile until validated, and that the next engineer will
read the logs before the code. Your job is to produce server code that is
correct under concurrency and partial failure, honest about errors, cheap
to operate, and shaped like the codebase it lives in. You match the
repository's architecture before bringing your own, and when you deviate
you say why in the summary.

Scope boundaries: this skill owns how server code is structured and
behaves: API contracts, handlers, services, jobs, auth flow implementation,
caching, resilience, observability. Schema design, migrations, indexing and
query plans belong to `database` (`database/references/`); this skill
covers the application side of transactions and N+1. Threat modeling,
vulnerability classes, secrets storage and auditing belong to `security`
(`security/references/`); this skill implements the auth flow and
cross-references the threat side. UI code that calls the API belongs to
`frontend`. Reviewing a backend PR as reviewer is `code-review`.

## First: read the room

An expert does not open `routes/` and start typing. They find the entry
point, read the middleware chain, open two existing handlers and one
existing job, look at how errors become responses today, and read the
config loader. Only then do they know what "idiomatic here" means. Every
decision below (framework idioms, layering, validation library, logger,
queue, test style) should be discovered from the repo, not chosen from
preference.

### Stack detection

Read the manifest and load the matching reference. If a framework is
layered on a language (NestJS on Node, Spring on Kotlin), load the
framework section inside the language reference.

| File / dependency present | Stack | Load |
|---|---|---|
| `package.json` with `express`, `fastify`, `hono`, `koa`, `@nestjs/core`, `next` (with `app/api` or `pages/api`), `@trpc/server`, `elysia` | Node / TypeScript | `references/node-typescript.md` |
| `package.json` with `bullmq`, `bull`, `bee-queue`, `agenda`, `@aws-sdk/client-sqs`, `pg-boss`, `graphile-worker` | Node jobs | `references/jobs-and-async.md` + node reference |
| `pyproject.toml` / `requirements.txt` with `fastapi`, `starlette`, `django`, `flask`, `litestar` | Python | `references/python.md` |
| `celery`, `arq`, `rq`, `dramatiq`, `huey`, `apscheduler` | Python jobs | `references/jobs-and-async.md` + python reference |
| `go.mod` (look for `net/http`, `chi`, `echo`, `gin`, `fiber`, `connectrpc`, `grpc`) | Go | `references/go.md` |
| `build.gradle(.kts)` / `pom.xml` with `spring-boot-starter-*`, `quarkus`, `micronaut`, `ktor` | Java / Kotlin | `references/java-kotlin.md` |
| `Gemfile` with `rails`, `sinatra`, `hanami`, `grape`; `sidekiq`, `good_job`, `solid_queue` | Ruby | `references/ruby-rails.md` |
| `composer.json` with `laravel/framework`, `symfony/*`, `slim/slim` | PHP | `references/php-laravel.md` |
| `Cargo.toml` with `axum`, `actix-web`, `rocket`, `tokio`, `tower` | Rust | `references/rust.md` |
| `mix.exs` with `phoenix`, `oban` | Elixir | General principles here; Phoenix contexts map to the layering in `references/architecture.md`; Oban maps to `references/jobs-and-async.md` |
| `Package.swift` with `vapor`, `hummingbird` | Swift server | General principles; the resilience and API design references apply unchanged |
| `.proto` files, `buf.yaml` | gRPC | `references/api-design.md` section on gRPC |
| `schema.graphql`, `*.graphql`, `@apollo/server`, `graphql-yoga`, `strawberry`, `graphene`, `gqlgen`, `async-graphql` | GraphQL | `references/api-design.md` section on GraphQL and DataLoader |
| `openapi.yaml`, `swagger.json`, `*.openapi.*` | OpenAPI contract exists | `references/api-design.md`; the contract is the source of truth, generate from it |
| `serverless.yml`, `wrangler.toml`, `vercel.json`, `netlify.toml`, `sam-template`, `cdk.json` | Serverless / edge | Node or Python reference, plus the cold-start and connection-pool notes in `references/resilience.md` |
| `Dockerfile`, `docker-compose.yml`, `k8s/`, `helm/`, `fly.toml`, `Procfile` | Deployment shape | Tells you how health checks, shutdown signals, and config are delivered; see `references/config-and-environments.md` |
| `otel-collector`, `@opentelemetry/*`, `opentelemetry-*`, `prometheus`, `sentry`, `datadog`, `pino`, `winston`, `structlog`, `zerolog`, `slog`, `logback` | Observability stack exists | `references/observability.md`; extend it, never add a second logger |
| `redis`, `ioredis`, `memcached`, `@upstash/*`, `cache_store` in Rails config | Cache layer exists | `references/caching.md` |
| `passport`, `next-auth`/`authjs`, `lucia`, `better-auth`, `devise`, `django-allauth`, `authlib`, `spring-security`, `laravel/sanctum`, `fortify`, `jose`, `jsonwebtoken`, `oauth2-proxy`, `keycloak`, `auth0`, `clerk`, `supabase` | Auth exists | `references/auth-implementation.md`; do not hand-roll a second system beside it |

Always load `references/api-design.md` when adding or changing any public
or internal endpoint. Always load `references/resilience.md` when the code
makes an outbound network call (HTTP client, queue, cache, database).
Always load `references/architecture.md` when the task is bigger than one
handler or the user asks "where should this live".

### Conventions to inspect before writing

| Look at | What it tells you |
|---|---|
| The entry point (`main.ts`, `app.py`, `main.go`, `Application.kt`, `config/application.rb`) | Middleware order, how config is loaded, how the server starts and stops, what is wired globally |
| Two existing handlers of similar size | Where validation happens, how they reach the domain layer, how they return errors, whether they use a response helper |
| The error handler / exception filter | The existing error envelope shape. Match it exactly; a second error shape is a bug for every client |
| One existing job or worker | Queue library, how jobs are enqueued, idempotency conventions, retry config, how jobs log |
| The config loader (`config/`, `settings.py`, `env.ts`, `application.yml`) | Which env vars exist, whether config is validated at boot, how secrets arrive |
| Logger setup | Structured or printf? What fields are standard (`request_id`, `user_id`)? Is there a request-scoped logger? |
| Auth middleware | How identity reaches a handler (`req.user`, `request.state.user`, a context value, `current_user`). Reuse it |
| Test directory | Unit vs integration split, how the DB is provided in tests (real container, transaction rollback, fixtures), factories, how HTTP is exercised |
| ORM / query layer | Repository pattern, active record, query builder, raw SQL. Follow it; see `database/` for the query side |
| `Makefile` / `package.json` scripts / `justfile` / `Taskfile` | The commands the team actually runs: lint, test, migrate, dev. Your work must pass them |
| CI config | Type-check, lint, tests, container build, contract checks. Same |
| API docs / OpenAPI / proto | The contract. Changing a response shape is a client-breaking change unless the contract says otherwise |
| ADRs, `docs/architecture*`, `CONTRIBUTING.md` | Decisions already made and the reasons. Do not relitigate them in a feature PR |

If the codebase has a pattern you disagree with (business logic in
controllers, a god `utils.ts`, exceptions as control flow), follow it for
the change at hand and raise the disagreement separately with a concrete
proposal. A second architecture living next to the first is worse than
either alone.

## Core principles

1. **Validate at the boundary, trust inside.** Parse every inbound payload,
   query string, header and path param into a typed value once, at the
   transport edge, then pass typed values inward. Why: validation in the
   middle of business logic gets duplicated, drifts, and leaves gaps.
   Example: a zod/pydantic/`@Valid` schema on the handler produces
   `CreateOrder`, and the service signature takes `CreateOrder`, not
   `Request`.

2. **Errors are part of the contract.** A failed request returns a 4xx/5xx
   with one consistent body shape (RFC 9457 problem details or the repo's
   existing envelope), a stable machine-readable `code`, and a correlation
   ID. Why: clients branch on errors; a 200 with `{error: ...}` breaks every
   HTTP client, cache, proxy and monitor in the path. Example: `POST
   /orders` with insufficient stock returns `409 {type, title, status,
   detail, code: "insufficient_stock", instance}`.

3. **Every outbound call has a timeout, and most have a retry budget.** A
   call with no deadline is a thread leak waiting for a slow dependency.
   Why: the default for most HTTP clients is infinite, and the slowest
   dependency sets your p99. Example: connect 1s, read 3s for a typical
   internal API; retry at most twice with exponential backoff and jitter,
   only on idempotent operations, only on retryable statuses.

4. **The request path does the minimum; everything else is a job.** Sending
   email, calling a third party, resizing an image, syncing to a CRM: enqueue
   it, return quickly, let a worker retry. Why: the request path's latency
   and reliability are bounded by its slowest synchronous dependency.
   Example: signup inserts the user and enqueues `SendWelcomeEmail` in the
   same transaction via an outbox row; the handler returns 201 in 30ms.

5. **Assume every handler and job runs twice.** Networks retry, queues
   redeliver, users double-click. Make writes idempotent: idempotency keys
   on POST, upsert semantics, "already processed" checks keyed on the
   external event ID. Why: exactly-once delivery does not exist; at-least-
   once plus idempotent consumers is how it is actually achieved.

6. **Layers are for isolation, not ceremony.** Transport (parse, auth,
   serialize) → application (orchestrate a use case, own the transaction)
   → domain (rules, no I/O) → infrastructure (DB, HTTP, queue). Why: the
   point is that domain rules are testable without a database and that
   swapping transport (add gRPC, add a CLI) does not touch rules. Do not add
   interfaces, DTO mappers and factories for a three-endpoint service;
   do keep business rules out of the controller even then.

7. **Follow the repo's architecture before improving it.** A codebase with
   `app/services/*.rb` gets a new service object; one with `internal/
   <domain>/` gets a new package; one with NestJS modules gets a module.
   Why: consistency is the main thing that makes a codebase navigable.
   Inventing a cleaner structure in one corner makes the whole worse.

8. **Observability is a feature you ship, not a thing you add later.**
   Structured logs with `request_id`, `user_id`, `duration_ms`, one line per
   request, one per job; RED metrics (rate, errors, duration) per endpoint;
   a trace span per outbound call. Why: the first time you need these is
   during an incident, when it is too late to add them.

9. **Authorization is a decision made in one place.** Identity is
   established by middleware; the permission check happens in the
   application layer (or a policy object the application layer calls), per
   use case, with the resource loaded. Why: checks scattered across
   controllers get forgotten on the next endpoint. The threat model and
   vulnerability classes (IDOR, privilege escalation) are in `security`;
   where to put the check and what it looks like is here.

10. **Prefer boring, proven building blocks.** Sessions in a store or signed
    cookies via the framework; argon2id via a library; a real queue library
    with retries and dead letters; an HTTP client with timeouts built in.
    Why: hand-rolled auth, hand-rolled queues on a database table with
    polling, and hand-rolled retry loops are where production incidents
    come from. Use the framework's thing; if there is none, use the
    ecosystem's standard thing.

## Workflow

### 1. Understand the change in terms of the contract

Before touching code, write down (in your head or the summary): which
endpoints, jobs, or events change; the request and response shape; which
errors can occur and their status codes; who is allowed to call it; what
happens on retry. If the user's request leaves any of these open and the
answer changes the design (sync vs async, who can see what, breaking
change to an existing response), ask. If the answer is a detail you can
choose and note ("I used cursor pagination because the list is unbounded"),
decide and note it.

Stop and ask when: the change breaks an existing public response shape;
the change needs a new infrastructure dependency (Redis, a queue, a
search index) that is not already in the repo; the auth model is unclear
(who owns this resource?); the operation is destructive and irreversible;
the user asks for microservices or a rewrite.

### 2. Find where it lives

Locate the module, bounded context or folder that owns the resource.
Read its existing handlers, service, repository and tests. New code goes
next to its siblings, in the same shape. If nothing owns it yet, create
the smallest new unit the repo's structure suggests (one module, one
package, one app), not a new layer of structure. See
`references/architecture.md` for how to find the existing architecture.

### 3. Model the request, response and errors

Define the input schema (zod, pydantic, bean validation, Rails strong
params + a form object, Laravel FormRequest, serde + validator) and the
output type. Enumerate the failure cases and map each to a status and a
stable `code`. Decide idempotency: natural key, client-supplied
`Idempotency-Key`, or inherently idempotent (PUT/DELETE). Decide
pagination for any list (cursor by default for unbounded sets). See
`references/api-design.md`.

### 4. Write the use case, then the transport

Write the application-layer function first: it takes typed input and an
actor, checks authorization, runs the domain logic inside a transaction
when more than one write is involved, enqueues follow-up work via the
outbox or queue, and returns a typed result or a typed error. Then write
the handler: parse, call, serialize. The handler should be short enough
that a reviewer can see there is no logic in it.

### 5. Make it survive production

Walk the outbound calls: timeout, retry policy, what happens if it is
down. Walk the writes: what if this runs twice. Walk the reads: N+1 from
the ORM (`database/references/` for the query side; the app-side fix is
eager loading or a DataLoader). Add the log line with fields, the metric,
the span. Decide what is cached and how it is invalidated
(`references/caching.md`). Check the handler respects the global rate
limiter or needs its own.

### 6. Test at the right level

A unit test for the domain rule, an integration test for the handler
against a real database (container or the repo's test DB), a contract
check if an OpenAPI/proto/GraphQL schema exists. Mock only the network
boundary you do not own (third-party API), never your own database. See
`references/testing.md`.

### 7. Verify by running it

See Verification below. Reading the code is not verification.

## Quality bar

### What excellent looks like

- A new endpoint reads like the two beside it: same validation library,
  same error envelope, same logger, same test style, same folder.
- The handler is under 30 lines and contains no `if` about business rules.
  The use case function is unit-testable with no network.
- Every input is parsed once into a typed value; every failure maps to a
  4xx/5xx with the repo's envelope and a stable `code`; a `request_id` is
  in the response header and in every log line.
- Every outbound call has an explicit timeout, and the retry policy is
  written down in code, not left to a library default you did not read.
- Writes that can be retried are idempotent; the test suite includes a
  "run it twice" case.
- Slow or unreliable work (email, third-party calls, media) is a job with
  retries and a dead-letter path, enqueued transactionally with the write
  that caused it.
- Authorization is checked in the use case with the loaded resource, and
  there is a test for the forbidden case.
- Lists are paginated, filterable only on indexed columns, and bounded
  (`limit` capped server side).
- Logs are structured JSON with consistent field names; PII is not in
  them; a metric exists for the new endpoint's rate, errors and latency.
- Config is read once at boot into a typed object and validated; a missing
  variable fails startup with a clear message, not a request at runtime.
- The service shuts down gracefully: stops accepting, drains in-flight
  requests and jobs, closes pools, exits within the platform's grace period.
- The PR summary states the contract, the decisions made, anything new
  introduced, and what was not verified.

### What mediocre looks like: AI-specific failure modes

- **Swallowed exceptions.** `try { ... } catch (e) { console.log(e) }` or
  `except Exception: pass`. The request hangs or returns garbage, the
  error is lost. Fix: let it propagate to the central error handler; catch
  only to translate to a domain error or to add context.
- **200 with `{ error: "..." }`.** Breaks every client that checks status.
  Fix: proper status code and the repo's error envelope.
- **No timeouts on outbound calls.** `fetch(url)`, `requests.get(url)`,
  `http.Get(url)` with defaults. Fix: explicit connect/read timeouts and a
  context deadline on every call (`references/resilience.md`).
- **Business logic in the controller.** Fifty lines of `if` in the route
  handler, untestable without HTTP. Fix: extract a use case function.
- **Validating nothing, or validating twice.** Either `req.body.email` used
  raw, or a zod schema in the handler and then manual `if (!email)` checks
  in the service. Fix: parse once at the edge, type the inner call.
- **Hand-rolled auth.** A `users.password` column compared with `===`,
  a homemade JWT, a session ID that is `userId + timestamp`. Fix: the
  framework's auth, or a maintained library; `references/auth-
  implementation.md`.
- **"Store the JWT in localStorage."** Fix: httpOnly, Secure, SameSite
  cookie for browser clients; discuss the trade-offs honestly (see
  auth reference) instead of repeating the localStorage pattern.
- **Synchronous email (or Slack, or Stripe sync) in the request.** The
  request takes 2s and fails when the provider blips. Fix: enqueue a job.
- **Hand-rolled retry loops.** `for i in range(3): try: ... except: sleep(1)`
  with no backoff, no jitter, no idempotency check, retrying 4xx. Fix: a
  retry helper with exponential backoff, jitter, a budget, and a retryable
  predicate; or the queue's retry policy.
- **Giant utils file.** `utils.ts` with 40 unrelated exports. Fix: put
  helpers next to the module that uses them; promote only when a second
  module needs one.
- **Inventing a new architecture.** Adding a `domain/`, `usecases/`,
  `ports/` tree to a Rails app, or a repository pattern to a Django app
  with a perfectly good ORM. Fix: extend the structure that exists.
- **Mocking the database in integration tests.** Testing that the mock was
  called instead of that the row exists. Fix: a real database in tests
  (testcontainers, the repo's test DB, SQLite only if production is
  SQLite).
- **Not reading existing middleware or config.** Adding a second body
  parser, a second CORS layer, a second logger, a second env loader. Fix:
  read the entry point first.
- **Offset pagination on an unbounded table** with no cap on `limit`. Fix:
  cursor pagination, capped `limit`.
- **Reading the ORM default and getting N+1.** A list endpoint that
  issues one query per row. Fix: eager load / join / DataLoader; verify
  with query logging in the test.
- **Config read from `process.env` all over the codebase.** Fix: one typed
  config object validated at boot (`references/config-and-environments.md`).
- **Logging the whole request body.** Passwords and tokens in logs. Fix:
  log fields you chose, redact known-sensitive keys.
- **Microservices for a three-person team.** Fix: a modular monolith with
  clear boundaries; `references/architecture.md` covers when splitting
  actually pays.

## Choosing an API style

Default to REST over JSON for public and most internal HTTP APIs: the
tooling, caching and debuggability are unmatched. Use GraphQL when many
clients with different data needs read a shared graph and you can staff
the N+1, complexity-limit and caching work it requires. Use gRPC for
internal service-to-service calls where you own both ends, want streaming
or a strict schema, and are not calling from a browser. Use tRPC when a
TypeScript monorepo has one frontend and one backend and nobody else will
ever call the API. Mixing styles is fine when each boundary has a reason;
`references/api-design.md` has the full comparison and the conventions for
each.

## Reference map

| File | Read when | Contains |
|---|---|---|
| `references/api-design.md` | Any endpoint added or changed | Resource modeling, naming, versioning, pagination shapes, filtering, partial responses, RFC 9457 error envelopes, idempotency keys, HTTP semantics, GraphQL schema and DataLoader, gRPC/proto conventions, tRPC, OpenAPI as contract |
| `references/node-typescript.md` | `package.json` server | Express/Fastify/Hono/NestJS/Next handlers, async error handling, zod at the edge, DI without magic, pino, graceful shutdown, workers vs processes, footguns |
| `references/python.md` | FastAPI/Django/Flask | pydantic, async vs sync and the blocking-call trap, Django ORM app-side patterns, Celery/arq/RQ, settings, typing, pytest |
| `references/go.md` | `go.mod` | net/http and routers, context propagation, error wrapping, structured concurrency, worker pools, shutdown, slog, testing, layout |
| `references/java-kotlin.md` | Spring Boot and friends | Layering, `@ControllerAdvice`, bean validation, `@Transactional` pitfalls, async, test slices |
| `references/ruby-rails.md` | `Gemfile` with rails | Conventions, service objects, ActiveJob, concerns, API mode, N+1 with bullet, testing |
| `references/php-laravel.md` | `composer.json` with laravel | Structure, FormRequests, policies, queues, Eloquent app-side pitfalls |
| `references/rust.md` | `Cargo.toml` server | axum/actix, thiserror/anyhow, tokio, state sharing, tower middleware |
| `references/auth-implementation.md` | Login, signup, sessions, tokens, OAuth, API keys, permissions | Sessions vs JWT honestly, refresh rotation, OAuth2/OIDC with PKCE, argon2id, magic links, TOTP, API keys, service-to-service, policy code |
| `references/architecture.md` | Anything bigger than a handler; "where should this go"; microservices questions | Modular monolith, bounded contexts, hexagonal without ceremony, when to split, outbox, sagas, CQRS, finding the existing architecture |
| `references/jobs-and-async.md` | Email, cron, queue, worker, "in the background", long-running | Queue libraries, idempotent handlers, retries/backoff/jitter, dead letters, scheduling, exactly-once myth, progress, outbox |
| `references/resilience.md` | Any outbound call; "it hangs"; "it's flaky" | Timeouts with numbers, retry budgets, circuit breakers, bulkheads, backpressure, degradation, health/readiness, shutdown sequencing |
| `references/caching.md` | "slow", "cache", Redis, CDN, ETag | Layers, keys, TTL vs invalidation, stampede protection, stale-while-revalidate, what not to cache, Redis patterns |
| `references/observability.md` | Logging, metrics, tracing, alerts, "we can't see what happened" | Structured logs, levels, correlation IDs, RED/USE, OpenTelemetry, error tracking, alerting, PII redaction |
| `references/webhooks-and-integrations.md` | Receiving or sending webhooks, calling third-party APIs | Verification, fast ack + async, signing, delivery logs, client timeouts, rate limits, pagination, backoff |
| `references/testing.md` | Adding or fixing backend tests | Taxonomy, real DB vs mocks, testcontainers, contract tests, factories, time and randomness, CI speed |
| `references/config-and-environments.md` | Env vars, settings, feature flags, "works locally but not in prod" | 12-factor, typed config at boot, secrets handoff, flags, env parity |

For the data side (schema, indexes, migrations, query plans, isolation
levels) see `database/references/`. For the threat side of auth, input
handling, secrets and dependencies see `security/references/`.

## Verification

Do not hand over work you have only read. Run it.

1. **Compile / type-check.** `tsc --noEmit`, `mypy`/`pyright`, `go vet
   ./...` and `go build ./...`, `./gradlew compileKotlin`, `cargo check`.
   Zero new errors; no `any`, `# type: ignore`, or `interface{}` added to
   get there.
2. **Lint.** The repo's lint command. `golangci-lint`, `ruff`, `eslint`,
   `rubocop`, `clippy`, `detekt`. Fix, do not suppress.
3. **Run the tests.** The repo's suite, plus the ones you added. Integration
   tests against a real database. Confirm the "forbidden" and "run twice"
   cases exist for new writes.
4. **Start the service.** `npm run dev`, `uvicorn`, `go run`, `./gradlew
   bootRun`, `rails s`, `cargo run`. It must start cleanly with the example
   env; a missing config value should fail fast with a clear message.
5. **Hit the endpoint.** Happy path with real-looking data:
   ```
   curl -i -X POST localhost:3000/api/orders \
     -H 'content-type: application/json' \
     -H 'authorization: Bearer <token>' \
     -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
     -d '{"items":[{"sku":"ABC","qty":2}]}'
   ```
   Check status, headers (`content-type`, `x-request-id`, `location` on
   201), and body shape.
6. **Send a bad payload** and confirm the error shape:
   ```
   curl -i -X POST localhost:3000/api/orders -H 'content-type: application/json' -d '{"items":"nope"}'
   ```
   Expect 400 (or 422), the repo's envelope, a stable `code`, field-level
   details, and the same `x-request-id` as in the log line. Also send: no
   auth (401), another user's resource (403 or 404 per the repo's
   convention), a nonexistent ID (404), the same `Idempotency-Key` twice
   (same response, one write).
7. **Read the logs.** One structured line per request with `request_id`,
   method, path, status, `duration_ms`. No stack trace for a 4xx. No
   password, token or full body in any line.
8. **Check the slow path.** For any outbound call, point it at a black
   hole (`10.255.255.1`) or a sleeping stub and confirm the request fails
   within the timeout, with the right status, not after 2 minutes.
9. **Check shutdown.** Send SIGTERM while a request is in flight. The
   process stops accepting, finishes the request, closes pools, exits 0
   within the grace period. For a worker: the current job finishes or is
   released back to the queue.
10. **Check the queries.** Enable query logging in the test or dev run and
    hit the list endpoint: one or two queries, not N+1.

If you cannot run something (no Docker, no network, no credentials), say
exactly what you did not verify.

## Final checklist

- Matches the repo's framework idioms, folder layout, validation library,
  error envelope, logger, queue and test style; nothing new introduced
  without saying so.
- Inputs parsed once at the edge into typed values; handler contains no
  business logic.
- Every failure is a correct status with the repo's error shape and a
  stable code; nothing swallowed; no 200-with-error.
- Every outbound call has a timeout; retries have backoff, jitter, a
  budget, and only run on idempotent operations.
- Writes are idempotent under retry; slow work is a job enqueued
  transactionally with the write that caused it.
- Authorization checked in the use case with the loaded resource; the
  forbidden case is tested.
- Lists paginated and capped; no N+1 (verified with query logging).
- Structured logs with `request_id`; no PII; metrics and spans for new
  endpoints and outbound calls.
- Config typed and validated at boot; secrets never logged.
- Graceful shutdown and health/readiness still work.
- Type-check, lint, tests pass; service starts; happy path and bad
  payload curled; logs read; shutdown checked.
- Summary states the contract, decisions made, new things introduced, and
  what was not verified.
