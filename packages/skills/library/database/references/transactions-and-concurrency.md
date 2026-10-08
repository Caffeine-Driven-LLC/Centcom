# Transactions and concurrency

What goes wrong when two things happen at once, and the tools that prevent
it: the anomalies with runnable examples, isolation levels per engine and
what each actually guarantees, row locking (`FOR UPDATE`, `SKIP LOCKED` for
queues, `NOWAIT`), deadlock diagnosis and prevention, optimistic concurrency
with version columns, idempotent writes, why long transactions hurt, and
advisory locks. Application-level transaction wiring (where the transaction
boundary sits in a service layer) is `backend`; this file is what the
database does and how to use it correctly.

## Contents

1. What a transaction is for
2. The anomalies, with examples
3. Isolation levels per engine
4. Pessimistic locking: FOR UPDATE and friends
5. Queues: FOR UPDATE SKIP LOCKED
6. Deadlocks: diagnosis and prevention
7. Optimistic concurrency with version columns
8. Idempotent writes
9. Long transactions and why they hurt
10. Advisory locks
11. Serializable in practice
12. Patterns catalogue

## 1. What a transaction is for

A transaction makes a set of statements atomic (all or nothing), isolated
(to a chosen degree) from concurrent transactions, and durable once
committed. Use one when:

- Several writes must succeed or fail together (debit and credit; insert
  order and lines; update a row and append to an audit log).
- A read must be consistent with a write that follows it (read balance,
  then withdraw) and you intend to lock or detect conflicts.
- A report needs a consistent snapshot across several queries.

Do not use one to "group statements for tidiness" with no invariant, and
never hold one open across a network call, a queue publish, a user
interaction, or a `sleep`. Short transactions are the whole game.

Autocommit: in most drivers each statement is its own transaction unless
you begin one. Some ORMs (Django by default, Rails for `save` callbacks,
Hibernate via Spring `@Transactional`) wrap requests or service methods;
know which model your repo uses, because it determines what "atomic" means
in your code.

## 2. The anomalies, with examples

Two sessions, A and B. Default isolation (Postgres Read Committed) unless
noted.

**Dirty read** (reading uncommitted data): not possible in Postgres at any
level; possible in MySQL only at `READ UNCOMMITTED`. Ignore.

**Non-repeatable read**: A reads a row, B updates and commits it, A reads
again and sees a different value.

```sql
-- A                                    -- B
begin;
select balance from accounts where id=1;  -- 100
                                         update accounts set balance = 50 where id=1; commit;
select balance from accounts where id=1;  -- 50 (Read Committed) / 100 (Repeatable Read)
```

Harmful when A computes something from the first read and writes based
on it.

**Lost update**: both read 100, both compute 100 - 30, both write 70; one
withdrawal vanished.

```sql
-- A                                    -- B
begin;                                   begin;
select balance from accounts where id=1; -- 100
                                         select balance from accounts where id=1; -- 100
update accounts set balance = 70 where id=1;
                                         update accounts set balance = 70 where id=1; -- waits for A's lock
commit;
                                         -- B's update proceeds; balance = 70. Should be 40.
                                         commit;
```

Read Committed permits this. Fixes: `update ... set balance = balance - 30`
(atomic in one statement), `select ... for update` before the read,
Repeatable Read in Postgres (B's update fails with a serialization error
because the row changed), or a version column (section 7).

**Phantom read**: A runs `select count(*) from seats where booked = false`
twice; B inserts or books a seat between; the count changes. Repeatable
Read in Postgres prevents phantoms (snapshot); MySQL Repeatable Read
prevents them for plain reads via snapshot and for locking reads via gap
locks.

**Write skew**: the one that survives Repeatable Read. Two doctors on
call; rule: at least one must remain. Both check "count on call >= 2",
both see 2, both remove themselves, zero on call.

```sql
-- A (doctor 1)                                  -- B (doctor 2)
begin isolation level repeatable read;           begin isolation level repeatable read;
select count(*) from oncall where shift=5;  -- 2
                                                 select count(*) from oncall where shift=5;  -- 2
delete from oncall where shift=5 and doctor=1;
                                                 delete from oncall where shift=5 and doctor=2;
commit;                                          commit;   -- both succeed; invariant broken
```

Neither transaction updated a row the other read, so snapshot isolation
is satisfied. Fixes: Serializable (Postgres SSI detects the dependency
and aborts one), or materialize the conflict: lock a row that represents
the invariant (`select ... from shifts where id=5 for update` first), or
express the invariant as a constraint (a counter column with a check,
updated in the same transaction).

**Check-then-insert race** (the duplicate signup): both check "email
exists?" (no), both insert. Fix: unique constraint, always; handle the
violation (or use `on conflict do nothing` / upsert). No isolation level
short of Serializable prevents this without the constraint, and the
constraint is cheaper.

**Read-your-writes across replicas**: not an isolation anomaly but feels
like one; see `scaling-and-operations.md`.

## 3. Isolation levels per engine

| Level | Postgres | MySQL InnoDB | SQLite | SQL Server | Oracle |
|---|---|---|---|---|---|
| Default | Read Committed | Repeatable Read | Serializable (one writer; `read_uncommitted` only via shared cache) | Read Committed (locking) | Read Committed |
| Read Committed | Each statement sees data committed before *it* started | Same; no gap locks for most statements | n/a | Blocking reads unless RCSI | Statement snapshot |
| Repeatable Read | Transaction-wide snapshot; concurrent updates to a row you update cause `could not serialize access` (40001); no phantoms | Snapshot for plain reads; locking reads use next-key/gap locks; `UPDATE` sees the *latest* committed version (semi-consistent read), which can surprise | n/a | Lock-based | n/a (uses Serializable) |
| Serializable | SSI: true serializability with predicate tracking; aborts with 40001 on dangerous structures; retry required | Converts plain `SELECT` to `SELECT ... FOR SHARE` (lock-based); more deadlocks | the default | Lock-based with range locks | Snapshot (not truly serializable; write skew possible) |

Setting: `begin isolation level repeatable read;` or `set transaction
isolation level serializable;` as the first statement in the transaction;
`default_transaction_isolation` per database/role. MySQL `set session
transaction isolation level read committed` or `transaction_isolation` in
config.

Practical guidance:

- Postgres Read Committed plus explicit locking or constraints handles
  most OLTP correctly and with the fewest surprises.
- Postgres Repeatable Read for reports that read many tables and must be
  consistent, and for read-modify-write where you would rather retry than
  lock.
- Postgres Serializable when invariants span rows and you want the
  database to prove correctness (financial ledgers, booking systems).
  You must retry on `40001`, and long transactions increase abort rates.
- MySQL: consider switching to Read Committed globally for web workloads
  to avoid gap-lock deadlocks; use `FOR UPDATE` for read-modify-write.

Every engine with snapshot isolation needs your application to **retry
serialization failures** (Postgres `40001`, MySQL `1213`/`1205`, SQLite
`SQLITE_BUSY`). Retrying means the whole transaction's work is redone from
the start, so the transaction body must be free of side effects (no email
sent in the middle).

## 4. Pessimistic locking: FOR UPDATE and friends

```sql
begin;
select balance from accounts where id = $1 for update;   -- row lock until commit; other FOR UPDATE / UPDATE on this row wait
-- compute
update accounts set balance = $2 where id = $1;
commit;
```

Variants:

- `for update`: exclusive row lock; blocks other `for update`, `for
  share`, `update`, `delete` on the row. Plain reads are never blocked
  (MVCC).
- `for no key update`: like `for update` but allows concurrent inserts of
  child rows referencing this row (FK checks take `for key share`). Use
  it when you lock a parent while inserting children elsewhere, to reduce
  contention. Most ORMs emit `for update`.
- `for share` / `for key share`: shared locks; prevent updates/deletes
  but allow other shared lockers. Rarely what you want in app code.
- `nowait`: error immediately instead of waiting (`55P03`). For
  "try to acquire, else tell the user".
- `skip locked`: skip rows someone else has locked. The queue primitive
  (next section).
- `for update of t`: lock only rows of table `t` in a join.

Lock ordering: `select ... where id in (...) order by id for update`.
Without the `order by`, two transactions locking the same set in different
orders deadlock.

Locks are released at commit/rollback, never earlier (no unlock
statement for row locks). Hence: short transactions.

MySQL: same syntax (`FOR UPDATE`, `FOR SHARE`, `NOWAIT`, `SKIP LOCKED`
from 8.0), with gap locking under Repeatable Read; locking a range
(`where created_at > ...`) locks the gap, blocking inserts into it.

ORM access: Prisma has no `forUpdate` (use `$queryRaw`), Drizzle
`.for('update')`, Kysely `.forUpdate()`, TypeORM `setLock('pessimistic_write')`,
SQLAlchemy `.with_for_update(skip_locked=True)`, Django
`select_for_update(skip_locked=True, of=(...))` (must be inside
`transaction.atomic()`), ActiveRecord `.lock` / `.lock("FOR UPDATE SKIP
LOCKED")`, Ecto `lock: "FOR UPDATE SKIP LOCKED"`, GORM
`clause.Locking{Strength: "UPDATE"}`, JPA `LockModeType.PESSIMISTIC_WRITE`,
Eloquent `->lockForUpdate()`.

## 5. Queues: FOR UPDATE SKIP LOCKED

A job table as a queue, workers polling concurrently, no job processed
twice, no worker blocked by another:

```sql
-- claim
with next as (
  select id from jobs
  where state = 'pending' and run_at <= now()
  order by priority desc, run_at
  limit 10
  for update skip locked
)
update jobs j
set state = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
from next where j.id = next.id
returning j.*;
```

Index: `(state, run_at)` partial `where state = 'pending'`, or `(priority
desc, run_at) where state = 'pending'`. The claim is one round trip and
commits immediately (short transaction); the job then runs *outside* the
transaction; completion is a separate `update jobs set state = 'done'`.
Stuck jobs (worker died) are recovered by a sweeper: `update jobs set state
= 'pending' where state = 'running' and locked_at < now() - interval '10
minutes'`. Add a `max_attempts` and a dead-letter state.

This is what Solid Queue, Oban, Que, good_job, pg-boss, graphile-worker,
River and Procrastinate do under the hood. Use one of them rather than
hand-rolling if the repo's ecosystem has one; the pattern above is for
understanding and for small custom needs.

Vacuum: a hot queue table churns rows; tune autovacuum aggressively for it
and partition or truncate done jobs regularly.

## 6. Deadlocks: diagnosis and prevention

A deadlock is two transactions each waiting for a lock the other holds.
The database detects it (Postgres after `deadlock_timeout`, 1s; InnoDB
immediately) and aborts one with an error (`40P01` Postgres, `1213` MySQL).
The application must retry.

Diagnosis in Postgres: the log line shows both processes and the
statements:

```
ERROR:  deadlock detected
DETAIL:  Process 1234 waits for ShareLock on transaction 5678; blocked by process 1235.
         Process 1235 waits for ShareLock on transaction 5677; blocked by process 1234.
         Process 1234: update accounts set balance = ... where id = 2
         Process 1235: update accounts set balance = ... where id = 1
```

Two transfers, 1→2 and 2→1, each locked its first row and wanted the
second. `log_lock_waits = on` logs waits beyond `deadlock_timeout` even
when they are not deadlocks, which finds contention early. MySQL: `SHOW
ENGINE INNODB STATUS` section `LATEST DETECTED DEADLOCK`;
`innodb_print_all_deadlocks = ON` to log all.

Live blocking (not yet a deadlock) in Postgres:

```sql
select blocked.pid as blocked_pid, blocked.query as blocked_query,
       blocking.pid as blocking_pid, blocking.query as blocking_query,
       now() - blocked.query_start as waiting
from pg_stat_activity blocked
join pg_stat_activity blocking on blocking.pid = any(pg_blocking_pids(blocked.pid));
```

Prevention:

1. **Lock in a consistent order.** Sort IDs before locking
   (`order by id for update`); always lock parent before child; always
   update tables in the same order across code paths.
2. **Lock everything you will need at the start** of the transaction in
   one statement, rather than acquiring incrementally.
3. **Shorten transactions.** Deadlock probability grows with duration
   times concurrency.
4. **Index your update/delete predicates** so you lock a row, not a scan
   (critical on InnoDB).
5. **Avoid FK contention**: inserting a child takes `for key share` on
   the parent; updating the parent's primary/unique key columns (or on
   older versions, any column) conflicts. Use `for no key update` when
   locking parents.
6. **Retry on deadlock** with a small random backoff, a bounded number of
   times, with the transaction body side-effect free.
7. Hot single rows (a global counter, a tenant's `updated_at`) serialize
   everything; shard the counter or move it out of the transaction.

## 7. Optimistic concurrency with version columns

When conflicts are rare and holding locks across user think-time is
unacceptable (an edit form), read the version with the row and make the
write conditional:

```sql
-- read
select id, title, body, version from documents where id = $1;    -- version = 7

-- write, later
update documents
set title = $2, body = $3, version = version + 1, updated_at = now()
where id = $1 and version = 7;
-- rows affected = 0 means someone else saved first: reload, merge or tell the user
```

Variants: compare `updated_at` instead of a counter (works, but two saves
in the same microsecond collide; a counter is cleaner); use an ETag
derived from the version in HTTP (`If-Match`). ORMs: Hibernate `@Version`,
Rails `lock_version` column (optimistic locking is automatic when the
column exists), Django (manual, or `django-concurrency`), SQLAlchemy
`version_id_col` mapper option, TypeORM `@VersionColumn`, Prisma (manual
`where: { id, version }` with `updateMany` and check `count`), Ecto
`optimistic_lock`, GORM (manual or plugin), Eloquent (manual), EF Core
`[ConcurrencyCheck]`/`IsRowVersion()`.

Optimistic beats pessimistic when: conflicts are rare, transactions span
user interaction, or you are behind a pooler that makes long locks
impossible. Pessimistic beats optimistic when: conflicts are common (hot
inventory row) and retry storms would be worse than waiting.

## 8. Idempotent writes

Any write triggered from outside (webhook, retried HTTP request, message
redelivery, double-clicked button) will eventually arrive twice. Make the
second arrival harmless:

- **Idempotency key table**: `create table idempotency_keys (key text
  primary key, response jsonb, created_at timestamptz)`. Insert the key
  first (`on conflict do nothing`); if 0 rows inserted, return the stored
  response. Expire old keys. Do the insert in the same transaction as the
  work so a crash mid-way leaves no key.
- **Natural uniqueness**: `unique (provider, external_event_id)` on
  webhook events; `insert ... on conflict do nothing returning id`; if
  nothing returned, already processed.
- **Absolute instead of relative updates** where possible (`set status =
  'paid'` is idempotent; `set balance = balance - 10` is not; make the
  latter conditional on a state transition: `where status = 'pending'`).
- **State machine guards**: `update orders set status = 'shipped' where id
  = $1 and status = 'paid'`; zero rows affected means already shipped or
  not yet paid; branch on that.
- Combine with the outbox pattern for "write to DB and publish an event"
  (the publish side is `backend`); the database side is an `outbox` table
  written in the same transaction and drained by a worker with `SKIP
  LOCKED`.

## 9. Long transactions and why they hurt

A transaction open for minutes:

- Holds every row lock it took, blocking writers and, worse, blocking DDL
  (an `ALTER TABLE` waits for it, and everything queues behind the
  `ALTER`).
- Pins the snapshot: vacuum cannot remove dead tuples newer than the
  oldest snapshot, so every hot table bloats while it runs
  (`pg_stat_activity.backend_xmin` and `age(backend_xmin)` show the
  culprit).
- Increases serialization failures and deadlocks for everyone else.
- Behind a pooler in transaction mode, holds a server connection
  hostage.
- On replicas with `hot_standby_feedback`, delays vacuum on the primary
  too.

Sources: ORMs that open a transaction at request start and commit at end
(fine if requests are fast; terrible when a request calls a slow third
party), batch jobs that process a million rows in one transaction, `psql`
sessions left open with `begin;` and no commit, idle-in-transaction
connections from a crashed worker. Set
`idle_in_transaction_session_timeout` and `statement_timeout`; batch
long jobs into many short transactions; move external calls outside the
transaction (write intent, commit, call, write result).

## 10. Advisory locks

Application-defined locks keyed by an integer (or two), unrelated to any
row, held for a session or a transaction:

```sql
select pg_advisory_xact_lock(hashtext('invoice-numbering:' || $1));   -- blocks until acquired; released at commit
select pg_try_advisory_xact_lock(42);                                  -- returns false immediately if held
select pg_advisory_lock(42); ... select pg_advisory_unlock(42);        -- session-level; must unlock; dangerous with poolers
```

Use for: serializing a process that must run once at a time across
instances (a scheduler tick, a migration runner, a cache rebuild);
mutexes around operations that do not map to a row (allocating the next
invoice number per tenant per year, when you have not materialized a
counter row); leader election in a simple form.

Prefer transaction-level (`_xact_`) locks: they cannot leak. Session-level
locks behind PgBouncer transaction mode are a bug (the next client on the
connection inherits them). MySQL has `GET_LOCK(name, timeout)` /
`RELEASE_LOCK(name)` (session-level only). SQLite has the single writer
lock, which already serializes.

Rails `with_advisory_lock` gem, Django `django-pglocks`, Ecto with raw
`Repo.query`, Prisma via `$executeRaw` inside `$transaction`, Hibernate via
native query.

## 11. Serializable in practice

Postgres Serializable (SSI) gives true serializability with roughly 10-30%
overhead on contended workloads and the requirement to retry `40001`.
Practical rules:

- Wrap the whole transaction body in a retry loop (3-5 attempts, jittered
  backoff), catching the serialization failure class specifically.
- Keep transactions short and touch few rows; SSI tracks predicate locks
  and long or wide transactions abort more.
- Read-only transactions can declare `read only deferrable` to wait for
  a safe snapshot and never abort.
- `max_pred_locks_per_transaction` may need raising for wide scans.
- Mixed levels in one system do not give serializability; the invariant's
  transactions must all run Serializable.

MySQL's Serializable is lock-based and heavier; most MySQL systems use
Repeatable Read or Read Committed plus explicit locks. Oracle and SQL
Server snapshot isolation are not serializable; write skew exists there.

## 12. Patterns catalogue

| Need | Pattern |
|---|---|
| Ensure uniqueness under concurrency | Unique index; handle the violation or upsert |
| Read-modify-write on one row | Single-statement atomic update (`set x = x + 1`); else `for update`; else version column |
| Transfer between two rows | Lock both in id order with `for update`, or one `update ... from (values ...)` statement; Serializable for ledgers |
| Invariant across many rows (capacity, on-call minimum) | Serializable, or lock a representative row (`for update` on the parent), or maintain a counter column with a `check` |
| Job queue | `for update skip locked`, short claim transaction, sweeper for stale claims |
| Rate limit / counter | Atomic `update ... returning`, or Redis `INCR`; shard hot counters |
| Idempotent external trigger | Idempotency key table or natural unique key with `on conflict do nothing` |
| Edit form with stale detection | Version column / ETag; optimistic |
| One-at-a-time process across instances | Transaction-level advisory lock |
| Generate gapless sequence numbers | Counter row per scope, `select ... for update`, increment, use; never a sequence |
| Insert parent and children atomically | One transaction; `returning id` from the parent; `insert ... select` for children |
| Prevent double-booking of a resource over a time range | Exclusion constraint on `(resource_id with =, during with &&)` |
| Read a consistent multi-table report | `begin isolation level repeatable read; ... commit;` (or `read only`) |
| Long-running import | Many short transactions by batch; a `progress` row updated per batch; resume from it |
