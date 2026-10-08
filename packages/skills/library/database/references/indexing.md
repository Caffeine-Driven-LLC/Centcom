# Indexing

The mental model behind every index decision, the composite column ordering
rule, covering, partial and expression indexes, selectivity, index-only
scans, write amplification, when to drop indexes, and the queries that find
missing and unused ones. Engine-neutral where possible; Postgres syntax by
default with MySQL and SQLite notes. Postgres-only index types (GIN, GiST,
BRIN) are detailed in `postgres.md`.

## Contents

1. The mental model
2. What an index can and cannot do for a query
3. Composite indexes and the column ordering rule
4. Covering indexes and index-only scans
5. Partial indexes
6. Expression indexes
7. Selectivity and when the planner ignores your index
8. Write amplification and the cost side
9. Unique indexes as constraints
10. Finding missing and unused indexes
11. Index maintenance
12. Worked examples

## 1. The mental model

A B-tree index is a sorted copy of some columns, with a pointer to the row
for each entry. Everything else follows from "sorted copy":

- Finding one value is a binary search: `O(log n)` page reads, typically
  3-4 for millions of rows.
- Finding a range (`between`, `<`, prefix `like 'abc%'`) is one descent
  then a sequential walk along the leaves.
- Reading in index order gives you sorted output for free, so an index
  matching `ORDER BY` eliminates a sort.
- Multi-column indexes are sorted by the first column, then by the second
  within equal first values, and so on, like a phone book sorted by last
  name then first name. You can use it to find all "Smith"s, or all "Smith,
  J..."s, but not all "John"s regardless of last name.
- Every row modification must update every index that contains a changed
  column (and in Postgres, every index unless the update is HOT).
- An index helps only when it lets the database touch far fewer pages than
  scanning the table. Pulling 30% of a table through an index is slower
  than reading the table sequentially.

## 2. What an index can and cannot do for a query

Given `where a = 1 and b > 5 order by c limit 20` on index `(a, b, c)`:

- `a = 1` narrows to one range of the index. Good.
- `b > 5` within that range is a sub-range. Good, still a single scan.
- But `order by c` *cannot* use the index now, because within `a = 1`
  entries are sorted by `b`, not `c`. Rows come out in `b` order and must
  be sorted. If the query were `order by b`, no sort.

Operations that use a B-tree: `=`, `<`, `<=`, `>`, `>=`, `between`, `in
(list)`, `is null`, `is not null`, prefix `like 'abc%'` (Postgres: needs
`text_pattern_ops` or `C` collation unless the DB collation is `C`),
`order by` on a leading prefix in the same direction (or fully reversed).

Operations that do not: `like '%abc'`, `like '%abc%'` (use `pg_trgm` GIN
or FTS), `lower(col) = ...` or any function on the column (use an
expression index), `col + 1 = 5`, `col::text = ...` (cast on the column),
`<>`, `not in`, `or` across different columns (sometimes a bitmap OR of
two indexes; often not), comparisons where the parameter type forces a
cast on the column (MySQL `varchar_col = 123`).

## 3. Composite indexes and the column ordering rule

The rule, in order of priority:

1. **Equality columns first**, in any order among themselves (put the most
   selective first if you also run queries on just that column, so the
   index serves them too).
2. **Then the range or sort column.** One. After a range condition, later
   columns cannot be used for seeking, only for filtering within the
   index. If the query has both a range filter and a sort on different
   columns, you choose which to serve (usually the sort when `LIMIT` is
   small, because stopping early beats a narrower scan plus a full sort).
3. **Then columns you only need for covering** (or put them in `INCLUDE`).

Examples:

| Query | Index |
|---|---|
| `where tenant_id = ? and status = ? order by created_at desc limit 20` | `(tenant_id, status, created_at desc)` |
| `where tenant_id = ? and created_at > ? order by created_at desc` | `(tenant_id, created_at desc)` (range and sort on the same column: ideal) |
| `where user_id = ? and read = false order by created_at desc` | `(user_id, created_at desc) where read = false` (partial beats a column for a boolean) |
| `where email = ?` and also `where email = ? and tenant_id = ?` | `(email, tenant_id)` serves both; `(tenant_id, email)` serves only the second |
| `where a in (1,2,3) and b = ?` | `(b, a)`: the `in` is a small set of ranges; equality first |
| `where lower(email) = ?` | expression index on `(lower(email))` |
| `where created_at >= ? and created_at < ? and status = ?` | `(status, created_at)`, not `(created_at, status)` |

A rule of thumb for "which single column goes first" when all are
equality: the one that appears alone in other queries. Selectivity is a
weaker tie-breaker than people think, because the composite as a whole
decides the range size.

Redundancy: `(a)` is redundant when `(a, b)` exists (the leading prefix
serves the same seeks, at a slightly larger index). `(b)` is not redundant
with `(a, b)`. Drop the prefix duplicates.

Direction: `(a, b desc)` matters when the sort mixes directions
(`order by a asc, b desc`). Postgres and MySQL 8 support per-column
direction; a single-direction index can be read backwards for a fully
reversed order.

## 4. Covering indexes and index-only scans

If every column the query needs (select list, where, order by) is in the
index, the database never visits the table: an index-only scan. On InnoDB
this avoids the second B-tree descent to the clustered PK; on Postgres it
avoids heap fetches, provided the visibility map says the page is
all-visible (so vacuum matters).

```sql
-- Postgres: non-key columns via INCLUDE (not sorted, not usable for seeks, smaller than adding to the key)
create index concurrently orders_customer_cover_idx
  on orders (customer_id, created_at desc) include (status, total_cents);

-- MySQL / SQLite: just add the columns to the key
CREATE INDEX orders_customer_cover_idx ON orders (customer_id, created_at, status, total_cents);
```

Use covering for the hot list query on a wide table, where selecting the
three columns the list needs from a 40-column row is most of the cost.
Do not try to cover everything; the index becomes a second copy of the
table, and every update touches it.

The query must select named columns for this to work. `SELECT *` can
never be an index-only scan.

## 5. Partial indexes

An index over a subset of rows (`where` clause in the index definition).
Postgres and SQLite support them; MySQL does not. The closest MySQL
emulation is a generated column that holds the key for included rows and
`NULL` for excluded ones, then an index on that column; InnoDB still stores
the NULL entries, so the index is not smaller, but the planner can seek
the non-NULL range cheaply.

Use when a predicate is highly skewed and queries always include it:

```sql
-- 2% of orders are open; the dashboard only shows open ones
create index concurrently orders_open_idx
  on orders (customer_id, created_at desc)
  where status in ('draft','placed');

-- soft delete: index only live rows, and make uniqueness apply only to live rows
create unique index concurrently users_email_live_key
  on users (lower(email)) where deleted_at is null;

-- a queue: only unprocessed jobs, tiny index on a huge table
create index concurrently jobs_pending_idx
  on jobs (run_at) where state = 'pending';
```

The planner uses a partial index only when it can prove the query's
`where` implies the index's `where`. `where status = 'draft'` implies
`status in ('draft','placed')`; `where status = $1` with a parameter does
not (unless the driver inlines it), so parameterized queries over partial
indexes need the exact same predicate text or a generic plan that still
matches.

## 6. Expression indexes

Index the result of an expression so that a query using the same
expression can seek:

```sql
create index concurrently users_lower_email_idx on users ((lower(email)));
create index concurrently events_type_idx on events ((payload->>'type'));
create index concurrently orders_created_date_idx on orders ((created_at::date));  -- careful: timezone of the cast
create index concurrently docs_title_trgm_idx on docs using gin (title gin_trgm_ops);
```

The expression in the query must match the index expression exactly
(after normalization). `where lower(email) = lower($1)` uses the index;
`where email ilike $1` does not. The function must be `IMMUTABLE`
(Postgres) or deterministic (MySQL functional indexes, 8.0.13+; SQLite
supports expression indexes with deterministic functions).

A generated column plus a plain index is often clearer than an expression
index, and it also gives you the value in `SELECT` without recomputing.

## 7. Selectivity and when the planner ignores your index

Selectivity is the fraction of rows a condition keeps. A B-tree pays off
roughly when the condition keeps less than 5-15% of the table (on SSDs
with correct `random_page_cost`, the threshold is higher than on
spinning disks). Above that, the planner correctly chooses a sequential
scan, and the index is wasted write cost for that query.

So: an index on `status` where 95% of rows are `'active'` helps the query
for `'cancelled'` and not for `'active'`. A partial index for the rare
values is the right shape. An index on a boolean column is almost never
useful alone; as a partial index predicate it is excellent.

Reasons the planner does not use an index you expected:

- Statistics are stale (`analyze` the table). After bulk loads this is
  the usual cause.
- The estimate says the condition is not selective (check `rows=` in
  `EXPLAIN` vs actual; extend statistics on skewed columns:
  `alter table t alter column status set statistics 1000`).
- The query wraps the column in a function or cast.
- Type mismatch: `bigint` column compared to a `numeric` parameter, or
  `text` to `varchar` in MySQL with different collations.
- The table is tiny (a seq scan of 3 pages is correct).
- `random_page_cost` is at the spinning-disk default of 4.0 on an SSD
  host (set 1.1).
- `LIMIT` plus `ORDER BY` on a different index: the planner may walk the
  sort index hoping to find matches early, and crawl if the filter is
  rare. Give it the composite `(filter, sort)`.
- `OR` across columns; rewrite as `UNION ALL` of two indexable queries.
- A partial index whose predicate the planner cannot prove.

Force-test with `set enable_seqscan = off` in a session to see if the
index *could* be used and what it would cost; never ship that setting.

## 8. Write amplification and the cost side

Each index:

- Adds one B-tree insert per row insert (random I/O if the key is random,
  as with UUIDv4).
- Adds a delete+insert per update of an indexed column; in Postgres, any
  update that cannot be HOT (heap-only tuple) updates *all* indexes on the
  table, even for unchanged columns. More indexes means fewer HOT
  updates.
- Consumes disk (an index on a `bigint` column over 100M rows is ~2 GB;
  over a `text` column, more than the column's data) and shared buffer
  cache, pushing out table pages.
- Slows `VACUUM`, `pg_dump` and restore, `COPY`, and bulk loads
  (drop and recreate indexes around a massive load).
- On InnoDB, carries a copy of the primary key per entry, so wide PKs
  multiply the cost.

A table with twelve indexes on a write-heavy workload spends most of its
write I/O on indexes. The question is never "could this index help a
query" but "does this index earn its write cost". Six to eight indexes on
a hot table is a lot; three to five is typical for a well-designed one.

## 9. Unique indexes as constraints

A unique constraint is a unique index. Prefer `create unique index
concurrently` then `alter table ... add constraint ... using index` in
Postgres when adding to a large live table; `alter table add constraint
unique` takes a long lock.

Nulls: by default, `unique (a, b)` allows unlimited rows with `b is
null`. Postgres 15 `unique nulls not distinct` changes that; MySQL and
SQLite keep the "nulls are distinct" behavior. Use `coalesce` in an
expression index or make the column `NOT NULL` with a sentinel when
needed.

Unique indexes are how you implement "ensure only one" rules
concurrently; application-level check-then-insert does not work under
concurrency (see `transactions-and-concurrency.md`).

## 10. Finding missing and unused indexes

### Postgres: unused indexes

```sql
select s.schemaname, s.relname as table, s.indexrelname as index,
       pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
       s.idx_scan as scans
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
where s.idx_scan = 0
  and not i.indisunique          -- unique indexes are constraints; keep them
  and not i.indisprimary
order by pg_relation_size(s.indexrelid) desc;
```

Counters reset on `pg_stat_reset()` and on some upgrades; check
`stats_reset` in `pg_stat_database` and make sure the window covers a
full business cycle (month-end reports). An index used once a month for
a critical report is not unused.

### Postgres: tables with many sequential scans

```sql
select relname, seq_scan, seq_tup_read, idx_scan,
       n_live_tup,
       round(seq_tup_read::numeric / nullif(seq_scan, 0)) as avg_rows_per_seq_scan
from pg_stat_user_tables
where seq_scan > 0 and n_live_tup > 10000
order by seq_tup_read desc limit 20;
```

Large tables with many seq scans averaging most of the table are
candidates for a missing index; find the query in `pg_stat_statements`
(see `query-performance.md`).

### Postgres: duplicate and redundant indexes

```sql
select a.indexrelid::regclass as idx_a, b.indexrelid::regclass as idx_b
from pg_index a join pg_index b
  on a.indrelid = b.indrelid and a.indexrelid < b.indexrelid
where a.indkey::text = b.indkey::text               -- identical columns
   or (array_to_string(a.indkey, ' ') like array_to_string(b.indkey, ' ') || ' %'); -- b is a prefix of a
```

### Postgres: foreign keys without an index

```sql
select c.conrelid::regclass as table, c.conname, a.attname
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
where c.contype = 'f'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
  );
```

### Postgres: index bloat and invalid indexes

```sql
select indexrelid::regclass, indisvalid from pg_index where not indisvalid;  -- failed CONCURRENTLY builds
-- bloat estimate: use pgstattuple extension or the community bloat query; reindex concurrently when > 30-40%
reindex index concurrently orders_customer_created_idx;   -- PG 12+
```

### MySQL

```sql
select * from sys.schema_unused_indexes;
select * from sys.schema_redundant_indexes;
select object_schema, object_name, index_name, count_read, count_write
from performance_schema.table_io_waits_summary_by_index_usage
where index_name is not null order by count_read;
-- missing: performance_schema.events_statements_summary_by_digest where SUM_NO_INDEX_USED > 0
```

### SQLite

No usage stats; `EXPLAIN QUERY PLAN` each query and look for `SCAN`.
`sqlite3_analyzer` reports size per index.

## 11. Index maintenance

- Build with `CONCURRENTLY` (Postgres) or `ALGORITHM=INPLACE, LOCK=NONE`
  (MySQL) on live tables; see `migrations.md`.
- `REINDEX CONCURRENTLY` (PG 12+) to fix bloat after heavy churn;
  `OPTIMIZE TABLE` on InnoDB rebuilds the whole table (online for most
  cases).
- Statistics: `ANALYZE` after bulk changes; autovacuum handles the rest.
  Extended statistics for correlated columns:
  `create statistics orders_tenant_status (dependencies) on tenant_id, status from orders;`
- Keep `maintenance_work_mem` high during index builds (`set
  maintenance_work_mem = '2GB'` in the migration session).
- Name indexes so their purpose is readable
  (`orders_customer_created_idx`), and comment the unusual ones.

## 12. Worked examples

### The list page

Query: `select id, status, total_cents, created_at from orders where
tenant_id = $1 and status = any($2) order by created_at desc limit 25`.
Volume: 80M orders, 20k tenants.

Index: `(tenant_id, created_at desc) include (status, total_cents)`. Why
not `(tenant_id, status, created_at desc)`? Because `status = any($2)`
with several values breaks the sort (multiple ranges merged), and a tenant
has at most a few thousand orders so filtering status within the
tenant's time-ordered range is cheap. If a tenant can have millions of
orders and the status filter is selective, the second index wins; check
with `EXPLAIN` on realistic data.

### The uniqueness rule

"A user can have only one default payment method." Index: `create unique
index on payment_methods (user_id) where is_default;`. No application
check can guarantee this under concurrency; this can.

### The search box

`where name ilike '%' || $1 || '%'` on 5M products. B-tree cannot help.
`create index on products using gin (name gin_trgm_ops)` makes it an
index scan; or a `tsvector` for word search (see
`search-timeseries-vector.md`).

### The timestamp range on an event log

`where created_at between $1 and $2` on a 2B-row append-only table. A
B-tree is 40 GB. `create index on events using brin (created_at)` is a few
MB and nearly as fast because insertion order correlates with time.
Partitioning by month would do the same and also make deletes free.

### The "we added an index and it got slower" case

Write-heavy table, index added on a column updated constantly. Updates
stopped being HOT, every index on the table now churns, autovacuum falls
behind, bloat grows. Fix: drop the index if the read it served was
marginal, or move the hot column out of the table, or lower `fillfactor`
and tune autovacuum for that table.
