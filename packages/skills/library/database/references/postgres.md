# Postgres

Postgres-specific depth: the types worth knowing (jsonb, arrays, ranges,
enums), every index type and when it applies, row-level security,
partitioning, the extensions that matter, configuration basics, vacuum, and
how to read EXPLAIN with annotated examples. Assumes Postgres 14+ unless a
version is called out; most of it applies to Supabase, Neon, RDS, Cloud SQL,
AlloyDB and CockroachDB-with-caveats.

## Contents

1. Types
2. Indexes
3. Row-level security
4. Partitioning
5. Extensions
6. Configuration basics
7. Vacuum, autovacuum, bloat
8. Reading EXPLAIN, annotated
9. Postgres-specific gotchas

## 1. Types

### jsonb

Use `jsonb`, not `json` (`json` stores text and re-parses on every access).
Operators: `->` (element as jsonb), `->>` (as text), `#>>` (path as text),
`@>` (contains), `?` (key exists), `jsonb_path_query` (SQL/JSON path).

```sql
select id from events where payload @> '{"type": "order.paid"}';     -- GIN-able
select id from events where payload->>'type' = 'order.paid';         -- needs expression index
create index on events using gin (payload jsonb_path_ops);           -- smaller, @> only
create index on events ((payload->>'type'));                         -- B-tree on one key
```

`jsonb_path_ops` GIN indexes are smaller and faster for `@>` but do not
support `?`. Update patterns: `jsonb_set(payload, '{status}', '"done"')`,
`payload || '{"a":1}'`, `payload - 'key'`. Every update rewrites the whole
document (TOAST), so a hot counter inside a large jsonb is a bad idea.

### Arrays

```sql
create table posts (id bigint primary key, tags text[] not null default '{}');
create index on posts using gin (tags);
select * from posts where tags @> array['postgres'];      -- contains
select * from posts where tags && array['a','b'];         -- overlaps
select unnest(tags) as tag, count(*) from posts group by 1;
```

Arrays are good for small, owner-scoped lists. They cannot have foreign
keys to their elements (Postgres has no array FKs); if integrity matters,
use a join table.

### Ranges and multiranges

`int4range`, `int8range`, `numrange`, `tstzrange`, `daterange`, and the
multirange variants. The killer feature is exclusion constraints:

```sql
create extension if not exists btree_gist;
create table bookings (
  id       bigint generated always as identity primary key,
  room_id  bigint not null references rooms(id),
  during   tstzrange not null,
  exclude using gist (room_id with =, during with &&)   -- no overlapping bookings per room
);
```

Bounds: `[)` by default (inclusive start, exclusive end), which is what
you want for time.

### Enums

`create type order_status as enum ('draft','placed','paid');` Values are
4 bytes, sorted by declaration order, and `alter type ... add value` cannot
run inside a transaction block before PG 12 and still cannot *remove* or
*reorder* values. Renaming is possible. Prefer `text + check` for sets that
will change; use native enums for fixed vocabularies where sort order
matters (`'low' < 'medium' < 'high'`).

### Other types worth using

- `uuid` (16 bytes, do not store UUIDs as text: 37 bytes and slow compares).
- `inet`/`cidr` for IPs with containment operators.
- `numeric` for exact decimals; `bigint` for counts and cents.
- `bytea` for small binaries; large files belong in object storage with a
  URL column.
- `tsvector` for full-text (see `search-timeseries-vector.md`).
- `interval`, `date`, `timestamptz` (see `data-modeling.md` for the time
  rules).
- Domains: `create domain email as citext check (value ~ '^[^@]+@[^@]+$');`
  reuse a type-plus-check across tables.

## 2. Indexes

See `indexing.md` for the engine-neutral mental model. Postgres specifics:

| Type | Use for | Notes |
|---|---|---|
| B-tree (default) | `=`, `<`, `>`, `BETWEEN`, `IN`, `IS NULL`, `ORDER BY`, prefix `LIKE 'abc%'` (with `text_pattern_ops` or C collation) | Composite, covering (`INCLUDE`), partial, expression all supported; the workhorse |
| Hash | `=` only | Rarely worth it over B-tree; WAL-logged since PG 10 so at least safe now |
| GIN | Containment on jsonb, arrays, `tsvector`, trigram (`pg_trgm`) | Slower to update (use `fastupdate`, pending list); great for multi-valued columns |
| GiST | Geometric, ranges, exclusion constraints, nearest-neighbor, `ltree`, trigram | Lossy; supports `<->` distance ordering |
| SP-GiST | Non-balanced structures: IP ranges, text prefix tries, points | Niche |
| BRIN | Huge append-only tables where physical order correlates with the column (`created_at` on an event log) | Tiny (KBs for TBs), only good when correlation is high; `pages_per_range` tunable |
| Bloom (extension) | Equality on many columns in arbitrary combinations | Niche; lossy |

Syntax that matters:

```sql
create index concurrently if not exists orders_customer_created_idx
  on orders (customer_id, created_at desc);

create index concurrently orders_open_idx
  on orders (customer_id) where status in ('draft','placed');          -- partial

create index concurrently users_lower_email_key
  on users (lower(email));                                              -- expression; must be unique? use create unique index

create index concurrently orders_customer_cover_idx
  on orders (customer_id) include (status, total_cents);               -- covering for index-only scans

create index concurrently events_created_brin on events using brin (created_at);
```

`CONCURRENTLY` cannot run inside a transaction; migration tools need to be
told (Rails `disable_ddl_transaction!`, Alembic `autocommit_block`, Prisma
needs a hand-edited migration with `-- CREATE INDEX CONCURRENTLY` and no
surrounding transaction, Flyway needs a non-transactional migration via
`flyway.executeInTransaction=false` on that script). If a concurrent build
fails it leaves an `INVALID` index; drop it and retry:

```sql
select indexrelid::regclass from pg_index where not indisvalid;
```

### Index-only scans and the visibility map

An index-only scan still has to check the heap for pages not marked
all-visible. After a bulk load or heavy updates, run `vacuum (analyze)
table` so the visibility map is set; otherwise your covering index will
show `Heap Fetches: 198233` in EXPLAIN and gain nothing.

## 3. Row-level security

RLS makes the database enforce the tenant predicate on every statement,
regardless of what the application forgot.

```sql
alter table projects enable row level security;
alter table projects force row level security;   -- applies to the table owner too

create policy tenant_isolation on projects
  using (tenant_id = current_setting('app.tenant_id', true)::bigint)         -- rows visible / updatable / deletable
  with check (tenant_id = current_setting('app.tenant_id', true)::bigint);   -- rows insertable / updated-to

-- in the app, at the start of every transaction:
begin;
set local app.tenant_id = '42';
select * from projects;        -- only tenant 42's rows
commit;
```

Rules of engagement:

- Use `set local` inside a transaction so the setting dies with it; this
  is what makes it safe behind PgBouncer in transaction mode. Plain `set`
  leaks to the next tenant that gets the connection.
- The application role must not be the table owner (owners bypass RLS
  unless `force`) and must not have `BYPASSRLS`. Create a dedicated
  `app_user` role; run migrations as a different role.
- `current_setting('x', true)` returns null instead of erroring when
  unset, so an unset tenant sees nothing rather than everything. Good.
- Policies are combined with `OR` across permissive policies; use
  `as restrictive` for policies that must all pass.
- Performance: the predicate is pushed into the plan like any `WHERE`.
  Make sure `tenant_id` leads your indexes. Policies that call functions
  on other tables (`exists (select 1 from memberships ...)`) run per row;
  mark helper functions `stable` and keep them cheap, or cache the result
  in a setting at transaction start.
- Supabase: `auth.uid()` and `auth.jwt()` in policies; the `service_role`
  key bypasses RLS entirely, so never ship it to a client. Test policies
  with `set role authenticated; set request.jwt.claims = '{...}'`.

RLS also works for per-user visibility, read-only roles, and
`SECURITY INVOKER` views. It does not replace application authorization
for actions ("may this user approve this invoice"); it is a data-visibility
backstop.

## 4. Partitioning

Declarative partitioning (PG 10+, good from 12+) splits a table by range,
list or hash. Use it when a table is large (tens of GB+) *and* one of:
you drop old data by time, most queries filter on the partition key, or
vacuum on the monolithic table cannot keep up.

```sql
create table events (
  id         bigint generated always as identity,
  tenant_id  bigint not null,
  created_at timestamptz not null,
  payload    jsonb not null,
  primary key (id, created_at)                  -- partition key must be in every unique constraint
) partition by range (created_at);

create table events_2026_03 partition of events
  for values from ('2026-03-01') to ('2026-04-01');
create table events_2026_04 partition of events
  for values from ('2026-04-01') to ('2026-05-01');
create table events_default partition of events default;   -- catches stragglers; monitor it

create index on events (tenant_id, created_at desc);        -- propagates to all partitions
```

What you get: `drop table events_2025_01` instead of a multi-hour delete,
per-partition vacuum, partition pruning in plans (`Partitions removed: 11`
in EXPLAIN when the query filters on `created_at`). What you pay: every
unique constraint and PK must include the partition key (so "unique
`external_id` across all time" needs a separate non-partitioned lookup
table), FKs *to* a partitioned table are supported from PG 12 but FKs from
partitions have quirks, and someone must create future partitions
(`pg_partman`, a cron job, or create a year ahead). Do not partition tables
under a few GB; it only adds planning overhead.

Hash partitioning by `tenant_id` or `id` helps only when the goal is to
parallelize vacuum/maintenance on an enormous table; it does not make
queries faster by itself.

## 5. Extensions

Check availability with `select * from pg_available_extensions;`. Managed
hosts allowlist a set.

| Extension | What | Notes |
|---|---|---|
| `pg_stat_statements` | Aggregate statistics per normalized query: calls, total/mean time, rows, buffers | Enable it on day one (`shared_preload_libraries`); the workflow is in `query-performance.md` |
| `pg_trgm` | Trigram similarity and `LIKE '%abc%'` / `ILIKE` indexing with GIN/GiST | `create index on users using gin (name gin_trgm_ops)` makes substring search indexable |
| `pgcrypto` | `gen_random_uuid()` (core since 13), `crypt()`, `pgp_sym_encrypt` | Column encryption when you must; key management is the hard part |
| `citext` | Case-insensitive text type | Simpler than `lower()` indexes everywhere; slightly slower compares |
| `btree_gist` / `btree_gin` | Use `=` on scalars inside GiST/GIN indexes | Required for exclusion constraints mixing `=` and `&&` |
| `pgvector` | `vector(n)` type, HNSW and IVFFlat indexes, distance operators | See `search-timeseries-vector.md` |
| `postgis` | Geospatial | Its own world; `geography` vs `geometry` is the first decision |
| `pg_partman` | Automated partition creation and retention | Pairs with a `run_maintenance()` cron |
| `timescaledb` | Hypertables, compression, continuous aggregates | See `search-timeseries-vector.md` |
| `ltree` | Hierarchical labels with GiST | See `data-modeling.md` hierarchies |
| `hstore` | Key-value text pairs | Mostly superseded by jsonb |
| `uuid-ossp` | `uuid_generate_v4()` | Use core `gen_random_uuid()` instead on 13+ |
| `pg_cron` | Cron inside the database | For `REFRESH MATERIALIZED VIEW`, partition maintenance, purges |
| `auto_explain` | Log plans of slow statements automatically | `auto_explain.log_min_duration = '500ms'`, `log_analyze = on` carefully |
| `pg_repack` | Rebuild bloated tables/indexes without a long lock | The answer to "VACUUM FULL would lock for an hour" |

## 6. Configuration basics

The defaults are tuned for a 2005 laptop. On any real server, the handful
that matter (set in `postgresql.conf`, or the managed host's parameter
group):

| Setting | Guidance | Why |
|---|---|---|
| `shared_buffers` | 25% of RAM (less on very large machines) | Postgres's own cache; the OS cache does the rest |
| `effective_cache_size` | 50-75% of RAM | Planner hint for how much is likely cached; too low makes it fear index scans |
| `work_mem` | 16-64 MB typical; per sort/hash *per node per query*, so multiply by concurrency | Too low: sorts and hashes spill to disk (`Sort Method: external merge`); too high: OOM under load. Raise per session for reporting queries |
| `maintenance_work_mem` | 512 MB-2 GB | Speeds `CREATE INDEX`, `VACUUM` |
| `max_connections` | As low as you can: 100-300 with a pooler in front | Each backend is a process; thousands of connections thrash. See `scaling-and-operations.md` |
| `random_page_cost` | 1.1 on SSD (default 4.0 assumes spinning disk) | Default makes the planner avoid index scans it should take |
| `checkpoint_completion_target` | 0.9 | Smooths checkpoint I/O |
| `wal_compression` | on | Cheaper WAL, especially with full-page writes |
| `statement_timeout` | Set per role or per app: 30s for web, longer for jobs | Kills runaway queries before they take the site down |
| `idle_in_transaction_session_timeout` | 30s-5min | Kills sessions holding locks while the app does nothing |
| `log_min_duration_statement` | 500ms-1s | Slow query log |
| `log_lock_waits` | on (`deadlock_timeout` 1s) | Logs when a statement waits more than `deadlock_timeout` for a lock |
| `track_io_timing` | on | Makes `EXPLAIN (ANALYZE, BUFFERS)` show I/O time |

`pgtune` and the host's defaults are reasonable starting points. Set
timeouts per role so migrations are not killed by the web timeout:
`alter role app_user set statement_timeout = '30s'`.

## 7. Vacuum, autovacuum, bloat

Postgres MVCC never updates in place: an `UPDATE` writes a new row version
and leaves the old one as dead until vacuum reclaims it. Consequences:

- Tables with heavy updates/deletes bloat if autovacuum cannot keep up
  (long transactions also prevent cleanup: "the oldest transaction is
  pinning dead tuples").
- `vacuum` reclaims space for reuse (does not shrink the file);
  `vacuum full` rewrites the table with an exclusive lock (use `pg_repack`
  instead in production).
- `analyze` refreshes statistics; autovacuum does both, but after a bulk
  load run `analyze` yourself or the first queries get terrible plans.
- Transaction ID wraparound: if autovacuum is disabled or starved long
  enough, Postgres forces a shutdown to protect itself. Never disable
  autovacuum globally.

Tune per table for hot tables (the global 20% threshold means a 100M-row
table vacuums after 20M dead rows):

```sql
alter table events set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.005,
  autovacuum_vacuum_cost_limit = 2000
);
```

Check bloat and vacuum health:

```sql
select relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as dead_pct,
       last_autovacuum, last_autoanalyze
from pg_stat_user_tables order by n_dead_tup desc limit 20;

select pid, now() - xact_start as age, state, left(query, 80)
from pg_stat_activity where xact_start < now() - interval '5 minutes' order by xact_start;
```

HOT updates (heap-only tuples) avoid index churn when the updated column
is not indexed and the page has room; `fillfactor = 90` on hot update
tables helps. This is one more reason not to index every column.

## 8. Reading EXPLAIN, annotated

Always `explain (analyze, buffers, format text)` for humans or `format
json` for `scripts/explain_summary.py`. `analyze` runs the query; wrap
mutating statements in `begin; ... rollback;`.

### Anatomy of a node

```
->  Index Scan using orders_customer_created_idx on orders  (cost=0.43..8.45 rows=1 width=72) (actual time=0.031..0.034 rows=3 loops=1)
      Index Cond: (customer_id = 42)
      Filter: (status = 'paid')
      Rows Removed by Filter: 5
      Buffers: shared hit=4
```

- `cost=startup..total` in arbitrary units; compare within a plan only.
- `rows=1` is the planner's estimate; `actual rows=3` is reality. The
  ratio matters: off by 10x or more means bad statistics or a correlation
  the planner cannot see.
- `loops=N`: the node ran N times (inside a nested loop). Actual rows and
  time are *per loop*; multiply.
- `Index Cond` is what the index answered; `Filter` is what was checked
  afterwards per row; `Rows Removed by Filter` is wasted work the index
  could have done if it included that column.
- `Buffers: shared hit` = found in cache, `read` = from disk; with
  `track_io_timing`, `I/O Timings` shows the cost.

### Example 1: missing index

```
Seq Scan on orders  (cost=0.00..45820.00 rows=1203 width=72) (actual time=0.9..412.5 rows=1180 loops=1)
  Filter: (customer_id = 42)
  Rows Removed by Filter: 1998820
  Buffers: shared hit=1200 read=18620
```

Two million rows read to find 1180. Fix: `create index concurrently on
orders (customer_id)` (or the composite that also serves the sort).

### Example 2: estimate wildly off, wrong join strategy

```
Nested Loop  (cost=... rows=12 ...) (actual time=... rows=48211 loops=1)
  ->  Index Scan on customers ... (rows=12 ...) (actual rows=12)
        Index Cond: (region = 'EU')
  ->  Index Scan on orders ... (rows=1 ...) (actual time=0.02..3.1 rows=4018 loops=12)
        Index Cond: (customer_id = customers.id)
```

The planner expected 1 order per customer and chose a nested loop; there
were 4018 each. Nested loops with large inner sides are slow; a hash join
would have been right. Causes: stale statistics (`analyze orders`),
correlated columns (`create statistics ... (dependencies)`), or a default
selectivity for a condition the planner cannot estimate (functions,
`jsonb` extractions). Fix the stats first; raise `default_statistics_target`
or `alter table ... alter column ... set statistics 1000` for skewed
columns.

### Example 3: sort spilling to disk

```
Sort  (cost=...) (actual time=2210..2400 rows=1500000 loops=1)
  Sort Key: created_at DESC
  Sort Method: external merge  Disk: 184320kB
```

The sort did not fit in `work_mem`. Fixes in order: avoid the sort with an
index matching the `ORDER BY` (plus the `WHERE` columns before it), add
`LIMIT` so a top-N heapsort applies, raise `work_mem` for this session
only (`set local work_mem = '256MB'`).

### Example 4: lossy bitmap heap scan

```
Bitmap Heap Scan on events  (actual rows=210000 ...)
  Recheck Cond: (payload @> '{"type": "x"}')
  Rows Removed by Index Recheck: 3100000
  Heap Blocks: exact=1200 lossy=48000
```

`lossy` blocks mean `work_mem` was too small to hold the bitmap at tuple
granularity, so it fell back to page granularity and rechecked millions of
rows. Raise `work_mem`, or make the condition more selective, or add a
partial index.

### Example 5: index used but still slow

```
Index Scan using events_created_idx on events (actual time=0.05..9800 rows=5000000 loops=1)
  Index Cond: (created_at > '2026-01-01')
  Buffers: shared hit=120000 read=3800000
```

Index scan reading 5M rows via random heap access is slower than a seq
scan would be. The planner chose it because `random_page_cost` is at the
spinning-disk default or the estimate was low. A BRIN index or a seq scan
(the planner would choose it with correct costs) or partitioning by month
is the fix, depending on the query.

### Example 6: good plan, so you know what it looks like

```
Limit  (actual time=0.04..0.12 rows=20 loops=1)
  ->  Index Scan using orders_customer_created_idx on orders (actual time=0.03..0.10 rows=20 loops=1)
        Index Cond: ((customer_id = 42) AND (created_at < '2026-03-01 ...'))
        Buffers: shared hit=6
```

Keyset pagination hitting a composite index: 6 buffer hits, 20 rows, done.

### Reading order

1. Find the node with the largest *exclusive* actual time (its time minus
   its children's). `explain_summary.py` does this.
2. Compare `rows` estimate vs actual at that node and its inputs.
3. Look at `Buffers` for I/O: `read` dominating means cache miss or a scan
   too large.
4. Check `Sort Method`, `Heap Blocks lossy`, `Rows Removed by Filter`,
   `Heap Fetches`, `loops`.
5. Fix one thing, re-run, compare.

Tools: `explain.dalibo.com` and `explain.depesz.com` render plans visually
(paste anonymized plans only).

## 9. Postgres-specific gotchas

- `count(*)` on a large table is a full scan (MVCC has no row counter).
  Use `reltuples` from `pg_class` for an estimate, or a counter table, or
  accept it.
- `NULL` in unique constraints: `unique (a, b)` allows many rows with
  `b IS NULL`. PG 15: `unique nulls not distinct`.
- Identifiers fold to lowercase unless quoted; `"createdAt"` then needs
  quotes forever. Prisma and some ORMs quote camelCase; be consistent.
- `now()` is transaction start; a long transaction inserting many rows
  gives them all the same timestamp.
- Sequences are not transactional: rolled-back inserts leave gaps. Do not
  build invoice numbering on a sequence; use a counter row with `select ...
  for update`.
- `ALTER TABLE ... ADD COLUMN ... DEFAULT <volatile>` (e.g. `now()`,
  `gen_random_uuid()`) rewrites the table; a constant default is instant
  since PG 11.
- `text` comparison uses the database collation; `LIKE 'abc%'` only uses a
  B-tree index with `text_pattern_ops` or `C` collation.
- Casting in `WHERE` (`where id::text = $1`) disables the index; cast the
  parameter instead.
- `IN (huge list)` is fine to a few thousand; past that, `= any($1)` with
  an array parameter or a `VALUES` join.
- Prepared statements behind PgBouncer transaction mode: see
  `scaling-and-operations.md`.
- Default isolation is Read Committed; `serializable` is real (SSI) and
  requires retrying on `40001`. See `transactions-and-concurrency.md`.
