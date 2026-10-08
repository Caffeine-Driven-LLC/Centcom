# MySQL and MariaDB

What is different when the engine is MySQL (8.x) or MariaDB (10.x/11.x):
InnoDB's clustered primary key and what it implies for key choice and
secondary indexes, the Repeatable Read default and gap locks, online DDL and
its instant/inplace/copy tiers, character sets, replication, and the long
list of behaviors that trip people arriving from Postgres. Includes
PlanetScale/Vitess notes.

## Contents

1. InnoDB storage model and the clustered primary key
2. Isolation, locking, and the default that surprises
3. Online DDL: instant, inplace, copy
4. Character sets, collations, utf8mb4
5. Types and functions that differ
6. Indexes on MySQL
7. Query behavior and EXPLAIN
8. Configuration basics
9. Replication, PlanetScale, Vitess
10. Gotchas vs Postgres, collected

## 1. InnoDB storage model and the clustered primary key

In InnoDB the table *is* the primary key B-tree: rows are stored in PK
order in the leaf pages. Every secondary index stores the PK value as its
row pointer. This has direct design consequences:

- **Random PKs (UUIDv4) scatter inserts** across the whole table, not just
  across an index: page splits, half-empty pages, poor cache locality, and
  slower everything. If you need UUIDs, use UUIDv7 or ULID stored as
  `BINARY(16)` (`UUID_TO_BIN(uuid, 1)` swaps the time bits of a v1 UUID to
  the front; for v7 just `UNHEX(REPLACE(uuid,'-',''))`). An
  `AUTO_INCREMENT BIGINT UNSIGNED` is the fastest-inserting PK.
- **Wide PKs make every secondary index wide.** A `(tenant_id, uuid)`
  composite PK means each secondary index entry carries 24 bytes of PK.
  Keep PKs narrow; put the multi-column uniqueness in a `UNIQUE KEY`.
- **A table with no PK gets a hidden 6-byte row ID** and performs worse
  for replication (row-based replication must scan to find rows). Always
  declare a PK; MySQL 8.0.30+ can enforce this with `sql_require_primary_key`.
- **PK lookups are the fastest possible access**; secondary index lookups
  cost two B-tree descents (secondary, then PK) unless the index covers
  the query. Covering indexes matter more on InnoDB than on Postgres.
- **Range scans on the PK are physically sequential**: "orders by
  customer, newest first" benefits from a PK of `(customer_id, id)` if the
  table is dominated by that query, at the cost of a wider PK everywhere.
  Usually a secondary index is the right call; mention the option.

```sql
CREATE TABLE orders (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  status      VARCHAR(20) NOT NULL,
  total_cents BIGINT NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY orders_customer_created_idx (customer_id, created_at),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT orders_status_chk CHECK (status IN ('draft','placed','paid','shipped','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

`CHECK` constraints are enforced from MySQL 8.0.16 (before that they were
parsed and ignored) and MariaDB 10.2.1. Verify the version before relying
on them.

## 2. Isolation, locking, and the default that surprises

The default isolation level is **Repeatable Read** (Postgres: Read
Committed). Under InnoDB's Repeatable Read:

- Plain `SELECT`s read from a consistent snapshot taken at the first read
  of the transaction. Good for reports; surprising when a long
  transaction never sees committed changes.
- Locking reads (`SELECT ... FOR UPDATE`, `UPDATE`, `DELETE`) take **gap
  locks** and **next-key locks** on the index ranges they scan, to prevent
  phantom inserts. This is the source of most "why did this deadlock"
  reports on MySQL: two transactions inserting adjacent values can lock
  each other's gaps.
- `UPDATE ... WHERE` on a column with no index locks *every row scanned*
  (effectively the table) until commit. Always index the columns you
  update or delete by.
- Switching to `READ COMMITTED` (`transaction_isolation =
  'READ-COMMITTED'`) removes gap locking for most statements and behaves
  closer to Postgres. Many high-concurrency deployments do this. It
  requires row-based binlog (`binlog_format = ROW`, the default on 8.x).

Deadlock diagnosis: `SHOW ENGINE INNODB STATUS\G` shows the last deadlock
with both transactions' locks; enable `innodb_print_all_deadlocks = ON` to
log all of them. InnoDB detects deadlocks immediately and rolls back the
smaller transaction with error 1213; the application must retry.

Lock wait: `innodb_lock_wait_timeout` (default 50s) is how long a
statement waits for a row lock before error 1205. Lower it for web
workloads (5-10s).

`SELECT ... FOR UPDATE SKIP LOCKED` and `NOWAIT` exist from MySQL 8.0;
queue patterns from `transactions-and-concurrency.md` apply.

Metadata locks: any open transaction that has *read* a table holds a
shared metadata lock on it, and an `ALTER TABLE` must wait for it, and
while it waits every new query on that table queues behind the `ALTER`.
Kill idle transactions before DDL; set `lock_wait_timeout` low for the
migration session so a stuck DDL gives up instead of blocking the site.

## 3. Online DDL: instant, inplace, copy

MySQL 8.0 classifies each `ALTER TABLE` as one of:

| Algorithm | Behavior | Examples |
|---|---|---|
| `INSTANT` (8.0.12+) | Metadata-only; no rebuild, no lock beyond a brief MDL | Add column (at end, or anywhere from 8.0.29), drop column (8.0.29+), set/drop default, rename column (8.0.28+), rename table |
| `INPLACE` | Rebuilds in the background; concurrent DML allowed (`LOCK=NONE`) but it is I/O and the table may be rebuilt | Add/drop index, add FK (with `foreign_key_checks=0`), change `AUTO_INCREMENT`, add/drop virtual column, convert character set for some cases |
| `COPY` | Copies the whole table with a lock on writes (`LOCK=SHARED`) or everything | Change column type, change charset of indexed columns, add `FULLTEXT` on some cases, change PK in some cases |

Always state the algorithm and lock you expect, so MySQL errors instead
of silently doing a copy:

```sql
ALTER TABLE orders ADD COLUMN note TEXT, ALGORITHM=INSTANT;
ALTER TABLE orders ADD INDEX orders_status_idx (status), ALGORITHM=INPLACE, LOCK=NONE;
```

If it says `ALGORITHM=INSTANT is not supported`, you know before
production. For `COPY`-class changes on large tables use an online schema
change tool: `gh-ost` (GitHub, binlog-based, no triggers),
`pt-online-schema-change` (Percona, trigger-based), or the hosting
platform's deploy requests (PlanetScale). These create a shadow table,
copy rows in batches, stream changes, and atomically swap. The expand/
contract patterns in `migrations.md` still apply: the running app must
tolerate both schemas during the copy.

Adding a `FOREIGN KEY` with `foreign_key_checks=1` is `COPY`; with
`foreign_key_checks=0` it is `INPLACE` (and skips validating existing
rows, so validate yourself first).

MariaDB has its own instant/inplace matrix (`ALTER ONLINE TABLE`) and
10.3+ supports instant add column; check the MariaDB docs for the version.

## 4. Character sets, collations, utf8mb4

- `utf8` in MySQL means `utf8mb3`: three bytes, no emoji, no astral plane.
  Always `utf8mb4`. Set it at server (`character_set_server`), database,
  table and connection (`SET NAMES utf8mb4`, or the driver's `charset`
  option).
- Default collation on 8.0 is `utf8mb4_0900_ai_ci`: accent- and
  case-insensitive. So `'resume' = 'résumé' = 'RÉSUMÉ'` is true, and a
  `UNIQUE` on `email` already handles case. Use `utf8mb4_0900_as_cs` for
  case- and accent-sensitive comparison, or `utf8mb4_bin` for byte
  comparison. Decide per column when it matters (tokens, usernames).
- Index key length limit is 3072 bytes with `DYNAMIC` row format; a
  `VARCHAR(768)` utf8mb4 column is the ceiling for a plain B-tree key. A
  `VARCHAR(255)` index key costs 1020 bytes. Use prefix indexes
  (`KEY (url(100))`) or a hashed column for long strings.
- `TEXT`/`BLOB` cannot be indexed without a prefix length and are stored
  off-page past a threshold; sorting on them uses disk temp tables. Prefer
  `VARCHAR(n)` with a real `n` for anything indexed or sorted.
- Mixing collations in a `JOIN` or comparison errors with "Illegal mix of
  collations"; keep one collation per database unless you have a reason.

## 5. Types and functions that differ

| Need | Postgres | MySQL |
|---|---|---|
| Boolean | `boolean` | `TINYINT(1)` (`BOOL` is an alias); `TRUE`/`FALSE` are 1/0 |
| Auto id | `generated always as identity` | `AUTO_INCREMENT` (one per table, must be a key) |
| UUID | `uuid` (16 bytes) | `BINARY(16)` + `UUID_TO_BIN`/`BIN_TO_UUID`; `CHAR(36)` is 36 bytes and slow |
| Instant | `timestamptz` | `DATETIME(6)` stored as UTC by convention (`TIMESTAMP` converts via session tz and ends in 2038) |
| Text | `text` | `VARCHAR(n)`, `TEXT`, `MEDIUMTEXT`, `LONGTEXT` by size |
| JSON | `jsonb` with GIN | `JSON` (binary, validated); index via generated columns or multi-valued indexes (8.0.17+) |
| Arrays | native | none; use a child table or JSON |
| Enum | `create type` | inline `ENUM('a','b')`; adding values is `INSTANT` only if appended at the end, otherwise `COPY` |
| Ranges / exclusion constraints | native | none; emulate with application locking |
| Upsert | `insert ... on conflict (k) do update set x = excluded.x` | `INSERT ... ON DUPLICATE KEY UPDATE x = VALUES(x)` (8.0.20+: `... AS new ON DUPLICATE KEY UPDATE x = new.x`); fires on *any* unique key, not a chosen one |
| Returning | `returning *` | none until MariaDB 10.5 (`RETURNING`); MySQL uses `LAST_INSERT_ID()` |
| Window functions, CTEs | yes | yes from 8.0 (MariaDB 10.2) |
| Lateral join | `lateral` | `LATERAL` from 8.0.14 |
| Partial index | `where ...` | none; use a generated column that is NULL when excluded and index that |
| Transactional DDL | yes | no: each DDL statement commits implicitly; a failed migration leaves a half-applied state |
| Deferred constraints | yes | no |
| `DISTINCT ON` | yes | no; use window functions |
| String concat | `\|\|` | `CONCAT()` (`\|\|` is OR unless `PIPES_AS_CONCAT`) |
| Case sensitivity of names | folds to lowercase | table names follow the filesystem (`lower_case_table_names`); keep them lowercase |

JSON indexing via a generated column:

```sql
ALTER TABLE events
  ADD COLUMN event_type VARCHAR(50) GENERATED ALWAYS AS (payload->>'$.type') VIRTUAL,
  ADD INDEX events_type_idx (event_type), ALGORITHM=INPLACE, LOCK=NONE;
```

## 6. Indexes on MySQL

B-tree is almost everything; `FULLTEXT` (InnoDB, with `MATCH ... AGAINST`
and ngram parser for CJK) and `SPATIAL` exist. No partial, no expression
indexes before 8.0.13 (functional indexes: `INDEX ((LOWER(email)))`), no
covering `INCLUDE` (just add the columns to the key), no concurrent-build
keyword needed because `ADD INDEX` is already online (`INPLACE`).

Invisible indexes (8.0) let you test dropping an index without dropping
it: `ALTER TABLE t ALTER INDEX idx INVISIBLE;` then watch the slow log.
Descending indexes are real from 8.0 (before that `DESC` was parsed and
ignored). Index merge exists but is usually a sign a composite index is
missing.

The optimizer uses one index per table per query (plus index merge).
Composite ordering rules from `indexing.md` apply exactly: equality
columns first, then the range or sort column.

MySQL creates an index automatically for each `FOREIGN KEY` if a usable
one does not exist.

## 7. Query behavior and EXPLAIN

```sql
EXPLAIN FORMAT=TREE SELECT ...;        -- 8.0.16+, readable, shows cost and join order
EXPLAIN ANALYZE SELECT ...;            -- 8.0.18+, actual timings; like Postgres
```

Classic `EXPLAIN` columns: `type` (`ALL` = full scan, `index` = full index
scan, `range`, `ref`, `eq_ref`, `const`), `key` (index chosen), `rows`
(estimate), `Extra` (`Using filesort` = a sort, not necessarily on disk;
`Using temporary` = a temp table for `GROUP BY`/`DISTINCT`; `Using index`
= covering; `Using index condition` = index condition pushdown; `Using
where` is normal).

Behaviors to know:

- `ONLY_FULL_GROUP_BY` is on by default on 8.0: selecting a non-aggregated
  column not in `GROUP BY` errors (as it should). Legacy apps may rely on
  it being off.
- Implicit type conversion kills indexes: `WHERE phone = 5551234` on a
  `VARCHAR` column converts every row to a number. Bind the right type.
- `LIMIT ... OFFSET` reads and discards; keyset pagination applies.
- `COUNT(*)` on InnoDB is a full index scan (no counter), same as Postgres.
- Subqueries in `IN (...)` are generally fine on 8.0 (semijoin
  optimization); on 5.x rewrite as joins.
- The slow query log: `slow_query_log = ON`, `long_query_time = 0.5`,
  `log_queries_not_using_indexes` sparingly. Analyze with `pt-query-digest`
  or the `performance_schema` tables (`events_statements_summary_by_digest`
  is the MySQL equivalent of `pg_stat_statements`).
- `sys.schema_unused_indexes` and `sys.schema_redundant_indexes` are
  built-in views; use them.

## 8. Configuration basics

| Setting | Guidance |
|---|---|
| `innodb_buffer_pool_size` | 60-75% of RAM on a dedicated host; this is the cache |
| `innodb_flush_log_at_trx_commit` | 1 for durability (default); 2 trades a second of durability for throughput on replicas or non-critical data |
| `innodb_log_file_size` / `innodb_redo_log_capacity` (8.0.30+) | 1-4 GB; too small causes checkpoint stalls under write load |
| `max_connections` | A few hundred; threads are cheaper than Postgres processes but still pool (ProxySQL, application pool) |
| `transaction_isolation` | Consider `READ-COMMITTED` for OLTP |
| `sql_mode` | Keep `STRICT_TRANS_TABLES` (reject bad data instead of truncating), `ONLY_FULL_GROUP_BY`, `NO_ZERO_DATE` |
| `time_zone` | `'+00:00'` so `TIMESTAMP` and `NOW()` are unambiguous |
| `character_set_server` / `collation_server` | `utf8mb4` / your chosen collation |
| `innodb_lock_wait_timeout` | 5-10s for web |
| `lock_wait_timeout` | Low for migration sessions (metadata lock waits) |
| `sort_buffer_size`, `tmp_table_size`, `max_heap_table_size` | Per-connection; raise moderately if `Created_tmp_disk_tables` climbs |

Without `STRICT_TRANS_TABLES`, MySQL silently truncates strings, rounds
out-of-range numbers and inserts `0000-00-00` dates. Always run strict.

## 9. Replication, PlanetScale, Vitess

Binlog replication (async by default; semi-sync available; Group
Replication/InnoDB Cluster for consensus). `binlog_format = ROW` is the
safe default. Replica lag: `SHOW REPLICA STATUS` (`Seconds_Behind_Source`)
and GTIDs for consistent failover. Read-after-write routing problems are the
same as in `scaling-and-operations.md`.

PlanetScale (Vitess) specifics: no foreign key constraints by default on
older plans (FKs are supported from 2023, but check your database's setting;
without them the application must guarantee integrity), schema changes go
through deploy requests (online, revertible for a window), `connection
limits` are generous because Vitess pools, and sharding is a Vitess
feature driven by a VSchema when you get there. Prisma users set
`relationMode = "prisma"` when FKs are off, which emulates referential
actions in the client (slower, and only covers your app).

## 10. Gotchas vs Postgres, collected

- No transactional DDL: a migration with three `ALTER`s that fails on the
  third leaves two applied. Write migrations as single statements where
  possible; make them idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT
  EXISTS` on MariaDB; MySQL 8 lacks `IF NOT EXISTS` for columns, so check
  `information_schema` in the migration tool).
- `ON DUPLICATE KEY UPDATE` fires on any unique key collision and
  increments `AUTO_INCREMENT` even when it updates (gaps, and with
  `innodb_autoinc_lock_mode = 1` more so). `INSERT IGNORE` swallows *all*
  errors on that row, not only duplicates; avoid.
- `0000-00-00` and zero-dates exist unless `NO_ZERO_DATE`.
- Quoting: identifiers use backticks; `"` is a string delimiter unless
  `ANSI_QUOTES`.
- `GROUP_CONCAT` truncates at `group_concat_max_len` (1024) silently.
- Comparison of `DATETIME` with a string parses the string; pass real
  datetimes.
- `FLOAT`/`DOUBLE` for money is as wrong here as anywhere; `DECIMAL(19,4)`.
- `TEXT` columns in `SELECT DISTINCT` or `ORDER BY` force on-disk temp
  tables.
- Trailing spaces: `PAD SPACE` collations treat `'a'` and `'a '` as equal
  in comparisons; `NO PAD` collations (the `_0900_` ones) do not.
- `AUTO_INCREMENT` counters were lost on restart before 8.0 (recomputed
  from `MAX(id)`, which could reuse IDs after deletes); 8.0 persists them.
- `information_schema` queries can be slow on servers with many tables;
  cache schema introspection.
- `LOAD DATA INFILE` is the fast bulk loader (`LOCAL` from the client);
  `INSERT` with multi-row `VALUES` in batches of 500-5000 is the portable
  one.
