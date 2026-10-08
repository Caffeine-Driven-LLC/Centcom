# Service architecture

How to find the architecture a repo already has and extend it; the
modular monolith as the default; bounded contexts and how to draw them;
hexagonal/clean layering stripped of its ceremony; the honest conditions
under which microservices pay off; event-driven patterns (outbox, sagas,
eventual consistency) and CQRS when they are warranted and the cheaper
alternatives when they are not.

## Contents

1. Find the existing architecture first
2. The modular monolith as the default
3. Drawing boundaries: bounded contexts
4. Layering without ceremony
5. Dependency direction and what may import what
6. When microservices actually pay off
7. Communication between modules and services
8. Event-driven patterns: outbox, consumers, sagas
9. CQRS and read models, when warranted
10. Multi-tenancy shapes
11. Extending an architecture you did not choose
12. Anti-patterns with fixes

## 1. Find the existing architecture first

Spend ten minutes before writing. Look at:

- **Top-level folders.** `app/models, app/controllers, app/services` is
  Rails MVC + services. `internal/<domain>/` is Go package-by-domain.
  `src/modules/<feature>/` is feature modules. `domain/, application/,
  infrastructure/, interfaces/` is explicit layered/hexagonal. `apps/,
  packages/` or `services/` with several `package.json`/`go.mod` is a
  monorepo of several deployables.
- **The entry point and its wiring.** What gets constructed in `main`,
  how dependencies are passed (constructor, container, module-level
  singletons), the middleware order.
- **How two existing features are built.** Pick a simple and a complex
  one; trace a request from route to database. That trace *is* the
  architecture. Note where validation, authorization, transactions, and
  side effects happen.
- **Import rules.** ESLint `no-restricted-imports`/`boundaries`, `depguard`
  in golangci, ArchUnit tests, Spring Modulith `verify()`, `import-linter`
  for Python, Packwerk for Rails. If any exists, the boundaries are
  enforced and you must respect them.
- **Docs.** `ARCHITECTURE.md`, `docs/adr/`, `CONTRIBUTING.md`, a diagram in
  the README. ADRs tell you why; do not undo a documented decision inside a
  feature PR.
- **Deployment units.** `Dockerfile`s, `Procfile` process types, k8s
  manifests, serverless configs. Several processes from one codebase
  (web, worker, scheduler) is normal and is still a monolith.

Then write one sentence to yourself: "This is a <shape> where features
live in <place>, use cases go in <place>, side effects go through <place>,
and modules talk via <mechanism>." Every new file should fit that
sentence.

## 2. The modular monolith as the default

One deployable (or a few process types from one codebase), one database
(usually), internal boundaries enforced by module structure rather than
by network. It gives you most of what people want from microservices
(ownership, separation, independent reasoning) without distributed
transactions, network partitions, version skew, and per-service
operational overhead.

```
src/
  modules/
    catalog/        public API: index.ts exports { catalogService, types }
      internal/     everything else; not importable from outside
    orders/
    billing/
    identity/
  shared/           truly cross-cutting: logging, errors, http client, db pool
  app.ts            wires modules together
```

Rules that make it work:

- Each module has a small public surface (a service interface and types)
  and keeps its tables, handlers and internals private. Other modules
  call the public surface, never the tables.
- Enforce it mechanically: `eslint-plugin-boundaries`, `dependency-cruiser`,
  Go's `internal/` directories, Java packages + ArchUnit or Spring
  Modulith, Python `import-linter`, Rails Packwerk, Rust crates in a
  workspace with `pub(crate)`.
- A module owns its data. Reporting that spans modules reads through
  their public APIs or a dedicated read model, not cross-module joins
  (a cross-module join inside one database is tempting and is exactly the
  coupling that makes a later split impossible).
- Cross-module side effects go through in-process events (section 8) when
  the caller should not know about the consumer (order placed → send
  email, update analytics), and through direct calls when the caller
  needs the result (order placed → reserve stock).

If the repo is a plain layered monolith (all controllers in one folder,
all models in another) that is also fine; add your feature in that shape
and, if the team wants modules, propose the migration separately.

## 3. Drawing boundaries: bounded contexts

A bounded context is a part of the domain where a word means one thing.
"Customer" in billing (a payer with a card) is not "Customer" in support
(a person with tickets). When one model tries to be both, every change
breaks something. Signs you have found a boundary:

- Different teams or people own the two sides.
- The same noun has different fields and lifecycles on each side.
- Changes on one side rarely need changes on the other.
- One side could be replaced by a vendor (payments, email, search).

Techniques: event storming on a whiteboard (domain events in orange,
commands in blue, aggregates in yellow, draw lines where the vocabulary
shifts); or pragmatically, cluster the tables by which ones are updated
together in one transaction. Tables that always change together belong in
one module; tables that only ever reference each other by ID can be
separated.

Inside a module, aggregates are the consistency boundaries: an `Order`
with its `OrderItems` is updated as one unit in one transaction; two
different orders are not. Transactions should span one aggregate; when
they must span two, you need either a bigger aggregate or an eventual-
consistency pattern (section 8).

Shared vocabulary between contexts goes through explicit translation at
the boundary (an anti-corruption layer: a small adapter that maps the
other context's model into yours), not through a shared `User` class
everyone imports.

## 4. Layering without ceremony

Four roles, which are not necessarily four folders:

| Role | Responsibility | Knows about | Must not |
|---|---|---|---|
| Transport | Parse request, authenticate, call a use case, serialize response | Application | Contain business rules, touch the DB |
| Application (use cases / services) | Orchestrate one use case: authorize, load, invoke domain rules, persist, emit events, own the transaction | Domain, infrastructure interfaces | Know about HTTP, format responses |
| Domain | Entities, value objects, rules, invariants; pure | Nothing external | Do I/O, import the ORM/HTTP client/logger |
| Infrastructure | Repositories, HTTP clients, queue adapters, mailers | Domain types | Contain business rules |

The point of the separation, so you know when to relax it:

- Domain rules are testable without a database or network. If your rules
  are trivial (CRUD with validation), the "domain" is the validated input
  type plus a few checks in the service, and that is fine.
- Transport can be swapped or added (REST + gRPC + CLI + job runner call
  the same use cases). If there will only ever be REST, do not build the
  abstraction, but still keep handlers thin because thin handlers are
  also easier to read.
- Infrastructure can be faked in tests. One interface per real external
  dependency (mailer, payment gateway) pays off immediately; an interface
  for your own database usually does not (use a real DB in tests).

What ceremony to skip: DTO → Command → Entity → Model → Response mapping
chains when two of those are identical; interfaces with one
implementation that is never faked; a `Repository` per table in an ORM
that already is one; "ports and adapters" folders for a 2,000-line
service; factories for things with one constructor. Add structure when
the pain appears (a 400-line service method, a rule duplicated in three
handlers, a test that needs Docker to check a discount calculation), not
before.

A small-service shape that respects the roles with three files:

```
orders/
  handler.ts     parse → service → serialize
  service.ts     use cases + transaction + policy check + outbox write
  store.ts       queries
```

A bigger one adds `domain.ts` (or `model/`) for rules and `events.ts`.

## 5. Dependency direction and what may import what

Dependencies point inward: transport → application → domain; infrastructure
→ domain (it implements domain-defined interfaces or works on domain
types). The domain imports nothing from the other three. The application
layer depends on infrastructure *interfaces*; the concrete implementations
are wired at the entry point. If you cannot afford interfaces, at least
make the service take its dependencies as constructor arguments so tests
can pass fakes.

Across modules: module A imports only module B's public surface. Never
`import { OrderRow } from "../orders/internal/db"`. If you need something
from B's internals, B should expose it on purpose.

Shared code (`shared/`, `common/`, `lib/`) is for genuinely cross-cutting
infrastructure: logging, error types, HTTP client, config, pagination
helpers. It is not where domain concepts go when two modules need them;
that signals a missing module or a misdrawn boundary.

## 6. When microservices actually pay off

Splitting a service is justified when at least one of these is true and
the team can afford the operational cost (per service: deploy pipeline,
monitoring, on-call knowledge, API versioning, local dev setup):

- **Independent scaling with very different profiles**: a CPU-heavy
  media pipeline next to a latency-sensitive API; a component that needs
  GPUs or 64 GB of RAM. (Separate *process types* from one codebase often
  solve this without a split.)
- **Independent deployment is blocked by organization**: 40+ engineers,
  several teams, release coordination is the bottleneck, and module
  boundaries in a monolith have failed to give teams autonomy.
- **Different runtime or language is genuinely required** (an ML service
  in Python next to a Go API).
- **Isolation for failure or security**: a component that must not take
  the rest down, or that handles card data and needs its own compliance
  scope.
- **A part is being replaced or sold**: it needs a hard boundary anyway.

Things that do not justify a split: "it's best practice", "so we can use
Kubernetes", a team of three to eight, a desire for clean boundaries (do
that with modules), expected future scale (split when you measure it).

Costs you take on: every cross-service call becomes a network call with
timeouts, retries and partial failure (`resilience.md`); transactions
across services disappear (section 8); joins across services disappear
(section 9); debugging needs distributed tracing (`observability.md`);
schema changes need expand/contract across deploys; local development
needs orchestration; a bad boundary is now expensive to fix.

If you do split: extract one well-bounded module at a time, behind the
existing API (strangler pattern), with its own data, keeping the monolith
as the system of record until the extraction is proven. Never a big-bang
rewrite.

## 7. Communication between modules and services

| Need | In a monolith | Across services |
|---|---|---|
| Caller needs the result now | Direct function call to the module's service | Synchronous RPC (HTTP/gRPC) with timeout and retry policy |
| Caller does not need the result; consumer must eventually act | In-process event (or outbox + worker if the consumer's work is slow or unreliable) | Message/event via broker (SQS, RabbitMQ, Kafka, NATS, Pub/Sub) from an outbox |
| Many consumers for one fact | Event bus in process | Topic / fan-out |
| Workflow with several steps that can each fail | One transaction if one aggregate; otherwise a saga driven by events or a workflow engine | Saga (choreography or orchestration) or a durable workflow engine (Temporal, Step Functions, Inngest, Restate) |

Synchronous calls between services create coupling in availability: if B
is down, A's feature is down. Prefer async when the business allows
"eventually" (most notifications, analytics, syncs, projections). Keep
sync for what the user is waiting on (price check, stock check, auth).

Service discovery, load balancing, mTLS, retries at the mesh level: use
the platform's (Kubernetes services, a mesh, cloud load balancers) rather
than building them into application code.

## 8. Event-driven patterns: outbox, consumers, sagas

### The outbox pattern

Problem: you write to the database and publish an event; if the publish
fails (or succeeds and the transaction rolls back), state and events
disagree. Dual writes are never atomic.

Solution: write the event into an `outbox` table in the same transaction
as the business write; a relay process reads the outbox and publishes to
the broker (or runs the job), marking rows as sent. At-least-once
delivery; consumers must be idempotent.

```sql
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id  text NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
```

```ts
// inside the use case transaction
await tx.insert(outbox).values({ id: uuidv7(), aggregateType: "order", aggregateId: order.id, eventType: "order.placed", payload: { orderId: order.id, total: order.total } });

// relay (one instance, or SKIP LOCKED for several)
const rows = await db.query(`SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`);
for (const row of rows) {
  await broker.publish(row.eventType, row.payload, { messageId: row.id });   // id enables consumer dedup
  await db.query(`UPDATE outbox SET published_at = now() WHERE id = $1`, [row.id]);
}
```

Alternatives that give the same guarantee with less code: a Postgres-
backed job queue (pg-boss, graphile-worker, River, GoodJob, Solid Queue,
Procrastinate, Oban) enqueued in the same transaction; Debezium/CDC
reading the WAL; Spring Modulith's event publication registry;
Rails `after_commit`. Use what the stack offers before building a relay.

### Idempotent consumers

Every consumer stores the `messageId` it has processed (a `processed_
events (id, processed_at)` table with a unique key, or the natural key of
the effect) and skips duplicates. Check-and-process inside one
transaction when the effect is in the same database; otherwise make the
effect itself idempotent (upsert keyed on event ID). Detail in
`jobs-and-async.md`.

### Sagas

A business transaction spanning aggregates or services, implemented as a
sequence of local transactions, each publishing an event, with
compensating actions for failures after a step has committed.

Choreography: each service reacts to events (`order.placed` → inventory
reserves and emits `stock.reserved` → payment charges and emits
`payment.captured` → order marks confirmed). Simple for 2-3 steps; hard to
see the whole flow and to handle timeouts once it grows.

Orchestration: a saga coordinator (a state machine persisted in a table,
or a durable workflow engine) issues commands and waits for replies,
deciding compensation (`refund`, `release stock`) on failure. Clearer for
4+ steps, timeouts, and human-visible status. Temporal, AWS Step
Functions, Azure Durable Functions, Inngest, Restate and Conductor are
orchestration engines that handle retries, timers and state for you;
prefer one over a homemade state machine if the repo can take the
dependency.

Design rules: every step is idempotent (it will be retried); compensations
are themselves idempotent and may not fully undo (a sent email cannot be
unsent; model the business reality); record saga state so an operator can
see where a stuck one is; set a timeout per step and a deadline per saga.

### Eventual consistency and the user

If the UI reads a projection that lags the write, the user may not see
what they just did. Options: read-your-writes by returning the written
state from the command and using it client-side; route the next read to
the primary; version the resource and have the client wait for `version
>= N`; or accept and show "processing". Decide this at design time; it is
a product decision as much as a technical one.

## 9. CQRS and read models, when warranted

CQRS means separate models for writes (commands against aggregates) and
reads (queries against shapes optimized for the screen). It is warranted
when read shapes are very different from the write model (dashboards,
search, cross-aggregate lists), when read load dwarfs write load, or when
you are already event-driven and can build projections from events.

Lightweight CQRS that most systems can use: write through the domain
model; read through dedicated query functions that return DTOs straight
from SQL (joins, denormalized columns, materialized views), bypassing the
ORM's entity graph. Same database, no events, no eventual consistency.
This alone fixes most "the list endpoint does 40 queries" problems.

Heavier CQRS: projections in separate tables or a separate store (Elastic
for search, Redis for leaderboards, a columnar DB for analytics), fed by
events via the outbox, eventually consistent, rebuildable from the event
log. Take it on only with a clear reason and a plan for rebuilds and lag
monitoring.

Event sourcing (storing events as the source of truth instead of current
state) is a further step with real benefits (audit, temporal queries,
replay) and real costs (schema evolution of events, snapshots, learning
curve). Do not introduce it into a system that was not designed for it.

## 10. Multi-tenancy shapes

- **Shared database, shared schema, `tenant_id` column**: simplest, cheapest,
  the common SaaS default. Every query filters by tenant (enforce with
  the ORM's default scope, a repository that requires tenant, or Postgres
  row-level security). Indexes lead with `tenant_id`.
- **Shared database, schema per tenant**: isolation of data and migrations
  per tenant; connection switching; migrations × tenants. Suits dozens to
  hundreds of tenants, not tens of thousands.
- **Database per tenant**: strongest isolation, highest ops cost; for
  regulated or very large tenants, sometimes as a tier above the shared
  pool.

Tenant resolution happens once in middleware (subdomain, header, token
claim) and is carried in the request context to every layer; never from a
request body field the client controls. Background jobs carry tenant ID
explicitly. Row-level security as a backstop is worth it in Postgres
(`database/references/`).

## 11. Extending an architecture you did not choose

- Put the new thing where the existing equivalents are. New endpoint →
  next to sibling endpoints; new job → in the jobs folder, same base
  class; new module → copy the folder shape of the closest existing one.
- Use the existing error, logging, config, auth and transaction
  mechanisms even if you would have designed them differently.
- If the existing structure makes your change awkward (the module you
  need does not exist, the layering forces a cross-module join), take
  the smallest step that keeps consistency: create the module in the
  established shape; expose a public method on the other module rather
  than reaching into its tables.
- When you think the architecture is wrong: finish the task consistently,
  then write a short proposal (what hurts, the smallest change that
  helps, how to migrate incrementally). An ADR in `docs/adr/` if the repo
  has them.
- Never introduce a parallel pattern silently (a second ORM, a second
  validation library, a second way to enqueue jobs, a `domain/` tree next
  to `app/models`). Two patterns in one codebase cost more than the worse
  of the two alone.

## 12. Anti-patterns with fixes

- **Distributed monolith**: services that must deploy together, share a
  database, or call each other synchronously in chains. Fix: merge them
  back, or redraw boundaries around data ownership.
- **Microservices by noun** (`user-service`, `order-service`) that all need
  each other for every request. Fix: boundaries by business capability
  and data ownership; most "entity services" should be modules.
- **Shared database between services.** Fix: one owner per table; others
  go through its API or consume its events.
- **Dual write** (DB then publish). Fix: outbox.
- **Anemic domain + god service**: entities with only getters/setters, a
  2,000-line `OrderService`. Fix: move rules onto the entity/value
  objects; split the service by use case.
- **Layering for its own sake**: six files to insert a row. Fix: collapse
  to transport/service/store until pain appears.
- **Business logic in event handlers no one can find.** Fix: handlers
  call named use cases; keep an inventory of event → consumers.
- **Sagas without compensation or state.** Fix: section 8.
- **Cross-module imports of internals.** Fix: public surface + lint rule.
- **Introducing CQRS/event sourcing/hexagonal into a CRUD app** because
  the agent knows the pattern. Fix: match the repo's complexity level.
- **Choosing microservices for a small team.** Fix: modular monolith;
  revisit when section 6 conditions are measured, not predicted.
