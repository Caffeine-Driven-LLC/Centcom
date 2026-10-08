# Background jobs and async work

Queues and workers across stacks (BullMQ, pg-boss, Sidekiq, GoodJob, Solid
Queue, Celery, arq, RQ, Laravel queues, River, Asynq, SQS, RabbitMQ,
Kafka), what makes a job handler safe to retry, retry/backoff/jitter
numbers, dead letters, scheduling without duplicates, why exactly-once is
a myth and what you do instead, long-running work with progress, and the
outbox pattern for transactional enqueue.

## Contents

1. What belongs in a job
2. Choosing a queue
3. Delivery semantics: the exactly-once myth
4. Idempotent handlers, concretely
5. Retries, backoff, jitter, budgets
6. Dead letters and poison messages
7. Transactional enqueue: outbox and DB-backed queues
8. Scheduling and cron
9. Long-running work, progress, cancellation
10. Concurrency, rate limits, priority, fairness
11. Worker process hygiene
12. Payload design
13. Observability for jobs
14. Testing jobs
15. Anti-patterns with fixes

## 1. What belongs in a job

Move it out of the request path when it is:

- Slow (>100-200 ms), or variable: email, SMS, push, PDF/image generation,
  third-party API calls, report building.
- Unreliable: anything over the network to a system you do not own.
- Not needed for the response: analytics, audit trails, search indexing,
  cache warming, CRM sync, webhooks you send.
- Bursty: 10,000 users imported at once should not mean 10,000 synchronous
  writes in one request.
- Scheduled: nightly reconciliation, hourly cleanup, monthly invoices.

Keep it synchronous when the user needs the result to continue (price
calculation, validation against inventory, auth), when it is fast and
local, or when failure must fail the request.

The handler enqueues and returns `201`/`202` with enough for the client
to track (`operationId`, or the resource whose status will change).

## 2. Choosing a queue

Use what the repo has. If choosing:

| Stack | Redis-backed | Database-backed | Cloud / broker |
|---|---|---|---|
| Node | BullMQ (mature, delayed jobs, rate limits, flows) | pg-boss, graphile-worker (transactional enqueue, no Redis) | SQS, Pub/Sub, RabbitMQ (amqplib), Kafka (kafkajs) |
| Python | Celery (Redis/RabbitMQ), arq (asyncio), RQ, Dramatiq | Procrastinate, django-q2, Celery with SQLAlchemy broker (meh) | SQS via Celery or boto3, Kafka (aiokafka, confluent-kafka) |
| Ruby | Sidekiq (the standard) | GoodJob, Solid Queue (Rails 8 default), Delayed Job | Shoryuken (SQS), Racecar/Karafka (Kafka) |
| PHP | Laravel queues (redis), Horizon | Laravel `database` driver | SQS driver, Symfony Messenger with AMQP/SQS/Doctrine |
| Go | Asynq, Machinery | River (Postgres, excellent), gue | SQS SDK, Watermill, sarama/franz-go (Kafka), NATS JetStream |
| Java/Kotlin | n/a | JobRunr, db-scheduler, Quartz (clustered) | Spring AMQP, Spring Kafka, SQS via Spring Cloud AWS |
| Rust | apalis (Redis/Postgres), sidekiq-rs | sqlxmq, apalis-postgres, underway | lapin (AMQP), rdkafka, aws-sdk-sqs |
| Elixir | n/a | Oban (Postgres; the standard) | Broadway (SQS/Kafka/RabbitMQ) |

Decision rules:

- **DB-backed first** for modest volume (< a few hundred jobs/s) when the
  app already has Postgres: transactional enqueue for free (no outbox
  needed), one fewer system to run, visible in SQL. Use `FOR UPDATE SKIP
  LOCKED` under the hood (they all do).
- **Redis-backed** when throughput or latency matters, when you need
  delayed/rate-limited/deduplicated jobs with good tooling, and when you
  already run Redis.
- **Broker (SQS/RabbitMQ/Pub/Sub)** when producers and consumers are
  different services, when you want managed durability, or for fan-out.
- **Kafka/JetStream/Kinesis** for event streams consumed by multiple
  independent consumers with replay, high throughput, or ordering per key.
  Not for "run this task later" (no per-message ack/retry/delay
  semantics without extra machinery).
- **Durable workflow engines** (Temporal, Inngest, Trigger.dev, Restate,
  Step Functions) when the work is multi-step with waits, timers, and
  human approvals; they replace sagas you would otherwise hand-write.

## 3. Delivery semantics: the exactly-once myth

Every queue delivers at-least-once (a worker can crash after doing the
work but before acking) or at-most-once (ack before work; lose on crash).
"Exactly-once delivery" across a network is impossible in general; what
systems that advertise it actually provide is at-least-once delivery plus
deduplication in a bounded window (SQS FIFO dedup IDs, Kafka idempotent
producers + transactional consumers within Kafka).

So design for at-least-once and make the *effect* happen once: idempotent
handlers. Assume every job runs twice, sometimes concurrently, sometimes
hours apart, sometimes after the data it referenced has changed.

Ordering: most queues do not guarantee it across workers. If order
matters, key it (SQS FIFO message groups, Kafka partition keys, BullMQ
groups via a pattern, Sidekiq `sidekiq-grouping`, or a single-concurrency
queue per key) or design handlers to be order-independent (process the
*current* state of the aggregate, not the event's snapshot).

## 4. Idempotent handlers, concretely

Four techniques, from cheapest to most general:

**Natural idempotence.** The operation is a set-to-value or an upsert:
"set user.status = active", "upsert search document for product 42",
"ensure S3 object exists". Re-running does nothing new. Prefer designing
jobs this way: pass the ID, re-read current state, converge to it.

**Check-then-act on a state flag, in the same transaction as the act.**

```ts
await db.transaction(async (tx) => {
  const order = await tx.orders.findForUpdate(orderId);          // row lock
  if (order.confirmationSentAt) return;                          // already done
  await mailer.send(confirmation(order));                         // side effect (not transactional; see below)
  await tx.orders.update(orderId, { confirmationSentAt: now() });
});
```

The side effect is outside the DB, so a crash between send and update
re-sends once. That is the at-least-once residue; to shrink it, record
"sending" before the send and "sent" after, and treat "sending" older
than N minutes as retryable with a provider-side idempotency key.

**Processed-message table.** Store the job/message ID with a unique
constraint; insert it in the same transaction as the effect; a duplicate
insert means skip.

```sql
CREATE TABLE processed_jobs (job_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
```

```python
with transaction.atomic():
    try:
        ProcessedJob.objects.create(job_id=job_id)
    except IntegrityError:
        return  # duplicate
    apply_effect()
```

Prune rows older than the queue's maximum redelivery window.

**Provider-side idempotency keys.** When the effect is in a third party
(Stripe charge, SendGrid send, Twilio message), pass a deterministic key
derived from your job (`charge:order:{orderId}`) so the provider dedupes.
This is the only way to make external side effects safe.

Also: never pass mutable state in the payload that the handler trusts;
pass IDs and reload. Never assume the referenced row still exists;
`discard` (not retry) on not-found when deletion means the work is moot.

## 5. Retries, backoff, jitter, budgets

Retry only errors that can succeed later: timeouts, connection resets,
5xx, 429, lock conflicts, deadlocks. Do not retry validation failures,
4xx (except 408/429), "not found" where the row was deleted, or
programming errors; those go straight to the dead letter.

Exponential backoff with full jitter (AWS's recommendation):

```
delay = random(0, min(cap, base * 2^attempt))
base = 1s, cap = 5-15 min for background jobs
```

Typical schedules:

- Transient-API job: 5 attempts over ~15 min (`1s, 2s, 4s, 8s, 16s` × jitter
  × a multiplier), then dead letter.
- Email/webhook delivery: 8-10 attempts over ~24 h (`1m, 5m, 30m, 2h, 6h,
  12h, 24h`), then dead letter with alert.
- Database deadlock: 3 immediate-ish retries (`50ms, 200ms, 1s`).

Library knobs: BullMQ `attempts, backoff: { type: "exponential", delay:
1000 }` (add jitter via a custom strategy); Sidekiq default 25 retries
over ~21 days (too long for most things; set `retry: 8`); Celery
`autoretry_for, retry_backoff=True, retry_backoff_max, retry_jitter=True,
max_retries`; Laravel `$tries, $backoff = [10, 60, 300]`; River `MaxAttempts`
with its default exponential schedule; SQS redrive `maxReceiveCount` plus
visibility timeout (set it longer than the handler's worst case or the
message is redelivered mid-work).

Retry budgets: a dependency that is down should not receive 10× traffic
from retries. Cap retries per unit time per dependency (e.g. retries ≤ 20%
of first attempts), or let a circuit breaker (`resilience.md`) short-
circuit retries while the dependency is unhealthy. Pause the queue
(BullMQ `queue.pause()`, Sidekiq `Sidekiq::Queue#pause` in Pro, SQS
consumer stop) during a known outage instead of burning attempts.

Timeouts per job: always set one (`timeout`/`time_limit`/`job_timeout`)
shorter than the queue's visibility/lock timeout, so a hung job is killed
and retried rather than silently held.

## 6. Dead letters and poison messages

After max attempts the job goes to a dead-letter queue (SQS DLQ, BullMQ
`failed` set, Sidekiq Dead set, Celery needs a custom `on_failure` or a
DLQ exchange in RabbitMQ, Laravel `failed_jobs`, River `discarded`). It
is not a trash can: alert when it grows (rate and age), inspect regularly,
fix the cause, replay. Keep the original payload and the final error
(message, stack, attempt count, first/last failure time).

Poison messages (a payload that crashes the handler every time) must not
block the queue. With FIFO or per-key ordering they will block the group;
have a fast path that detects "attempts > N" and dead-letters without
retry.

Provide an operator command to replay from the DLQ by ID or filter, and
make replays idempotent (they are just another delivery).

## 7. Transactional enqueue: outbox and DB-backed queues

Enqueuing to Redis/SQS inside a database transaction is a dual write: the
job can run before the commit (and not find the row) or run after a
rollback (and act on nothing). Three correct options:

1. **DB-backed queue in the same database** (pg-boss, graphile-worker,
   River, GoodJob, Solid Queue, Procrastinate, Oban, Laravel `database`
   driver when using the same connection). The enqueue is a row insert in
   your transaction; it is committed or rolled back with everything else.
2. **Outbox table + relay** (`architecture.md` section 8). Same guarantee
   for external brokers.
3. **Enqueue after commit** (`transaction.on_commit`, Rails `after_commit`
   / `enqueue_after_transaction_commit`, Laravel `afterCommit`, Spring
   `@TransactionalEventListener(AFTER_COMMIT)`). Weaker: if the process
   dies between commit and enqueue, the job is lost. Acceptable for
   non-critical work (analytics ping); not for "charge the card" or "send
   the order to the warehouse".

Never enqueue *before* the commit without one of these.

## 8. Scheduling and cron

Options: the queue's scheduler (BullMQ repeatable jobs / Job Schedulers,
Celery Beat, Sidekiq-cron / Sidekiq Enterprise periodic, GoodJob cron,
Solid Queue recurring, Laravel `schedule:run`, River periodic jobs, Quartz,
JobRunr recurring), Kubernetes CronJob, cloud schedulers (EventBridge
Scheduler, Cloud Scheduler) hitting an endpoint or enqueuing, or
`systemd` timers.

Rules:

- **One instance runs the tick.** With several app replicas, a naive cron
  in each runs N times. Use a scheduler that is single-leader (Celery
  Beat with one process, Solid Queue's dispatcher, BullMQ job schedulers
  which dedupe by key), a distributed lock (ShedLock, Redis `SET NX PX`,
  Postgres advisory lock), or `onOneServer()`. Verify in staging with two
  replicas.
- **The tick enqueues, the worker works.** A scheduler that runs the
  30-minute report inline blocks the next tick. Cron job = "enqueue
  `GenerateReport`".
- **Idempotent by period.** Key the work by the period (`invoice:2026-10`)
  so a double tick or a replay is a no-op.
- **Catch-up policy.** If the scheduler was down at 02:00, should the job
  run at 02:30 when it comes back, or skip? Decide and configure (`misfire`
  in Quartz, `coalesce` in APScheduler, "catch up" in Solid Queue).
- **Time zones and DST.** Store schedules in UTC or an explicit zone;
  "daily at 02:30 local" does not exist on DST-change day. Avoid 00:00
  (everything else runs then too).
- **Overlap.** A job still running when the next tick fires: skip
  (`withoutOverlapping`, a lock keyed by job name) or queue, not both at
  once.

## 9. Long-running work, progress, cancellation

Work over a few minutes (imports, exports, media processing, bulk
updates) needs:

- **A record** (`operations` or `jobs` table) with `id, type, status
  (pending|running|succeeded|failed|cancelled), progress (0-1 or
  done/total), result, error, started_at, finished_at, requested_by`,
  exposed via `GET /operations/{id}` (`api-design.md` section 12).
- **Chunking.** Process in batches (1,000 rows, 10 files); checkpoint
  progress to the record after each batch; on retry, resume from the
  checkpoint rather than restarting. The job's payload carries the
  operation ID, not the data.
- **Heartbeats** so a dead worker is detected: the worker updates
  `heartbeat_at` every N seconds; a reaper marks operations with stale
  heartbeats as failed/retryable. Queue lock extension (BullMQ `lockDuration`
  + `extendLock`, SQS `ChangeMessageVisibility`, Sidekiq's reliability in
  Pro) keeps the queue from redelivering mid-work.
- **Cancellation.** The handler checks a `cancel_requested` flag between
  batches and exits cleanly. There is no safe way to kill a job mid-batch
  from outside without leaving partial state.
- **Fan-out/fan-in** for parallelism: a parent job splits into child jobs
  (BullMQ flows, Celery chords/groups, Sidekiq batches, Laravel `Bus::batch`,
  River with a completion job keyed on the batch); the parent completes
  when all children do. Each child idempotent; the fan-in idempotent too.
- **Result delivery**: store the result (or a URL to a stored file) on the
  record; notify via webhook/SSE/email as a separate job.

## 10. Concurrency, rate limits, priority, fairness

- Separate queues by latency class (`critical`, `default`, `low`, `bulk`),
  with dedicated worker concurrency, so a 100k-row import does not delay
  password-reset emails. Workers can consume several queues in priority
  order (Sidekiq `-q critical,3 -q default,2 -q low,1`).
- Per-tenant fairness: a tenant that enqueues 50k jobs should not starve
  others. Options: per-tenant concurrency limits (BullMQ groups via
  pro/pattern, Solid Queue `limits_concurrency`, Oban partitioned rate
  limits), round-robin across tenant sub-queues, or a token bucket keyed
  by tenant in the handler that reschedules when exhausted.
- Rate-limited dependencies: limit worker concurrency to the provider's
  budget (BullMQ `limiter: { max, duration }`, Sidekiq Enterprise rate
  limiting, Celery `rate_limit`, Laravel `RateLimited` middleware), honor
  `Retry-After` on 429 by rescheduling with that delay.
- Worker concurrency sizing: I/O-bound handlers can run 10-50 per process;
  CPU-bound 1 per core; database-heavy handlers are bounded by the
  connection pool (each concurrent job needs a connection).
- Delayed jobs (`delay`, `perform_in`, `apply_async(eta=)`) for "send a
  reminder in 24h"; keep in mind the delayed set can grow large and some
  queues scan it linearly.

## 11. Worker process hygiene

- Separate process type from the web server (`Procfile`: `web`, `worker`,
  `scheduler`); scale independently; same codebase and config.
- Graceful shutdown on SIGTERM: stop fetching, finish the current job (or
  checkpoint and release it), close connections, exit within the grace
  period. Every library has a hook (`worker.close()`, Sidekiq's `TERM`
  handling with `-t 25`, Celery warm shutdown, `queue:work` respects
  `queue:restart`, River `Stop`). Verify by sending SIGTERM mid-job.
- Memory: long-lived workers leak; set a max jobs per process or memory
  threshold with restart (`--max-tasks-per-child`, Sidekiq's `sidekiq-
  memory-killer` approach, BullMQ sandboxed processors).
- Isolation of untrusted or crash-prone work (image libraries, PDF
  renderers): run in a sandboxed subprocess so a segfault kills the job,
  not the worker.
- Health: expose liveness (process alive, loop running) and readiness
  (connected to broker) for the orchestrator; export queue depth and
  oldest-job age as metrics.
- Deploys: workers may run old code against new payloads and vice versa
  during a rollout. Payload changes must be backward compatible for one
  deploy cycle (add fields, do not rename; version the job name if
  needed).

## 12. Payload design

- Small: IDs and the minimum parameters. Reload entities in the handler.
  Payloads over a few KB belong in a store with a reference in the job.
- Serializable and stable: JSON with explicit field names, not language
  objects (Python pickle, Ruby Marshal) that break across versions and
  are security hazards.
- Carry context: `tenant_id`, `request_id`/`trace_id` (for correlation),
  `enqueued_at`, `actor_id` if the job acts on someone's behalf, a
  `version` if the shape may change.
- Deterministic job IDs for dedup when the queue supports it (`jobId:
  "confirm:order:123"` in BullMQ, `_job_id` in arq, `unique_for` in
  Sidekiq Enterprise / sidekiq-unique-jobs, `ShouldBeUnique` in Laravel,
  `UniqueOpts` in River).

## 13. Observability for jobs

One structured log line per job attempt: `job_id, job_type, queue,
attempt, status, duration_ms, tenant_id, request_id`, plus the error on
failure. Metrics per job type: enqueued, started, succeeded, failed,
retried counts; duration histogram; queue depth and oldest-job age per
queue (the age is the one to alert on: "jobs waiting > 5 min in
`critical`"). Trace propagation: inject the trace context into the
payload at enqueue and start the handler span as a child (OpenTelemetry
has messaging semantic conventions). Dashboards: Bull Board/Arena, Sidekiq
Web, Flower (Celery), Horizon, River UI, Oban Web. More in
`observability.md`.

## 14. Testing jobs

- Unit-test the handler function with the payload as input and fakes for
  external services; include the "run twice" test and the "row deleted"
  test.
- Test enqueueing at the use-case level with the queue faked (`Queue::
  fake`, `have_enqueued_job`, BullMQ with a mock or `ioredis-mock`, Celery
  eager mode) asserting payload shape, and separately that enqueue
  happens after commit (a test that rolls back the transaction and asserts
  nothing was enqueued).
- At least one integration test through the real broker in CI (Redis or
  Postgres container) that enqueues, runs a worker, and asserts the
  effect; this catches serialization and timing bugs eager mode hides.
- Scheduling: test that the cron expression parses and that the tick
  enqueues the expected job, not that time passes.
- More in `testing.md`.

## 15. Anti-patterns with fixes

- **Email/API call in the request handler.** Fix: enqueue.
- **Enqueue before commit** (job runs, row missing). Fix: DB-backed queue,
  outbox, or after-commit hook.
- **Non-idempotent handler** (double charge, double email). Fix: section 4.
- **Passing the whole object in the payload.** Fix: IDs; reload.
- **Infinite retries, or retries on 4xx.** Fix: bounded attempts, retryable
  predicate, DLQ.
- **Fixed-interval retry without jitter** → synchronized retry storms.
  Fix: exponential with full jitter.
- **No job timeout** → hung worker slot forever. Fix: set it below the
  lock/visibility timeout.
- **Cron on every replica.** Fix: single-leader scheduler or lock.
- **Scheduler doing the work inline.** Fix: tick enqueues.
- **One queue for everything.** Fix: queues by latency class.
- **Dead letter queue nobody watches.** Fix: alert on size and age; replay
  tooling.
- **Polling a `jobs` table with `SELECT ... WHERE status='pending'` in a
  `while true` loop you wrote yourself.** Fix: a real DB-backed queue
  library that does `SKIP LOCKED`, retries and visibility correctly.
- **Celery eager mode in all tests.** Fix: one real-broker test.
- **Workers that ignore SIGTERM** and get killed mid-job on every deploy.
  Fix: graceful shutdown; verify.
