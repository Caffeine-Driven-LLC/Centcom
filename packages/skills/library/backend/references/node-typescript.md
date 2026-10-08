# Node and TypeScript backends

Express, Fastify, Hono, NestJS and Next.js route handlers: how each wants
you to structure a handler, async error handling that does not leak
unhandled rejections, zod at the edge, dependency injection without a
container, pino for structured logs, graceful shutdown, worker threads vs
processes, and the footguns that bite every Node service.

## Contents

1. Detecting the setup
2. Project shape that scales without ceremony
3. Validation with zod at the edge
4. Handlers per framework
5. Async error handling
6. The error envelope in one place
7. DI without magic
8. Structured logging with pino
9. Graceful shutdown
10. Concurrency: event loop, worker threads, processes
11. Database access from the app side
12. Testing shape
13. Footguns

## 1. Detecting the setup

- `package.json` `"type": "module"` → ESM; imports need file extensions in
  plain Node, not under a bundler. Match whatever the repo does.
- Runtime: check `engines`, `.nvmrc`, `.node-version`, `bun.lockb`, `deno.json`.
  Bun and Deno have Node compat but different module resolution and APIs.
- Build: `tsx`/`ts-node` for dev, `tsc` or `esbuild`/`tsup` for prod. Look
  at `scripts.dev` and `scripts.start`.
- `tsconfig.json`: `strict` should be on. `noUncheckedIndexedAccess` tells
  you how careful the team is. `paths` aliases need a runtime resolver.
- Framework: `express` (most common, callback-era API, needs async
  wrapper), `fastify` (schema-first, fast, plugin encapsulation), `hono`
  (edge-first, web standard Request/Response), `@nestjs/core` (Angular-
  style DI, decorators, modules), `next` with `app/api/**/route.ts`
  (web standard handlers in RSC world), `koa`, `elysia`.
- Validation: `zod` is dominant; `valibot`, `arktype`, `typebox` (Fastify's
  native fit), `class-validator` (NestJS) also appear. Use what exists.
- Logger: `pino` (preferred), `winston`, `bunyan`. Never `console.log` in a
  service that has a logger.
- ORM: `prisma`, `drizzle-orm`, `kysely`, `typeorm`, `knex`, `sequelize`,
  raw `pg`. Query-side guidance lives in `database/`.

## 2. Project shape that scales without ceremony

A layout that works for Express, Fastify and Hono alike, by feature not by
layer, so a feature's handler, use case, repo and tests sit together:

```
src/
  app.ts                 build the app (middleware, routes); no listen()
  server.ts              load config, build app, listen, wire shutdown
  config.ts              typed, validated env
  lib/
    errors.ts            AppError + mapper
    logger.ts            pino instance
    db.ts                pool / client
    http-client.ts       fetch wrapper with timeouts
  modules/
    orders/
      orders.routes.ts   transport: parse, call, serialize
      orders.service.ts  use cases: authorize, transact, enqueue
      orders.repo.ts     queries (or the ORM model)
      orders.schema.ts   zod schemas + inferred types
      orders.test.ts
    users/ ...
  jobs/
    send-email.job.ts
```

Separating `app.ts` from `server.ts` is what makes the app testable with
`supertest`/`app.inject()` without opening a port. Keep `lib/` small; a
helper used by one module lives in that module.

NestJS has its own shape (module/controller/service/provider per feature)
and you follow it. Next.js route handlers live under `app/api/`; put the
use cases in `lib/` or `server/` so they are not trapped in the route file.

## 3. Validation with zod at the edge

Define the schema once, infer the type, parse at the transport boundary,
pass the typed value inward.

```ts
// orders.schema.ts
import { z } from "zod";

export const createOrderSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1).max(64),
    qty: z.number().int().min(1).max(1000),
  })).min(1).max(100),
  couponCode: z.string().trim().toUpperCase().optional(),
  shippingAddressId: z.string().uuid(),
});
export type CreateOrder = z.infer<typeof createOrderSchema>;

export const listOrdersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  status: z.enum(["pending", "paid", "shipped", "cancelled"]).optional(),
});
```

Notes: `z.coerce` for query strings (everything arrives as a string);
`.strict()` on objects when extra keys should be rejected (default strips
them, which is usually what you want); `.max()` on every string and array
so a 50 MB payload is rejected by the schema and not just by the body
parser limit. `safeParse` when you want to map errors yourself; `parse`
when a central handler maps `ZodError`. Validate `params` and `headers`
too when a handler depends on them.

Map `ZodError` to the envelope once:

```ts
const zodToDetails = (e: ZodError) =>
  e.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message }));
```

## 4. Handlers per framework

The handler's whole job: parse, authorize via context, call the use case,
serialize. Business rules live in the service.

### Express (v5 handles async rejections; v4 needs a wrapper)

```ts
import { Router } from "express";
const r = Router();

r.post("/orders", requireAuth, async (req, res) => {
  const input = createOrderSchema.parse(req.body);          // throws ZodError → 422
  const order = await orderService.create(req.actor, input, { idempotencyKey: req.get("idempotency-key") });
  res.status(201).location(`/orders/${order.id}`).json(toOrderDto(order));
});

r.get("/orders", requireAuth, async (req, res) => {
  const q = listOrdersQuery.parse(req.query);
  const page = await orderService.list(req.actor, q);
  res.json({ data: page.items.map(toOrderDto), pageInfo: page.pageInfo });
});
```

Express 4: wrap every async handler so rejections reach `next(err)`:

```ts
export const wrap = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

Or use `express-async-errors` once at startup. Without one of these, a
rejected promise in a v4 handler hangs the request and prints an unhandled
rejection. Also set `app.set("trust proxy", ...)` correctly if behind a
load balancer, `express.json({ limit: "1mb" })`, and register the error
middleware last with four arguments.

### Fastify

Fastify validates with JSON Schema natively; with zod use
`fastify-type-provider-zod` so schemas also feed Swagger.

```ts
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

const app = Fastify({ logger: true, requestIdHeader: "x-request-id", genReqId: () => randomUUID() })
  .withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.post("/orders", {
  preHandler: [app.requireAuth],
  schema: { body: createOrderSchema, response: { 201: orderDtoSchema } },
}, async (req, reply) => {
  const order = await orderService.create(req.actor, req.body);   // req.body is typed
  return reply.code(201).header("location", `/orders/${order.id}`).send(toOrderDto(order));
});

app.setErrorHandler((err, req, reply) => renderProblem(err, req, reply));
```

Fastify plugins are encapsulated: a decorator or hook registered inside a
plugin is invisible outside unless wrapped in `fastify-plugin`. This is
the most common "why is `req.user` undefined" cause. Response schemas
make serialization fast and also strip unknown fields, which is a real
safety net against leaking columns.

### Hono

Web-standard `Request`/`Response`; runs on Node, Bun, Deno, Workers.

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

const app = new Hono<{ Variables: { actor: Actor; requestId: string } }>();

app.use("*", requestId(), logger(), requireAuth());
app.post("/orders", zValidator("json", createOrderSchema), async (c) => {
  const order = await orderService.create(c.get("actor"), c.req.valid("json"));
  c.header("location", `/orders/${order.id}`);
  return c.json(toOrderDto(order), 201);
});
app.onError((err, c) => renderProblem(err, c));
```

On edge runtimes there is no persistent process: no in-memory caches that
survive, no long-lived DB pools (use a serverless driver or a pooler like
PgBouncer/Neon/Hyperdrive), 10-30s CPU limits. Read the platform's limits
before designing.

### NestJS

Follow the module/controller/service shape. Controllers are transport
only; services hold use cases; providers are injected.

```ts
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseGuards(AuthGuard)
  @HttpCode(201)
  create(@Actor() actor: ActorDto, @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrder) {
    return this.orders.create(actor, body);
  }
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) { /* map AppError / HttpException / ZodError to envelope */ }
}
```

Use `nestjs-zod` or a custom pipe if the repo uses zod; `class-validator`
with DTO classes if that is what exists. Register the exception filter
globally in `main.ts`. Avoid business logic in guards and interceptors.
Enable `app.enableShutdownHooks()` or `OnModuleDestroy` will not fire.

### Next.js route handlers

```ts
// app/api/orders/route.ts
export async function POST(req: Request) {
  const actor = await requireActor(req);                 // reads cookie/session
  const body = createOrderSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return problem(422, "validation_error", zodToDetails(body.error));
  const order = await createOrder(actor, body.data);     // in lib/orders.ts, not here
  return Response.json(toOrderDto(order), { status: 201, headers: { location: `/api/orders/${order.id}` } });
}
```

Route handlers are stateless functions; there is no app-wide middleware
chain for error handling, so wrap handlers in a small `withHandler()`
that catches and renders problems, or you will return Next's HTML 500.
Server Actions are RPC for your own UI; they still need auth checks and
validation inside (the client can call them with any payload). Long or
retriable work still goes to a queue (Inngest, Trigger.dev, BullMQ on a
separate worker, QStash), not into the request.

## 5. Async error handling

Rules that prevent the two classic Node failures (hanging request,
process crash from unhandled rejection):

- Every async handler either returns a response or throws into a central
  handler. No `catch (e) { console.error(e) }` without a response.
- `await` every promise or explicitly `void` it with a `.catch` attached.
  A floating promise that rejects crashes Node 15+ (`unhandledRejection`
  defaults to throw). Enable `@typescript-eslint/no-floating-promises`.
- Register `process.on("unhandledRejection")` and `process.on
  ("uncaughtException")` to log and exit non-zero (then let the supervisor
  restart you). Do not "keep running" after an uncaught exception; state
  is unknown.
- Catch to translate, not to hide: `catch (e) { if (isUniqueViolation(e))
  throw conflict("duplicate_sku", ...); throw e; }`.
- `Promise.all` fails fast; `Promise.allSettled` when partial results are
  acceptable. Cap concurrency with `p-limit` or a small semaphore when
  fanning out to a dependency (200 parallel fetches to one API is an
  outage).
- `AbortController` for cancellation: pass `signal` to `fetch` and to DB
  clients that support it; abort when the client disconnects (`req.on
  ("close")`) for expensive reads.

## 6. The error envelope in one place

```ts
// lib/errors.ts
export class AppError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) {
    super(message); this.name = "AppError";
  }
}
export const errors = {
  notFound: (what: string) => new AppError("not_found", 404, `${what} not found`),
  forbidden: () => new AppError("forbidden", 403, "Not allowed"),
  unauthenticated: () => new AppError("unauthenticated", 401, "Authentication required"),
  conflict: (code: string, msg: string) => new AppError(code, 409, msg),
  validation: (details: unknown) => new AppError("validation_error", 422, "Validation failed", details),
  upstream: (name: string) => new AppError("upstream_unavailable", 503, `${name} unavailable`),
};

export function toProblem(err: unknown, requestId: string, instance: string) {
  if (err instanceof AppError) return { status: err.status, body: { type: `about:blank`, title: err.message, status: err.status, code: err.code, instance, requestId, errors: err.details } };
  if (err instanceof ZodError) return toProblem(errors.validation(zodToDetails(err)), requestId, instance);
  if (isBodyParserError(err)) return { status: 400, body: { type: "about:blank", title: "Malformed request body", status: 400, code: "malformed_body", instance, requestId } };
  return { status: 500, body: { type: "about:blank", title: "Internal Server Error", status: 500, code: "internal", instance, requestId } };
}
```

Log 5xx at `error` with the stack; log 4xx at `info` or `warn` without a
stack. Never send `err.message` for unknown errors to the client (it can
contain SQL or file paths).

## 7. DI without magic

Most Node services do not need a container. Pass dependencies explicitly
and compose once at startup:

```ts
// orders.service.ts
export const makeOrderService = (deps: { db: Db; queue: Queue; clock: () => Date; log: Logger }) => ({
  async create(actor: Actor, input: CreateOrder) {
    assertCan(actor, "order:create");
    return deps.db.transaction(async (tx) => {
      const order = await insertOrder(tx, actor.userId, input, deps.clock());
      await enqueueOutbox(tx, "order.created", { orderId: order.id });
      return order;
    });
  },
});
export type OrderService = ReturnType<typeof makeOrderService>;

// server.ts (composition root)
const log = makeLogger(config);
const db = makeDb(config.databaseUrl);
const queue = makeQueue(config.redisUrl);
const orderService = makeOrderService({ db, queue, clock: () => new Date(), log });
const app = buildApp({ orderService, log });
```

This gives you testability (pass a fake queue, a fixed clock) without
decorators or reflection. A module-level singleton (`export const db =
new Pool(...)`) is acceptable for genuinely global infrastructure, but it
makes tests harder; prefer passing it. If the repo uses NestJS, tsyringe,
inversify or awilix, use that; do not add a second mechanism.

## 8. Structured logging with pino

```ts
// lib/logger.ts
import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.secret"], censor: "[redacted]" },
  formatters: { level: (label) => ({ level: label }) },
  base: { service: "orders-api", env: process.env.NODE_ENV },
  ...(process.env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
});
```

Use `pino-http` (Express) or Fastify's built-in logger for one line per
request with `req.id`, method, url, status, `responseTime`. Create a child
logger per request (`req.log = logger.child({ requestId })`) and pass it
down or store it in `AsyncLocalStorage` so deep code can log with the
correlation ID without threading it through every signature:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage<{ requestId: string; log: Logger }>();
export const log = () => requestContext.getStore()?.log ?? logger;
// middleware: requestContext.run({ requestId, log: logger.child({ requestId }) }, () => next());
```

Log objects, not interpolated strings: `log.info({ orderId, total },
"order created")`, so fields are queryable. Levels: `error` needs a human,
`warn` is unexpected but handled, `info` is a business event or request
line, `debug` is for development. More in `observability.md`.

## 9. Graceful shutdown

```ts
// server.ts
const server = app.listen(config.port);
server.keepAliveTimeout = 65_000;        // > LB idle timeout (ALB 60s) to avoid 502s

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; shuttingDown = true;
  logger.info({ signal }, "shutting down");
  health.setNotReady();                                       // readiness → 503 so LB drains
  const forceExit = setTimeout(() => { logger.error("forced exit"); process.exit(1); }, 25_000).unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));   // stop accepting, finish in-flight
  await Promise.allSettled([queueWorker.close(), db.end(), redis.quit(), otelSdk.shutdown()]);
  clearTimeout(forceExit);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

`server.close()` stops new connections but waits for keep-alive sockets;
Node 18.2+ has `server.closeIdleConnections()`, call it after `close()`.
The force-exit timer must be shorter than the orchestrator's grace period
(Kubernetes default 30s). Fastify: `app.close()` runs `onClose` hooks; use
`close-with-grace`. NestJS: `app.enableShutdownHooks()`. Workers: stop
taking jobs, finish the current one, exit. See `resilience.md` for the
ordering rationale.

## 10. Concurrency: event loop, worker threads, processes

The event loop is single-threaded. Anything CPU-bound (image resizing,
PDF generation, bcrypt with high cost, big JSON parsing, synchronous
crypto, regex on untrusted input) blocks every request. Detect with
`perf_hooks.monitorEventLoopDelay` or `--trace-event-loop-delay`; a p99
loop delay above ~50ms is a problem.

Options, in order of preference:

1. Move it to a job on a separate worker process (queue). Correct for
   anything over ~50ms that is not needed in the response.
2. `worker_threads` with a pool (`piscina`) for CPU work that must be in
   the response path. Shares memory via `SharedArrayBuffer`, cheap to
   spawn, same process.
3. `child_process`/separate service for untrusted or crash-prone work
   (isolation).
4. Cluster (`node:cluster` or PM2) to use all cores for I/O-bound serving.
   One process per core; each has its own pool and memory; in-memory
   caches are per process (use Redis if they must be shared).

Never `fs.readFileSync` or `execSync` in a handler; never sync bcrypt
(`bcrypt.hash` async or argon2's async API). `JSON.parse` on multi-MB
bodies is sync; cap body size.

## 11. Database access from the app side

- One pool per process, sized for the database, not the app (`max: 10`
  per process is typical; 10 processes × 10 = 100 connections, check the
  DB limit). Pools are not shared across serverless invocations; use a
  pooler.
- Transactions wrap the use case, not the repository method, so one use
  case is one transaction. Pass the transaction handle (`tx`) explicitly
  or via `AsyncLocalStorage`; do not reach for a global client inside a
  transaction.
- Prisma: `include`/`select` to avoid N+1; `prisma.$transaction(async (tx)
  => ...)` with a timeout; beware the interactive transaction holding a
  connection while awaiting a third-party call (never do I/O to other
  systems inside a transaction).
- Drizzle/Kysely: typed query builders, you write the join; same rule.
- Set statement timeouts at the connection level (`statement_timeout` in
  Postgres) so a bad query cannot hold a connection forever.
- Schema, indexing and query plans: `database/references/`.

## 12. Testing shape

- Unit: use cases with fake deps (`makeOrderService({ db: fakeDb, ... })`).
- Integration: `supertest(app)` / `app.inject()` against a real Postgres
  (testcontainers or `docker compose` service in CI), truncating or
  rolling back between tests. Mocking the DB layer in these tests is the
  AI failure mode to avoid.
- Contract: if OpenAPI exists, validate responses against it in tests
  (`jest-openapi`, `@apidevtools/swagger-parser` + ajv).
- Outbound HTTP: `msw` (node) or `nock` to stub third parties, with a test
  for timeout and a test for 500.
- Vitest or Jest, whichever is present; `--runInBand`/`pool: forks` when
  tests share a database. More in `testing.md`.

## 13. Footguns

- **Express 4 async handler without wrapper** → hanging request on throw.
- **Floating promise** (`sendEmail(user)` without `await` or `.catch`) →
  process crash on rejection, or silent loss.
- **`JSON.stringify` on a `BigInt`** throws; on a circular object throws;
  on a `Date` gives ISO (fine). Serialize explicitly for DTOs.
- **`req.query` values are `string | string[] | ParsedQs`**; `?id=1&id=2`
  gives an array. Parse with zod.
- **Timezone**: `new Date("2026-10-07")` is UTC midnight, `new Date
  ("2026-10-07T00:00")` is local. Set `TZ=UTC` in the environment and
  store UTC.
- **`fetch` has no timeout** by default (undici). Use `AbortSignal.timeout
  (ms)` or a wrapper; see `resilience.md`.
- **Reading `process.env` at module import time** breaks tests that set
  env later and hides missing config until a request. Load config once in
  `config.ts` with zod and import the object.
- **`trust proxy` unset** behind a load balancer → `req.ip` is the LB,
  rate limiting and logs are wrong; `req.protocol` is `http`, secure
  cookies break.
- **Keep-alive timeout shorter than the LB's** → intermittent 502s on
  deploy and under load. Set `keepAliveTimeout` above the LB idle timeout.
- **`Buffer` growth from streaming uploads into memory**. Stream to disk or
  object storage (`busboy`, `@fastify/multipart`, presigned URLs).
- **Module-level mutable state** (a cache `Map` at top level) is per
  process and leaks forever. Bound it (`lru-cache`) or move to Redis.
- **Using `any` for `req.user`**. Augment the framework's type once
  (`declare module "express-serve-static-core" { interface Request { actor:
  Actor } }`) and type it properly.
- **Catching `ZodError` in the handler to return `{ error: e.message }`
  with 200.** Let the central handler do it with 422.
- **Mixing CJS and ESM** with `require` of an ESM-only package. Check the
  package's `exports` before adding it.
