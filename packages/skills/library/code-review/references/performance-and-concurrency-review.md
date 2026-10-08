# Performance and concurrency review

What to look for in a diff that could make the system slower or
nondeterministic, and how to tell a real problem from a cold-path nit.
Covers hot-path identification, complexity hiding in loops, allocation
patterns, I/O inside loops, async and await pitfalls per language, shared
state and races, lock review, idempotency, and when to hand off to the
`database` and `backend` skills for depth.

## Contents

1. First question: is this a hot path?
2. Complexity hiding in loops
3. Allocations and copies
4. I/O in loops and the N+1 handoff
5. Unnecessary network calls and missing caching
6. Async and await pitfalls by language
7. Shared mutable state and races
8. Reviewing locks
9. Idempotency and retries
10. Resource leaks
11. What to ask for as evidence
12. Severity guide

## 1. First question: is this a hot path?

Performance comments on cold code are noise. Before writing one, decide
how often the code runs and over how much data:

- Request handlers for list endpoints, anything in a loop over users or
  orders, background jobs that process tables, middleware, serializers,
  render functions, anything called per row or per item: hot.
- Startup code, admin actions, one-off migrations with small tables,
  error paths, CLI commands run by hand: cold.
- Unknown: look at the callers and at metrics if available (`grep` for
  the route in dashboards or logs); ask the author.

Severity scales with the product of frequency and data size. A quadratic
loop over a list that is always under 20 items is a nit. The same loop
over a tenant's full order history is a should-fix. On the request path
of a public list endpoint with unbounded input, it is blocking.

## 2. Complexity hiding in loops

The pattern to spot is a linear-looking loop that calls something linear
inside it.

```python
# O(n*m): `in` on a list is a scan
for order in orders:
    if order.customer_id in vip_customer_ids:   # list
        ...
# fix: a set, built once
vip = set(vip_customer_ids)
```

```ts
// O(n^2): find inside map
const withAuthor = posts.map(p => ({ ...p, author: users.find(u => u.id === p.authorId) }));
// fix: index once
const byId = new Map(users.map(u => [u.id, u]));
const withAuthor = posts.map(p => ({ ...p, author: byId.get(p.authorId) }));
```

```java
// O(n^2): removing from an ArrayList while iterating, or contains() on a List
for (Item i : items) if (seen.contains(i.getId())) ... // seen is a List
```

```go
// O(n^2): string concatenation in a loop copies the whole string each time
s := ""
for _, part := range parts { s += part }
// fix: strings.Builder
```

Also look for: sorting inside a loop; regex compiled inside a loop
(`re.compile`, `new RegExp`, `Pattern.compile`, `regexp.MustCompile` are
all per-call costs when not hoisted); repeated `len()`/`count()` that
hits a database; `array.indexOf` in a filter; recursion without
memoization over overlapping subproblems; `list.insert(0, x)` or
`shift()` in a loop (linear per call).

Comment template: "should-fix: `users.find` inside `posts.map` is
O(posts × users); for the dashboard with 5k posts and 2k users that is
10M comparisons per request. Build a `Map` by id first (3 lines)."

## 3. Allocations and copies

In most application code allocation is not the bottleneck, so only raise
these in paths you have established as hot:

- Copying a large collection to filter it when an iterator or generator
  would stream (`list(filter(...))` where a generator suffices; `.ToList()`
  mid-LINQ chain; `collect()` between stream ops).
- Building intermediate collections in a chain (`arr.map().filter().map()`
  on millions of items; Rust `collect::<Vec<_>>()` between adaptors).
- Spreading or cloning in a loop (`{ ...acc, [k]: v }` in a reduce is
  O(n^2) in copies; `acc[k] = v` is O(n)).
- Boxing in hot numeric loops (Java `Integer` in collections, Python is
  always boxed so use `numpy` for numeric work).
- Allocating per call what could be reused: buffers, regexes, formatters,
  HTTP clients (a new `http.Client` or `HttpClient` per request leaks
  connections and loses pooling), database connections outside the pool.
- String building by concatenation (section 2).
- Logging that formats a large object even when the level is off (`log.
  debug(f"{big_obj}")` formats before the level check; use lazy
  formatting or a guard).

Ask for a benchmark before and after when the author claims a win or you
suspect a loss (`pytest-benchmark`, `go test -bench -benchmem`,
`criterion`, JMH, `hyperfine` for CLIs, `BenchmarkDotNet`).

## 4. I/O in loops and the N+1 handoff

Any network or disk call inside a loop over data is a question. The
database version is the N+1 query:

```ruby
# N+1: one query for posts, one per post for the author
posts = Post.where(published: true)
posts.each { |p| puts p.author.name }
# fix: eager load
posts = Post.where(published: true).includes(:author)
```

```python
# Django: same shape
for order in Order.objects.filter(status="open"):
    print(order.customer.email)          # query per order
# fix: select_related("customer") for FK, prefetch_related for M2M/reverse
```

```ts
// Prisma / TypeORM / Drizzle: the loop awaits a query per item
for (const o of orders) { o.customer = await db.customer.findUnique({ where: { id: o.customerId } }); }
// fix: findMany with `where: { id: { in: ids } }` and join in memory, or `include`
```

```go
// database/sql: QueryRow in a loop
for _, id := range ids { db.QueryRowContext(ctx, "SELECT ... WHERE id = $1", id) }
// fix: WHERE id = ANY($1) with pq.Array / pgx
```

Your job in review is to spot the shape and the scale; the fix and the
depth (batching, `IN` with limits, DataLoader, cursor pagination, index
coverage) belong to `database/references/` (query performance) and for
GraphQL resolvers to `backend/references/api-design.md` (DataLoader). Say
"N+1 on `author`; see the database skill's query performance notes for the
batching options in this ORM" and let the author or the domain skill pick.

Other I/O in loops: HTTP call per item (batch endpoint, or bounded
concurrency with a semaphore); file open per line; `os.stat` per path in
a tree walk; cache `get` per item when `mget` exists; a `SELECT COUNT`
per page.

Also the reverse: loading everything to process one (`SELECT *` with no
`WHERE` then filtering in code; reading a whole file to get the first
line; fetching all users to find one by email).

## 5. Unnecessary network calls and missing caching

- A call made every request whose result changes rarely (feature flags,
  config, exchange rates, permission lists). Candidate for a cache with a
  TTL; `backend/references/caching.md` for invalidation design.
- Sequential calls that are independent (`a = await fetchA(); b = await
  fetchB()`): `Promise.all`, `asyncio.gather`, `errgroup`, structured
  concurrency. Watch for the opposite error too: parallelizing calls that
  share a connection or a rate limit.
- Retry on top of a client that already retries (two layers of three
  retries is nine attempts).
- Fetching a full object to read one field the caller already has.
- A health check or auth check that calls a remote service with no
  timeout; `backend/references/resilience.md` for timeouts and circuit
  breakers.

## 6. Async and await pitfalls by language

### JavaScript / TypeScript

- **Unawaited promise.** `doWrite();` without `await` or `.catch`: the
  error becomes an unhandled rejection and the handler returns before
  the write finishes. Lint: `@typescript-eslint/no-floating-promises`,
  `no-misused-promises`. In review grep for calls to async functions
  with no `await`, `return`, `.then`, or `void` marker.
- **Await in a loop when independent.** `for (const x of xs) await
  f(x)` serializes; `Promise.all(xs.map(f))` parallelizes. But unbounded
  `Promise.all` over 10k items opens 10k connections; use `p-limit` or
  batch.
- **`forEach` with async callback.** `xs.forEach(async x => await f(x))`
  does not wait for anything. Use `for...of` or `Promise.all(map)`.
- **Blocking the event loop.** Synchronous heavy work (`JSON.parse` on a
  100MB string, `fs.readFileSync` in a handler, sync crypto, a tight
  loop) stalls every request. Worker threads or streaming.
- **Promise constructor anti-pattern.** `new Promise(async (res, rej) =>
  ...)` swallows errors thrown inside.
- **Missing `.catch` on fire-and-forget.** If intentional, `void
  f().catch(log)`.
- **`async` functions in `useEffect`** (React) returning a promise where a
  cleanup function is expected; `frontend/references/react.md`.

### Python

- **Blocking call in `async def`.** `requests.get`, `time.sleep`,
  `open().read()` on a large file, a sync DB driver, CPU-heavy work. Each
  one freezes the entire event loop for its duration. Use the async
  client (`httpx.AsyncClient`, `asyncio.sleep`, `aiofiles`, `asyncpg`) or
  `await asyncio.to_thread(fn)` / `loop.run_in_executor`.
- **Forgotten `await`.** Calling a coroutine without awaiting creates a
  coroutine object and does nothing; Python warns at exit ("coroutine was
  never awaited"). Lint: `ruff` rule `RUF006` for untracked tasks; type
  checkers flag unused coroutine results in strict mode.
- **`asyncio.create_task` without keeping a reference.** The task can be
  garbage collected mid-flight. Keep it in a set or use a `TaskGroup`
  (3.11+).
- **`asyncio.gather` without `return_exceptions`** and without handling:
  one failure cancels nothing and the others keep running orphaned.
  Prefer `TaskGroup`.
- **Sync code calling `asyncio.run` inside an already-running loop** (in
  Jupyter, in a framework handler): raises. Use `await`.
- **Thread safety of shared objects** used from `to_thread`: the GIL does
  not make compound operations atomic.
- Celery/RQ/Dramatiq jobs: idempotency (section 9) and `acks_late`
  semantics; `backend/references/jobs-and-async.md`.

### Go

- **Goroutine leak.** A goroutine blocked forever on a channel nobody
  reads, or waiting on a context that is never cancelled, or started in
  a loop per request without a bound. Review: every `go func()` has a
  way to exit (context, done channel, closed input channel) and someone
  waits for it (`sync.WaitGroup`, `errgroup`). `goleak` in tests.
- **Loop variable capture** (before Go 1.22): `for _, x := range xs { go
  func() { use(x) }() }` uses the last `x`. Check `go.mod` go version;
  1.22+ fixed it.
- **Unbuffered channel send with no receiver** on an error path: the
  goroutine blocks forever. `select` with `ctx.Done()`.
- **Data race on a map or slice** written from multiple goroutines.
  `go test -race` catches it if the test exercises concurrency; ask for
  one. `sync.Map` or a mutex.
- **`context.Background()` deep in a request path** drops cancellation
  and deadlines; pass the request's context.
- **Missing `defer cancel()`** after `context.WithTimeout`: leaks the
  timer.
- **`time.After` in a loop** leaks timers until they fire; use
  `time.NewTimer` and `Stop`.
- **`sync.WaitGroup.Add` inside the goroutine** instead of before `go`:
  race with `Wait`.

### Java / Kotlin

- **Blocking in a reactive or coroutine context.** `Thread.sleep`,
  blocking JDBC, `RestTemplate` inside a WebFlux handler or a `suspend`
  function on `Dispatchers.Default`; starves the small thread pool. Use
  `Dispatchers.IO` / `withContext(IO)` for blocking calls in coroutines;
  use reactive drivers or `boundedElastic` in WebFlux.
- **Unbounded thread pools.** `Executors.newCachedThreadPool()` under
  load creates threads until the process dies; use a bounded pool with a
  rejection policy. `CompletableFuture.supplyAsync` without an executor
  uses the common ForkJoinPool, which is shared and small.
- **`@Async` or `@Transactional` on private or self-invoked methods**:
  proxies do not intercept, so nothing is async or transactional.
- **`synchronized` on a `String` literal or boxed primitive**: shared
  across the JVM, deadlock bait.
- **Double-checked locking without `volatile`.**
- **`ConcurrentHashMap` compound operations** (`if (!map.containsKey(k))
  map.put(k, v)`) are not atomic; `computeIfAbsent`.
- **`GlobalScope.launch`** in Kotlin: unstructured, leaks, swallows
  exceptions. Use a scoped `CoroutineScope` tied to a lifecycle.
- **`runBlocking` in production code** on a request thread.
- **`Flow` collected on the wrong dispatcher**; `flowOn`.

### Rust

- **Holding a `std::sync::Mutex` guard across an `.await`**: the lock is
  held while the task is parked; other tasks deadlock. Use
  `tokio::sync::Mutex` only if you must hold across await; otherwise
  scope the guard to drop before `.await`. Clippy:
  `await_holding_lock`.
- **Blocking in async** (`std::thread::sleep`, `std::fs`, sync
  `reqwest::blocking`, heavy CPU) on a Tokio worker: `tokio::task::
  spawn_blocking`, `tokio::fs`, `tokio::time::sleep`.
- **`Arc<Mutex<T>>` where a channel or `RwLock` fits**; contention.
- **Forgotten `JoinHandle`**: spawned task's panic is silent unless
  awaited or `JoinSet`.
- **`.clone()` in a hot loop** to satisfy the borrow checker; often a
  sign that ownership should be restructured, but measure first.
- **`unwrap()` on a poisoned mutex or a closed channel** on the error
  path.

### C# / .NET

- **`.Result` or `.Wait()` on a Task** in ASP.NET or UI code: deadlock
  with the synchronization context. `await` all the way up.
- **`async void`** anywhere but event handlers: exceptions crash the
  process.
- **Missing `ConfigureAwait(false)`** in library code (less critical in
  ASP.NET Core, still relevant in libraries and UI frameworks).
- **`Task.Run` wrapping async work** in a web app: burns a thread for
  nothing.
- **`HttpClient` per request** without `IHttpClientFactory`: socket
  exhaustion.
- **Unbounded `Parallel.ForEach` or `Task.WhenAll` over a large set**
  hitting a database.

### Ruby

- **Threads sharing an ActiveRecord connection**; use the pool's
  `with_connection`.
- **Sidekiq jobs that are not idempotent** (retries are the default).
- **Global mutable state in a threaded server (Puma)**: class-level
  instance variables, memoized module methods with mutable values.
- **`sleep` or synchronous HTTP in a request** under a thread-per-request
  server: holds the thread.

### PHP

- Mostly request-per-process, so fewer async concerns, but: shared state
  in long-running workers (Swoole, RoadRunner, Laravel Octane) persists
  across requests (static properties, singletons holding user data);
  queue jobs with retries that are not idempotent; `sleep` in requests
  holding a PHP-FPM worker.

### Swift

- **Blocking the main actor** (sync network, heavy decode) freezes the
  UI. `Task.detached` or move to a non-isolated function.
- **Data races on non-`Sendable` state** across actors; Swift 6 strict
  concurrency turns these into errors; check the build setting.
- **Unstructured `Task { }`** with no cancellation and no owner in a view
  that can disappear; `.task {}` modifier in SwiftUI handles cancellation.
- **Capturing `self` strongly in long-lived closures** (retain cycles).

## 7. Shared mutable state and races

Independent of language, a race needs three things: state shared between
concurrent executions, at least one writer, and no coordination. In
review, for each piece of mutable state ask who else can see it:

- Module-level or static variables and singletons.
- Instance fields on a long-lived object (a service, a handler class, a
  worker) used by concurrent requests or jobs.
- Caches, maps and sets that are read and written.
- Files, rows and external resources (two workers processing the same
  row; two requests incrementing the same counter).

The read-modify-write pattern is the one to find: `x = get(); x += 1;
set(x)`, `if not exists: create`, `balance = balance - amount`. Each
needs an atomic operation (`INCR`, `UPDATE ... SET n = n + 1`, `INSERT
... ON CONFLICT`, `compare-and-swap`, `atomic.AddInt64`,
`AtomicInteger`, `Interlocked`) or a lock or a unique constraint that
makes the second writer fail cleanly.

Database-level races (lost updates, phantom reads, double booking) are
the `database` skill's territory (transactions and isolation); in review,
spot the shape (check-then-act across two statements) and hand off.

Test ask: a test that runs the operation concurrently and asserts the
invariant (final counter equals number of increments; exactly one row
created). `go test -race`, `pytest` with threads, `jest` with
`Promise.all` of the same call, JCStress or `ThreadSanitizer` for native.

## 8. Reviewing locks

When a diff adds or changes a lock:

- **What does it protect?** Every access to that state should be under
  the same lock. Grep for the field; any access outside the lock is a
  bug.
- **How long is it held?** A lock held across I/O (network, disk, a
  database call, an await) serializes everything behind it. Narrow the
  critical section to the memory operations.
- **Order.** Two locks acquired in different orders in two places is a
  deadlock waiting for load. Document the order or merge the locks.
- **Reentrancy.** Does the critical section call something that tries to
  take the same lock? Non-reentrant locks deadlock (Go `sync.Mutex`,
  Rust `Mutex`, Python `threading.Lock`); reentrant ones (Java
  `synchronized`, `RLock`) hide design problems.
- **Release on every path.** `defer mu.Unlock()`, `try/finally`, `with
  lock:`, `using`, RAII guards. A manual unlock after an early return is
  a bug.
- **Is a lock the right tool?** Often an atomic, an immutable snapshot
  swapped atomically, a channel, a per-key lock, or pushing the
  coordination into the database (unique constraint, `SELECT ... FOR
  UPDATE`, advisory lock) is simpler and faster.
- **Distributed locks** (Redis `SET NX`, Redlock, Zookeeper, database
  advisory locks): expiry shorter than the work means two holders;
  expiry longer means a crashed holder blocks everyone. Fencing tokens.
  `backend/references/jobs-and-async.md` for the patterns.

## 9. Idempotency and retries

Any operation that can be retried (job, webhook, message consumer, client
with retry, user double-click) must be safe to run twice. In review of
such a path:

- What happens if this runs twice with the same input? Charge twice?
  Send two emails? Insert a duplicate? Increment twice?
- Where is the idempotency key, and is it derived from the request (order
  id + attempt) rather than generated per call (a fresh UUID each try
  defeats the purpose)?
- Is the check-and-record atomic (unique constraint on the key, `INSERT
  ... ON CONFLICT DO NOTHING`, `SETNX`) or is it a check followed by an
  act (race)?
- Does the retry policy match the error (retry transient, not
  validation)? `error-handling-review.md` section on retries.
- Is there a maximum, with backoff and jitter, and a dead-letter path?
- For external side effects (payments, emails), does the provider accept
  an idempotency key, and is it passed?

## 10. Resource leaks

Things that must be released, and the construct that guarantees it:

| Resource | Leak pattern | Guarantee |
|---|---|---|
| File handles | `open()` without close on the error path | `with` (Py), `defer f.Close()` (Go), `try-with-resources` (Java), `use {}` (Kotlin), `using` (C#), RAII (Rust, C++), `File.open {}` block (Ruby) |
| DB connections | Acquired from pool, exception before release | Pool's context manager / `defer rows.Close()` / `try-with-resources` |
| HTTP response bodies | Go `resp.Body` not closed; Node streams not consumed | `defer resp.Body.Close()`; consume or destroy the stream |
| Timers, intervals | `setInterval` without `clearInterval` on unmount; `time.AfterFunc` never stopped | Cleanup in effect return / `defer t.Stop()` |
| Subscriptions, listeners | `addEventListener` without remove; RxJS subscribe without unsubscribe; Kotlin `Flow` collect without scope cancel | Cleanup function; `takeUntil`; lifecycle scope |
| Goroutines, threads, tasks | Section 6 | Context cancellation; structured concurrency |
| Locks | Section 8 | Scoped release |
| Temp files and directories | Created, not removed on failure | `tempfile.TemporaryDirectory()`, `t.TempDir()` (Go test), `try/finally` |
| Child processes | Spawned, not waited (zombies) or not killed on timeout | `subprocess.run(timeout=)`, `exec.CommandContext`, `kill` on timeout |

In review: for each acquire in the diff, find the release, and check it
runs on the exception path. If the language has a scoped construct and
the diff did not use it, ask why.

## 11. What to ask for as evidence

For a claimed performance improvement: a before/after measurement with
the method (benchmark tool, dataset size, p50 and p99 or mean with
variance), on representative data. "Feels faster" is not evidence; a
single run is barely evidence.

For a change in a hot path with no claim: ask whether it was measured;
if not and the change is algorithmic (loop nesting, new query), ask for a
quick benchmark or an `EXPLAIN` (database skill).

For concurrency changes: a test that exercises the concurrency (`-race`,
concurrent calls asserting an invariant), or a written argument for why
the state is not shared.

## 12. Severity guide

| Finding | Cold path | Hot path or unbounded input |
|---|---|---|
| Quadratic loop | nit | should-fix; blocking on a public list endpoint |
| N+1 query | nit (note it) | should-fix; blocking if the list is unbounded |
| Sequential independent awaits | nit | should-fix |
| Blocking call in async context | should-fix (it still stalls others) | blocking |
| Unawaited promise / forgotten await | should-fix (lost errors) | blocking |
| Data race on shared state | blocking | blocking |
| Lock held across I/O | should-fix | blocking |
| Non-idempotent retried operation with side effects | blocking | blocking |
| Resource leak | should-fix | blocking |
| Unbounded concurrency (Promise.all over 10k, cached thread pool) | should-fix | blocking |
| Allocation churn, missing `StringBuilder` | nit | should-fix with a benchmark |
| New HTTP client per call | should-fix | blocking |
