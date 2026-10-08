# SQLite

SQLite is the right database more often than people assume: single-server
web apps, desktop and mobile apps, CLIs, edge runtimes, embedded devices,
analytics on a laptop, and the test database for anything that does not
depend on engine-specific SQL. This file covers when it fits, WAL mode and
the pragmas that matter, the real concurrency story, type quirks, backups
with Litestream and friends, Turso/libSQL and Cloudflare D1, and how to use
it in tests honestly.

## Contents

1. When SQLite is the right call, and when it is not
2. Setup: WAL mode and pragmas
3. Concurrency reality
4. Types, affinity and STRICT tables
5. Schema changes
6. Indexing and query planning
7. Backups, replication, durability
8. Hosted and edge variants: Turso/libSQL, D1, Litestream, rqlite
9. Using SQLite in tests
10. Driver notes by ecosystem

## 1. When SQLite is the right call

Fits:

- One application server (or one process per tenant) that owns the file.
  Modern SQLite handles tens of thousands of reads per second and
  thousands of writes per second on an SSD, far more than most products
  ever need. The whole database living in the page cache beats a network
  round-trip to Postgres every time.
- Desktop, mobile (iOS and Android ship it), CLI tools, local-first apps,
  browser (wa-sqlite / sql.js / OPFS).
- Edge and serverless where a per-region replica is read-mostly
  (Turso/libSQL embedded replicas, D1).
- Analytics on files that fit on disk (with DuckDB as the columnar
  alternative for heavy OLAP).
- Tests, when the production engine is also SQLite or when the code under
  test genuinely uses only portable SQL.
- Config stores, caches, queues within one process, application file
  formats (it is a better file format than JSON once you need to query).

Does not fit:

- Multiple application servers needing to write the same data. SQLite has
  one writer at a time and no network protocol; sharing the file over NFS
  is a corruption story. Scale-out writes means Postgres or a distributed
  SQLite service.
- Heavy concurrent writes from many processes (hundreds of writes/sec
  from independent workers contending for the lock).
- Needs for RLS, fine-grained roles, stored procedures, materialized
  views, `ALTER COLUMN`, partitioning, or extensions like pgvector (there
  is `sqlite-vec` for vectors and FTS5 for text, which cover more than
  people expect).
- Very large databases (hundreds of GB work, but backups, migrations and
  vacuum get slow, and the single-writer limit bites).

The honest framing for a new product: if you will run one server for the
next two years, SQLite with Litestream replication is simpler, faster and
cheaper than a managed Postgres, and migrating to Postgres later is a
known path. If you already have Postgres in the repo, do not add SQLite
for production data.

## 2. Setup: WAL mode and pragmas

Set these when opening every connection (most are per-connection), except
`journal_mode`, which is persistent in the file:

```sql
PRAGMA journal_mode = WAL;          -- persistent; readers no longer block the writer and vice versa
PRAGMA synchronous = NORMAL;        -- with WAL: durable against app crash, may lose last txns on power loss; FULL for strict durability
PRAGMA foreign_keys = ON;           -- OFF by default! per connection
PRAGMA busy_timeout = 5000;         -- wait up to 5s for the write lock instead of failing with SQLITE_BUSY immediately
PRAGMA cache_size = -64000;         -- 64 MB page cache (negative = KiB)
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;       -- 256 MB memory-mapped I/O; speeds reads on 64-bit
PRAGMA journal_size_limit = 67108864;  -- cap WAL file at 64 MB after checkpoints
```

What WAL changes: writes append to `db-wal` and are checkpointed into the
main file periodically (`wal_autocheckpoint`, default 1000 pages). Readers
read a consistent snapshot without blocking the writer. One writer still.
WAL requires all processes to be on the same host (shared memory file
`db-shm`); it does not work over network filesystems.

Checkpoint starvation: if a reader is always open, the WAL can never be
fully checkpointed and grows. Run `PRAGMA wal_checkpoint(TRUNCATE)` in a
quiet moment, or ensure readers release.

`foreign_keys = ON` is the one everyone forgets. Without it, FKs are
syntax only. ORMs often set it (Prisma does, Django does, Rails does with
`foreign_keys: true` in config); verify with `PRAGMA foreign_keys;`.

## 3. Concurrency reality

- **One writer at a time**, database-wide. A write transaction holds the
  lock from its first write (or from `BEGIN IMMEDIATE`) until commit.
  Other writers wait up to `busy_timeout`, then get `SQLITE_BUSY`.
- **Use `BEGIN IMMEDIATE` for transactions that will write.** A deferred
  `BEGIN` that reads then tries to write can hit `SQLITE_BUSY` at the
  upgrade point with no way to wait (the busy handler is not invoked for
  that upgrade in some cases), so it fails even with a timeout set.
  `BEGIN IMMEDIATE` acquires the write lock up front and waits properly.
- **Keep write transactions short.** Milliseconds. Never hold one across
  a network call. This is the single rule that makes SQLite work for web
  apps.
- **Many readers are fine** in WAL mode, from many connections and
  processes on the same machine.
- **In-process connection pools**: one writer connection (serialized by a
  mutex or a queue in your app) and N reader connections is the common
  high-performance pattern (`better-sqlite3` is synchronous and
  single-connection by design, which fits; Go's `database/sql` with
  `SetMaxOpenConns(1)` for the writer DB and a separate read DB).
- Long-running `SELECT`s do not block writers in WAL mode, but they do
  hold back checkpoints.

Throughput numbers (SSD, WAL, `synchronous=NORMAL`): single-row inserts
in separate transactions ~5-20k/s; batched inserts in one transaction
~500k rows/s; reads from cache ~hundreds of thousands/s. Fsync is what
costs; `synchronous=FULL` drops writes to the fsync rate of the disk.

## 4. Types, affinity and STRICT tables

SQLite columns have *type affinity*, not types: a column declared
`INTEGER` will store the text `'abc'` if you insert it. Storage classes
are `NULL`, `INTEGER`, `REAL`, `TEXT`, `BLOB`. Consequences:

- No `BOOLEAN` (stored as 0/1), no `DATETIME` (store ISO-8601 text in UTC
  `'2026-03-04T10:15:00Z'` or integer epoch; the built-in `datetime()`,
  `julianday()`, `unixepoch()` functions handle both), no `DECIMAL` (store
  integer cents; `REAL` is a double), no `UUID` type (store as `BLOB`
  16 bytes or `TEXT` 36; `TEXT` is friendlier to tools and the size cost
  rarely matters here).
- `INTEGER PRIMARY KEY` is an alias for the `rowid` and is the fastest
  key; `AUTOINCREMENT` adds a bookkeeping table to guarantee no reuse and
  is slightly slower; use it only if ID reuse after delete would be a
  bug.
- **`STRICT` tables** (3.37+, 2021) enforce declared types (`INT`,
  `INTEGER`, `REAL`, `TEXT`, `BLOB`, `ANY`): `CREATE TABLE t (...) STRICT;`.
  Use them for new schemas.
- `WITHOUT ROWID` tables are clustered on the declared PK (like InnoDB);
  good for lookup tables keyed by text.
- `CHECK` constraints work and are cheap: `status TEXT NOT NULL CHECK
  (status IN ('a','b'))`.
- Generated columns (3.31+): `total INTEGER GENERATED ALWAYS AS (qty *
  price_cents) STORED`.
- JSON: `json_extract`, `->`, `->>`, `json_each`, `json_tree`; JSONB
  storage format in 3.45+. Index with an expression index on
  `json_extract(doc, '$.field')`.
- `RETURNING` (3.35+), `UPSERT` with `ON CONFLICT (k) DO UPDATE SET x =
  excluded.x` (3.24+), window functions (3.25+), CTEs, `FILTER`,
  `RIGHT`/`FULL JOIN` (3.39+): the SQL surface is modern. Check the
  linked SQLite version in your runtime (`SELECT sqlite_version()`);
  Python's bundled version lags on some platforms.

```sql
CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL CHECK (status IN ('draft','placed','paid')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC);
```

## 5. Schema changes

`ALTER TABLE` supports `RENAME TABLE`, `RENAME COLUMN` (3.25+), `ADD
COLUMN` (with limits: no `UNIQUE`, no non-constant default, no FK with
`REFERENCES` when `foreign_keys=ON` and a default is set) and `DROP COLUMN`
(3.35+, with limits: not indexed, not in a constraint). Everything else
(change type, add constraint, add NOT NULL) is the 12-step rebuild from
the SQLite docs:

```sql
PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE orders_new (...new definition...);
INSERT INTO orders_new SELECT ... FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX ...;             -- recreate indexes, triggers, views
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
```

DDL is transactional in SQLite, so the rebuild is atomic. The rebuild
takes the write lock for its duration: fine for small tables, a pause for
large ones. Migration tools (Prisma, Drizzle Kit, Alembic with
`render_as_batch=True`, Django, Rails, `golang-migrate`, Atlas) generate
this dance for you; let them.

## 6. Indexing and query planning

Same B-tree rules as elsewhere (`indexing.md`), plus:

- `EXPLAIN QUERY PLAN SELECT ...` shows `SCAN t` (full scan), `SEARCH t
  USING INDEX idx (col=?)`, `USING COVERING INDEX`, `USE TEMP B-TREE FOR
  ORDER BY` (a sort). Make the temp B-tree disappear with an index
  matching the sort.
- Run `ANALYZE` (or `PRAGMA optimize` at connection close, 3.18+) so the
  planner has statistics; without it, it guesses.
- Partial indexes (`WHERE deleted_at IS NULL`) and expression indexes
  (`ON users (lower(email))`) are supported.
- `LIKE` is case-insensitive for ASCII by default and does not use an
  index unless `PRAGMA case_sensitive_like = ON` or you use `GLOB`/`>=`
  range tricks. For substring search use FTS5 (`CREATE VIRTUAL TABLE
  docs_fts USING fts5(title, body, content='docs')`), which is excellent.
- No parallel query, no hash joins before 3.33 (automatic indexes
  instead); the planner is good but prefers you give it indexes.
- `sqlite-vec` provides vector search as a loadable extension if you
  need embeddings locally.

## 7. Backups, replication, durability

- Never copy the `.db` file while it is open for writing (torn copy).
  Use the online backup API (`sqlite3 db ".backup out.db"`,
  `VACUUM INTO 'out.db'` from 3.27+, or the driver's `backup()`), which
  produces a consistent snapshot without stopping writers.
- **Litestream** tails the WAL and streams it continuously to S3/GCS/Azure/
  SFTP, giving point-in-time restore with seconds of data loss window
  for one binary and a config file. This is what makes single-server
  SQLite production-safe. Restore: `litestream restore -o db.sqlite
  s3://bucket/path`. Test the restore.
- **LiteFS** (Fly.io) replicates the database to multiple nodes with a
  single elected writer and forwards writes; closer to read replicas.
- `synchronous = NORMAL` in WAL mode is durable against application
  crashes; a kernel panic or power loss may lose the last transactions
  (not corrupt the file). `FULL` if that matters more than write
  throughput.
- `PRAGMA integrity_check` (slow, thorough) or `quick_check` on a
  schedule or at startup for embedded devices.
- `VACUUM` rebuilds the file to reclaim space after large deletes; it
  needs the write lock and 2x disk temporarily. `auto_vacuum =
  INCREMENTAL` plus `PRAGMA incremental_vacuum` is the gentle version.

## 8. Hosted and edge variants

- **Turso / libSQL**: a fork of SQLite with a server (sqld) speaking HTTP/
  WebSocket, multi-region replicas, and *embedded replicas* (a local file
  that syncs from the primary; reads are local, writes go to the primary).
  Schema and SQL are SQLite; the `@libsql/client` and `libsql` drivers add
  the remote protocol. Transactions over HTTP are batched or interactive
  with a per-connection stream; keep them short. Database-per-tenant is
  cheap here (thousands of databases), which changes multi-tenancy math.
- **Cloudflare D1**: SQLite at the edge via Workers bindings. Writes go to
  a single primary per database; read replication is rolling out; no
  long-lived connections; use `batch()` for multi-statement atomicity.
  Size limits per database (10 GB at time of writing); design for many
  small databases if needed.
- **Litestream** (above) for the single-VM deployment; **rqlite** and
  **dqlite** for Raft-replicated SQLite when you need consensus (rare).
- **Bun** ships `bun:sqlite`; **Node** 22+ ships `node:sqlite`
  (experimental); **Deno** has `@db/sqlite`. All are synchronous
  in-process APIs, which is the right model for SQLite.

## 9. Using SQLite in tests

Honest rules:

- If production is SQLite, test on SQLite. Use a fresh file (or `:memory:`
  with `?cache=shared` when the framework needs multiple connections to
  see the same database) per test run, run the real migrations, and use
  transaction-per-test rollback.
- If production is Postgres or MySQL, testing on SQLite is a lie the
  moment you use `jsonb` operators, `RETURNING` semantics, `ON CONFLICT`
  with constraints the ORM emulates, case-sensitive `LIKE`, array types,
  `timestamptz` behavior, enum types, RLS, `FOR UPDATE SKIP LOCKED`,
  window function edge cases, or FK enforcement details. Those are the
  things most likely to break, so the fast fake test gives confidence
  precisely where it is not warranted. Run the production engine in CI
  (Docker is fast; see `testing-and-seed-data.md`). SQLite may still serve
  as a quick local pre-check for pure-ORM unit tests when the team agrees.
- `:memory:` databases vanish when the last connection closes; pool
  settings that open/close connections per query will make tables
  disappear mid-test. Use a single shared connection or a file in a temp
  directory.

## 10. Driver notes by ecosystem

| Runtime | Driver | Notes |
|---|---|---|
| Node | `better-sqlite3` (sync, fastest), `node:sqlite` (22+), `@libsql/client` (Turso), `sqlite3` (async callbacks, legacy) | Prisma, Drizzle, Kysely, Knex support SQLite; Drizzle + `better-sqlite3` is a common pairing |
| Bun | `bun:sqlite` | Built in; `Database.prepare` statements are cached |
| Python | `sqlite3` stdlib (check `sqlite3.sqlite_version`), `aiosqlite`, SQLAlchemy `sqlite+pysqlite://` | Set `isolation_level=None` and manage `BEGIN IMMEDIATE` yourself for predictable locking; Django sets `PRAGMA foreign_keys` and has `"OPTIONS": {"transaction_mode": "IMMEDIATE", "init_command": "PRAGMA journal_mode=WAL;..."}` on 5.1+ |
| Ruby | `sqlite3` gem; Rails 7.1+/8 default to WAL, `busy_timeout`, `IMMEDIATE` transactions and tuned pragmas (Rails 8 is explicitly "SQLite in production" friendly, with Solid Queue/Cache/Cable on SQLite) | |
| Go | `modernc.org/sqlite` (pure Go, no cgo), `mattn/go-sqlite3` (cgo), `zombiezen.com/go/sqlite`, `crawshaw.io/sqlite` | Separate read and write pools; `_pragma=busy_timeout(5000)` in the DSN |
| Rust | `rusqlite`, `sqlx` (`sqlite://`), `diesel` | `sqlx` has compile-time checked queries against a `DATABASE_URL=sqlite://dev.db` |
| Swift / Kotlin | GRDB, SQLite.swift, Room (Android), SQLDelight | Room generates typed DAOs; WAL on by default in Room |
| Flutter | `sqflite`, `drift` | Drift gives typed queries and migrations |
| Browser | `sql.js` (wasm, in memory), `wa-sqlite` with OPFS, SQLite's official wasm build | Persistence via OPFS/IndexedDB VFS |
| C/C++/embedded | the amalgamation `sqlite3.c` | Compile-time options (`SQLITE_ENABLE_FTS5`, `SQLITE_ENABLE_JSON1` is default now) |

Whatever the driver, the checklist is the same: WAL on, `foreign_keys` on,
`busy_timeout` set, `BEGIN IMMEDIATE` for write transactions, short
transactions, a real backup path, and `ANALYZE` after bulk loads.
