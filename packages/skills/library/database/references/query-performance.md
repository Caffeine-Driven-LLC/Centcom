# Query performance

How to find the slow query, read its plan, and fix it: EXPLAIN ANALYZE
walkthroughs for the common plan problems, keyset pagination, batch upserts,
avoiding `SELECT *`, N+1 detection from the database side, statement
timeouts, the `pg_stat_statements` workflow, and how to see the SQL each ORM
generates. The annotated plan examples live in `postgres.md` section 8;
this file is the method and the fixes.

## Contents

1. Workflow: from "it's slow" to a fix
2. Finding the culprits: pg_stat_statements and friends
3. Plan problems and their fixes
4. Pagination: keyset over offset
5. Batch operations and upserts
6. SELECT * and payload discipline
7. N+1 from the data side
8. Timeouts and guardrails
9. Inspecting ORM-generated SQL, per ORM
10. Realistic test data for performance work
11. Common query rewrites

## 1. Workflow: from "it's slow" to a fix

1. **Define slow.** p95 latency of which endpoint or job, under what
   load, against what data volume. "The dashboard takes 20 seconds" is a
   start; "the `/reports/monthly` endpoint, 20s p95, 50M rows in `events`"
   is a problem statement.
2. **Find the statement(s).** Application tracing (which query inside the
   request is slow), `pg_stat_statements`, the slow query log, or the
   ORM's query log with timings. Frequently the "slow query" is 400 fast
   queries (N+1).
3. **Reproduce on realistic data.** A query that is fast on 1,000 rows
   tells you nothing. Use production-like volume (an anonymized dump,
   `generate_series`, factories at scale); see section 10.
4. **EXPLAIN (ANALYZE, BUFFERS)** the exact statement with the exact
   parameter values (plans differ by value; a rare status vs a common one).
   Save the JSON and run `scripts/explain_summary.py` to find the hot node.
5. **Diagnose the node**: missing index, wrong index, bad estimate, wrong
   join strategy, sort spill, lossy bitmap, too many rows requested, N
   loops.
6. **Fix one thing.** Index, rewrite, statistics, pagination, batching.
   Re-run EXPLAIN. Compare buffers and time, not just time (cache state
   varies).
7. **Confirm in the app.** The ORM must actually emit the query you tuned.
   Log it and check.
8. **Guard it.** Statement timeout, a test with realistic volume if the
   query is critical, and a note in the PR about the index and the
   expected plan.

## 2. Finding the culprits

### pg_stat_statements

Enable (`shared_preload_libraries = 'pg_stat_statements'`, restart,
`create extension pg_stat_statements`). Then the two queries you will run
for the rest of your career:

```sql
-- by total time: what the database spends its life on
select calls, round(total_exec_time::numeric, 0) as total_ms,
       round(mean_exec_time::numeric, 2) as mean_ms,
       round(100 * total_exec_time / sum(total_exec_time) over (), 1) as pct,
       rows, shared_blks_hit, shared_blks_read,
       left(query, 120) as query
from pg_stat_statements
order by total_exec_time desc limit 20;

-- by mean time: the individually slow ones
select calls, round(mean_exec_time::numeric, 1) as mean_ms,
       round(max_exec_time::numeric, 1) as max_ms, left(query, 120)
from pg_stat_statements
where calls > 10
order by mean_exec_time desc limit 20;
```

Reading them: high `calls` with low `mean_ms` and a high share of total is
an N+1 or a chatty loop (fix the application); low `calls` with high `mean`
is a bad plan (fix the query/index); high `shared_blks_read` relative to
`hit` is a cache-miss workload (the working set does not fit, or a scan
is flushing the cache). `pg_stat_statements_reset()` after a deploy to see
the new baseline. The `query` is normalized (`$1` placeholders), so to
EXPLAIN it you need real values from the app log.

### Others

- `log_min_duration_statement = 500` and `auto_explain` with
  `auto_explain.log_min_duration = '1s'`, `log_analyze = on`,
  `log_buffers = on`: plans of slow queries land in the log with real
  timings. Use `log_timing = off` if the overhead matters.
- `pg_stat_activity` for what is running *now* and what it waits on:
  ```sql
  select pid, now() - query_start as runtime, state, wait_event_type, wait_event, left(query, 100)
  from pg_stat_activity where state <> 'idle' order by runtime desc;
  ```
- MySQL: `performance_schema.events_statements_summary_by_digest`
  (`SUM_TIMER_WAIT`, `COUNT_STAR`, `SUM_ROWS_EXAMINED`), the slow log with
  `pt-query-digest`, `sys.statements_with_full_table_scans`.
- SQLite: no server-side stats; time in the application and `EXPLAIN QUERY
  PLAN` each candidate.
- Mongo: the profiler (`db.setProfilingLevel(1, { slowms: 100 })`) and
  `explain("executionStats")`.

## 3. Plan problems and their fixes

Each pattern: how it looks, why, what to do. Annotated plan text is in
`postgres.md` section 8.

| Symptom in the plan | Usual cause | Fix |
|---|---|---|
| `Seq Scan` on a large table with a `Filter` removing most rows | No index on the filter column(s), or expression/cast on the column | Composite index on the equality columns then the range/sort column (`indexing.md`); remove the function from the column side |
| `Index Scan` with `Filter` and large `Rows Removed by Filter` | Index covers part of the predicate; the rest is checked per row | Add the filtered column to the index (after equality cols) or make a partial index |
| `Nested Loop` with inner `loops=` in the thousands and a big inner result | Planner underestimated the outer row count (`rows=12` vs `actual rows=48000`) | `ANALYZE`; extended statistics for correlated columns; fix the predicate it cannot estimate; as a last resort `set enable_nestloop = off` for that session to confirm hash join is faster, then fix stats |
| `Hash Join` with `Batches: 8` or `Hash Join` where the hashed side is huge | `work_mem` too small for the hash table, or the wrong side hashed | Raise `work_mem` for the session; reduce the hashed side with a selective filter first; check estimates |
| `Sort Method: external merge Disk:` | Sort does not fit `work_mem` | Index matching `ORDER BY` (with filter columns first); `LIMIT` for top-N; `set local work_mem` for reports |
| `Bitmap Heap Scan` with `lossy=` blocks | Bitmap exceeded `work_mem` | More selective predicate, partial index, or more `work_mem` |
| `Index Only Scan` with `Heap Fetches:` in the thousands | Visibility map not set (recent heavy writes, no vacuum) | `VACUUM (ANALYZE) table`; tune autovacuum for that table |
| `Index Scan` reading millions of rows (`Buffers: read=` huge) slower than a seq scan would be | `random_page_cost` too high/low, or estimate low | Set `random_page_cost = 1.1` on SSD; BRIN or partitioning for time ranges; let the planner seq scan |
| `Materialize` or `CTE Scan` with a large row count re-read in loops | CTE used as an optimization fence (pre-PG 12 always; PG 12+ when referenced twice or `MATERIALIZED`) | Inline the CTE or `WITH ... AS NOT MATERIALIZED`; or rewrite as a subquery/join |
| `Aggregate` over millions of rows on every request | Computing a count/sum on demand | Cache the aggregate (counter column, materialized view, summary table) with a stated refresh |
| `Limit` under a `Sort` under a big scan | Sort-then-limit with no matching index | Index on `(filter cols, sort col)` so the limit stops the scan early |
| `SubPlan` executed per row (`loops=` large) in a filter | Correlated subquery the planner could not flatten (`NOT IN` with nullable column, scalar subquery in `WHERE`) | Rewrite as `NOT EXISTS` or a `LEFT JOIN ... IS NULL`; `IN` to a join |
| Row estimate `rows=1` for every node, actual thousands | Default selectivity for an opaque predicate (`jsonb ->>`, function, `LIKE '%x%'`) | Expression index (gives the planner stats on the expression), generated column, or extended stats |
| `Partitions removed:` missing on a partitioned table | Query does not filter on the partition key, or the filter is not a constant at plan time | Add the partition key to the predicate; avoid wrapping it in functions; `enable_partition_pruning = on` (default) and runtime pruning works for parameters since PG 11 |
| Parallel workers planned but `Workers Launched: 0` | `max_parallel_workers` exhausted or query inside a function | Check `max_parallel_workers_per_gather`; accept, or restructure |

MySQL equivalents: `type: ALL` is the seq scan; `Using filesort` on a
large set is the sort to kill with an index; `Using temporary` on
`GROUP BY` wants an index matching the grouping; `rows` estimate vs
`EXPLAIN ANALYZE` actual; `Using index condition` is good; `Using join
buffer (hash join)` on 8.0.18+ is fine for large joins.

## 4. Pagination: keyset over offset

`LIMIT 20 OFFSET 400000` makes the database produce 400,020 rows in order
and discard 400,000. Page 1 is fast, page 20,000 is a seq scan with a
sort, and rows shift between pages when inserts happen. Offset is
acceptable for admin UIs over a few thousand rows with a page selector;
it is wrong for infinite scroll, APIs, exports and anything large.

Keyset (cursor) pagination: remember where you stopped and seek there.

```sql
-- page 1
select id, created_at, title from posts
where author_id = $1
order by created_at desc, id desc
limit 20;

-- next page: the last row's (created_at, id) is the cursor
select id, created_at, title from posts
where author_id = $1
  and (created_at, id) < ($2, $3)              -- row comparison: Postgres, SQLite 3.15+, MySQL 8 (but MySQL may not use the index for it; expand below)
order by created_at desc, id desc
limit 20;

-- expanded form for engines that do not optimize row comparisons
where author_id = $1
  and (created_at < $2 or (created_at = $2 and id < $3))
```

Requirements: an index matching the `WHERE` equality columns followed by
the sort columns in the same direction (`(author_id, created_at desc, id
desc)`), a sort that is total (add the unique `id` as the tiebreaker; a
non-unique `created_at` alone skips or repeats rows), and an opaque cursor
to the client (base64 of the key values, or the ORM's cursor support).
Prisma has `cursor:`/`take:`, Django has `django-cursor-pagination` or
hand-rolled, Rails has `pagy` keyset mode, Drizzle/Kysely are hand-rolled
and fine.

What you lose: jumping to page N, and a total count (compute `count(*)`
separately and cache it, or show "more" instead of a count). Both are
usually fine.

Time-based "since" pagination (`where updated_at > $last_seen`) is
keyset with a single column; make the column monotonic enough (prefer an
`id` or a `(updated_at, id)` pair) or you will miss rows committed out of
order.

## 5. Batch operations and upserts

### Inserts

One `INSERT` per row in its own transaction is bounded by fsync (hundreds
to low thousands/sec). Multi-row `VALUES` in batches of 500-5000, one
transaction per batch, is 10-100x faster. `COPY` (Postgres), `LOAD DATA
INFILE` (MySQL) or the driver's bulk API (`pg`'s `COPY FROM STDIN` via
`pg-copy-streams`, psycopg3 `cursor.copy()`, `asyncpg.copy_records_to_table`,
JDBC `CopyManager`) is another 5-10x for large loads.

```sql
insert into events (tenant_id, type, payload, created_at)
select * from unnest($1::bigint[], $2::text[], $3::jsonb[], $4::timestamptz[]);  -- Postgres: one statement, arrays as params
```

### Upserts

```sql
-- Postgres / SQLite
insert into inventory (sku, qty, updated_at)
values ($1, $2, now())
on conflict (sku) do update
  set qty = inventory.qty + excluded.qty,
      updated_at = now()
where inventory.qty + excluded.qty >= 0           -- optional guard
returning sku, qty;

-- MySQL
insert into inventory (sku, qty, updated_at) values (?, ?, now(6)) as new
on duplicate key update qty = inventory.qty + new.qty, updated_at = now(6);
```

`on conflict do nothing` for idempotent inserts (event ingestion with an
idempotency key). Upserts need a unique index on the conflict target.
Postgres `ON CONFLICT` requires naming the constraint columns (or `on
constraint name`); MySQL fires on any unique key, which is a footgun with
several unique keys.

`MERGE` (Postgres 15+, SQL standard) handles insert/update/delete in one
statement when the logic is more than "update on conflict".

### Updates and deletes in batches

Never `delete from events where created_at < now() - interval '90 days'`
on a 500M-row table in one statement: one giant transaction, massive WAL,
locks, replication lag, and a rollback that takes longer than the
forward pass if it fails. Loop:

```sql
-- Postgres batch delete by primary key range or ctid-free approach
with victims as (
  select id from events
  where created_at < now() - interval '90 days'
  order by id limit 5000
  for update skip locked
)
delete from events e using victims v where e.id = v.id;
-- repeat until 0 rows; sleep 50-200ms between batches to let replicas and vacuum breathe
```

For updates (backfills), the same pattern keyed by primary key range;
see `migrations.md` for the full backfill script shape. On partitioned
tables, `drop table events_2025_01` instead.

### Many lookups

`where id in ($1, $2, ..., $5000)` is fine to a few thousand parameters
(Postgres bind limit is 65535; MySQL packet size). Beyond that, `where id
= any($1::bigint[])`, or insert the keys into a temp table and join.

## 6. SELECT * and payload discipline

`SELECT *`:

- Prevents index-only scans.
- Pulls wide columns (`body text`, `payload jsonb`, `avatar bytea`) that
  the list endpoint never shows, multiplying I/O, network and
  serialization. TOAST columns in Postgres are detoasted on read.
- Breaks when a column is added (ORMs mapping by position, or a new
  column that is expensive) and when a column is removed during an
  expand/contract migration while the old app code still runs.
- Makes the query log useless for reasoning about what the app needs.

Name the columns. In ORMs: Prisma `select:`, Drizzle `.select({ ... })`,
TypeORM `.select([...])`, SQLAlchemy `select(User.id, User.name)` or
`load_only()`, Django `.only()`/`.values()`, ActiveRecord `.select(:id,
:name)`/`.pluck`, GORM `.Select("id","name")`, Hibernate projections/DTO
constructors, Eloquent `->select([...])`. Most ORMs default to `SELECT *`
(or all mapped columns); this is a default you override on list queries
and anywhere a wide column exists.

## 7. N+1 from the data side

N+1 is visible in the database before anyone reads the application code:
`pg_stat_statements` shows a query with `calls` in the millions and `mean`
under a millisecond, normalized to `select ... from customers where id =
$1`. The application side is `orms.md`; here is how to see and prove it:

- Turn on the ORM's query log for one request and count statements. One
  list page should produce a small constant number of queries (1-5), not
  `1 + N`.
- In Postgres, `pg_stat_statements` sorted by `calls` after a single load
  test run; or `log_min_duration_statement = 0` for one minute on a
  staging instance and `grep -c` the pattern.
- Tests: assert the query count (Django `assertNumQueries`, Rails
  `assert_queries`/`assert_sql` or the `n_plus_one_control` gem, Hibernate
  statistics `getPrepareStatementCount`, Prisma `$on('query')` counter,
  SQLAlchemy event listener on `before_cursor_execute`). A query-count
  assertion on the hot list endpoint is the cheapest regression test
  there is.

The database-side fix when the ORM cannot be tamed: one query with a
join or a `lateral` subquery, or two queries (parents, then `where
parent_id = any($1)` children) joined in application memory.

```sql
-- top 3 most recent orders per customer, one query, index (customer_id, created_at desc)
select c.id, c.name, o.*
from customers c
left join lateral (
  select id, total_cents, created_at
  from orders where customer_id = c.id
  order by created_at desc limit 3
) o on true
where c.region = $1;
```

## 8. Timeouts and guardrails

- `statement_timeout` per role: `alter role app_user set statement_timeout
  = '30s'`; longer for the jobs role; `set local statement_timeout` for a
  known heavy query. A query that runs for ten minutes because of a
  missing parameter should die, not take the connection pool with it.
- `idle_in_transaction_session_timeout = '60s'`: a connection that opened
  a transaction and went to make an HTTP call is holding locks and
  blocking vacuum.
- `lock_timeout` in migrations (`set lock_timeout = '3s'`) so a DDL
  statement that cannot get its lock fails fast instead of queuing the
  whole site behind it; retry in a loop.
- Application-side query timeouts (driver `statement_timeout`/
  `query_timeout` options, `context.WithTimeout` in Go, JDBC
  `setQueryTimeout`) so the app does not hang on a hung database.
- MySQL: `max_execution_time` (session or `/*+ MAX_EXECUTION_TIME(5000)
  */` hint, SELECT only), `innodb_lock_wait_timeout`, `lock_wait_timeout`
  for DDL.
- Row limits on every list query. An endpoint with no `LIMIT` is a
  future outage.

## 9. Inspecting ORM-generated SQL, per ORM

Do this once for every new code path. The default is to trust the ORM; the
expert default is to read what it sent.

| ORM | How to see the SQL |
|---|---|
| Prisma | `new PrismaClient({ log: ['query'] })` or `log: [{ emit: 'event', level: 'query' }]` with `prisma.$on('query', e => console.log(e.query, e.params, e.duration))`; `DEBUG="prisma:query"` env var |
| Drizzle | `drizzle(client, { logger: true })` or a custom `Logger`; `.toSQL()` on any query builder for the string and params without running it |
| Kysely | `log: ['query', 'error']` in the Kysely constructor; `.compile()` returns `{ sql, parameters }` |
| Knex | `knex.on('query', ...)`; `.toSQL().toNative()`; `DEBUG=knex:query` |
| TypeORM | `logging: true` (or `['query','error']`) in DataSource options; `.getSql()` / `.getQueryAndParameters()` on a QueryBuilder |
| Sequelize | `logging: console.log` in options; `benchmark: true` |
| MikroORM | `debug: true` |
| SQLAlchemy | `create_engine(url, echo=True)` or logging `sqlalchemy.engine` at INFO; `str(stmt.compile(engine, compile_kwargs={"literal_binds": True}))` to render a statement |
| Django | `django.db.connection.queries` (with `DEBUG=True`), `str(qs.query)`, `qs.explain()`, the `django-debug-toolbar`, `assertNumQueries`; logging `django.db.backends` at DEBUG |
| ActiveRecord | `ActiveRecord::Base.logger = Logger.new($stdout)` in console; `relation.to_sql`; `relation.explain` (and `.explain(:analyze)` in Rails 7.1+); `config.active_record.verbose_query_logs = true` adds the call site; `strict_loading` raises on lazy loads |
| Ecto | `config :my_app, MyRepo, log: :debug`; `Ecto.Adapters.SQL.to_sql(:all, Repo, query)`; `Repo.explain(:all, query, analyze: true)` |
| GORM | `db.Debug().Find(...)`, or `Logger: logger.Default.LogMode(logger.Info)`; `db.ToSQL(func(tx *gorm.DB) *gorm.DB {...})` |
| sqlc / sqlx / pgx | You wrote the SQL; log at the driver (`pgx` tracer via `tracelog`, `sqlx` `DATABASE_URL` logging at the pool) |
| Hibernate / JPA | `spring.jpa.show-sql=true` (stdout; prefer logging `org.hibernate.SQL=DEBUG` and `org.hibernate.orm.jdbc.bind=TRACE` for parameters); `hibernate.generate_statistics=true` for counts; `datasource-proxy` or `p6spy` for timings |
| Eloquent | `DB::enableQueryLog(); ... DB::getQueryLog()`, `->toSql()`/`->toRawSql()` (Laravel 10+), `DB::listen(fn($q) => ...)`, Telescope, Debugbar; `Model::preventLazyLoading()` in dev |
| Entity Framework Core | `.LogTo(Console.WriteLine)`, `.ToQueryString()`; `EnableSensitiveDataLogging()` for parameters |
| Diesel / SeaORM | `diesel::debug_query::<Pg, _>(&query)`; SeaORM `.build(DbBackend::Postgres).to_string()` |
| Mongoose | `mongoose.set('debug', true)` |

While reading: count the statements; look for `SELECT *` or every mapped
column on wide tables; check that filters are on indexed columns and not
wrapped in casts (`CAST(created_at AS DATE)` from a date-only comparison
is a classic); confirm `LIMIT` is present; check `OFFSET`; confirm
transactions open and close where you expect (some ORMs wrap every
statement, some none).

## 10. Realistic test data for performance work

Generate volume quickly in Postgres:

```sql
insert into customers (name, region, created_at)
select 'customer ' || g, (array['EU','US','APAC'])[1 + g % 3], now() - (g || ' minutes')::interval
from generate_series(1, 200000) g;

insert into orders (customer_id, status, total_cents, created_at)
select 1 + (random() * 199999)::int,
       (array['draft','placed','paid','paid','paid','shipped','cancelled'])[1 + (random()*6)::int],
       (random() * 50000)::bigint,
       now() - (random() * 365 || ' days')::interval
from generate_series(1, 20000000) g;

analyze customers; analyze orders;
```

Mind skew: real data is not uniform (one tenant has 40% of rows; 90% of
orders are `paid`). Plans change with skew, so shape the generated data to
match production distributions. An anonymized production snapshot is
better still (see `testing-and-seed-data.md`). MySQL: a recursive CTE
(`with recursive seq as (select 1 n union all select n+1 from seq where n
< 1000000) ...`) with `cte_max_recursion_depth` raised, or a numbers
table. SQLite: `with recursive` likewise.

After loading, `ANALYZE`, then warm the cache by running the query twice
and comparing the second run; note `shared read` vs `hit` in `BUFFERS`.

## 11. Common query rewrites

| Slow shape | Faster shape | Why |
|---|---|---|
| `where date(created_at) = $1` | `where created_at >= $1 and created_at < $1 + interval '1 day'` | Range on the column uses the B-tree; function on the column does not |
| `where id not in (select ...)` with nullable subquery column | `where not exists (select 1 ... where x.id = t.id)` | `NOT IN` with NULLs is both wrong and unplannable |
| `select count(*) from t` for "are there any" | `select exists (select 1 from t where ...)` | Stops at the first row |
| `select distinct a.* from a join b ...` | `where exists (...)` | Avoids producing duplicates then deduplicating |
| `order by random() limit 1` | `tablesample system (1)` or random id range | `random()` sorts the whole table |
| Correlated scalar subquery per row in `SELECT` | Join to a grouped subquery or window function | One pass instead of N |
| `group by` then `having count(*) > 1` to find dupes | Same, but index the grouped columns | Index-backed grouping |
| Row-by-row `update ... where id = $1` in a loop | `update t set x = v.x from (values ...) v(id, x) where t.id = v.id` | One statement, one plan |
| `select ... for update` on many rows in app order | `order by id for update` consistently | Prevents deadlocks (see `transactions-and-concurrency.md`) |
| `like '%term%'` | trigram GIN index, or FTS | B-tree cannot do infix |
| `or` across two columns | `union all` of two queries, or two indexes with a bitmap OR | Planner handles each branch with its index |
| `offset N` | keyset | Section 4 |
| Multiple `count(*) where ...` queries | `count(*) filter (where ...)` in one query | One scan |
| `max(created_at)` per group via subquery | `distinct on (group_id) ... order by group_id, created_at desc` (Postgres) or `row_number() over (partition by ...)` | Index-friendly top-1-per-group |
