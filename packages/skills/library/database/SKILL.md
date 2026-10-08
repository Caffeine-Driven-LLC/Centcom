---
name: database
description: >
  Data-layer expertise for any codebase: schema and data modeling, migrations,
  indexing, query performance, transactions and concurrency, ORMs, and choosing
  or operating a database (Postgres, MySQL, SQLite, MongoDB, Redis, DynamoDB,
  Firestore, Timescale, pgvector, search engines). Use it whenever the task
  touches tables, columns, models, entities, relations, schema files, migration
  files, seeds, SQL, query builders, or ORM code in Prisma, Drizzle, TypeORM,
  Kysely, Knex, SQLAlchemy, Django ORM, ActiveRecord, Ecto, GORM, sqlc, sqlx,
  Diesel, SeaORM, Hibernate/JPA, Eloquent, Room or Core Data. Trigger on
  phrasings like "add a field to the user", "store this", "save these", "the
  query is slow", "add an index", "deadlock", "timeout", "pagination", "how
  should I model...", "which database", "soft delete", "multi-tenant", "seed
  data", "backup", "migrate", "add a table", "join", "the dashboard query
  takes 20 seconds", or any file matching schema.prisma, *.sql, migrations/,
  alembic/, db/schema.rb, models.py, entities/, drizzle.config.*, and
  knexfile.*. Also load it when the user never mentions a database but the
  feature needs persistence. Load it even when the change looks like one
  column: the default output of a coding agent is a UUIDv4 primary key with no
  index strategy, a float for money, a timestamp without time zone, N+1 ORM
  loops, offset pagination, and a migration that locks the table in
  production; this skill exists to prevent exactly that.
---

# Database

When this loads you become the staff engineer who owns the data layer: the
person who has been paged at 3am for a lock queue behind an `ALTER TABLE`,
who has restored a database from backup for real, who reads `EXPLAIN
ANALYZE` the way others read a stack trace, and who knows that the schema
outlives every application that talks to it. You treat the database as the
last line of defense for data integrity, not as a dumb store behind the ORM.
You are candid about trade-offs: normalization has a cost, so does
denormalization; UUIDs have a cost, so do serials; NoSQL fits some shapes
beautifully and ruins others. You match the conventions already in the repo
(its migration tool, naming, ORM idioms) before bringing your own, and when
you deviate you say why.

Scope boundaries: this skill owns everything about the data itself: how it
is modeled, stored, indexed, queried, migrated, kept consistent, backed up
and scaled at the storage tier. API design, service architecture, where
application-level transactions are opened, background jobs, and the
application caching layer (Redis-as-cache, HTTP caching, memoization) belong
to `backend`; see `backend/references/caching.md` for the cache side of the
cache/database handoff. SQL injection, secrets in connection strings, and
auditing data access belong to `security`; see
`security/references/injection.md` and never write SQL with string
interpolation. Reviewing a migration PR as a reviewer is `code-review`, but
the review checklist in `references/migrations.md` is what the reviewer
should use.

## First: read the room

A schema change made without reading the existing schema is a bug waiting
to be discovered. Before touching anything, learn what database this is,
how it is accessed, how it is migrated, and what conventions it already
has. Every decision below should be *discovered* from the repo, not chosen
from preference.

### Detection table

| Files or dependencies present | Database / access layer | Load |
|---|---|---|
| `schema.prisma`, `@prisma/client` | Prisma over Postgres/MySQL/SQLite/Mongo (check `datasource.provider`) | `references/orms.md` (Prisma), plus the engine reference |
| `drizzle.config.*`, `drizzle-orm` | Drizzle; schema in TS files | `references/orms.md` (Drizzle), engine reference |
| `typeorm`, `entities/*.ts`, `ormconfig*` | TypeORM | `references/orms.md` (TypeORM) |
| `kysely`, `knex`, `knexfile.*`, `postgres` (porsager), `pg`, `mysql2`, `better-sqlite3`, `libsql` | Query builder or raw driver in Node | `references/query-performance.md`, engine reference |
| `sqlalchemy`, `alembic/`, `alembic.ini` | SQLAlchemy (check 1.x vs 2.0 style) | `references/orms.md` (SQLAlchemy), `references/migrations.md` (Alembic) |
| `django`, `models.py`, `*/migrations/0001_*.py` | Django ORM | `references/orms.md` (Django), `references/migrations.md` (Django) |
| `Gemfile` with `rails`/`activerecord`, `db/schema.rb`, `db/structure.sql`, `db/migrate/` | ActiveRecord | `references/orms.md` (ActiveRecord), `references/migrations.md` (Rails) |
| `mix.exs` with `ecto_sql`, `priv/repo/migrations/` | Ecto | `references/migrations.md` (general patterns), `references/postgres.md` |
| `go.mod` with `gorm.io/gorm` | GORM | `references/orms.md` (GORM) |
| `sqlc.yaml`, `query.sql`, `sqlx`, `pgx` | sqlc / sqlx / pgx (SQL-first Go) | `references/query-performance.md`, `references/postgres.md` |
| `build.gradle`/`pom.xml` with `hibernate`, `spring-data-jpa`, `@Entity` | Hibernate / JPA | `references/orms.md` (Hibernate), `references/migrations.md` (Flyway/Liquibase) |
| `flyway.conf`, `db/migration/V1__*.sql`, `liquibase.properties`, `changelog*.xml` | Flyway / Liquibase | `references/migrations.md` |
| `composer.json` with `laravel`, `database/migrations/`, `app/Models/` | Eloquent | `references/orms.md` (Eloquent) |
| `Cargo.toml` with `sqlx`, `diesel`, `sea-orm` | Rust SQL | `references/query-performance.md`, engine reference |
| `atlas.hcl`, `migrate/` with `golang-migrate` style `*.up.sql`/`*.down.sql` | Atlas / golang-migrate | `references/migrations.md` |
| `DATABASE_URL=postgres://`, `docker-compose` with `postgres:` image, `pg_hba.conf` | Postgres | `references/postgres.md` |
| `mysql://`, `mysql:`/`mariadb:` image, `my.cnf` | MySQL / MariaDB | `references/mysql.md` |
| `*.db`, `*.sqlite`, `sqlite3`, `better-sqlite3`, `libsql`, `@libsql/client`, Turso, D1 bindings | SQLite | `references/sqlite.md` |
| `mongoose`, `pymongo`, `motor`, `mongodb` driver, `mongo:` image | MongoDB | `references/nosql.md` |
| `@aws-sdk/client-dynamodb`, `dynamoose`, `electrodb`, `boto3` DynamoDB tables in CDK/Terraform | DynamoDB | `references/nosql.md` |
| `ioredis`, `redis`, `redis-py`, `go-redis`, `redis:` image | Redis (decide: cache or store?) | `references/nosql.md`; cache usage is `backend/references/caching.md` |
| `firebase`, `firestore`, `@supabase/supabase-js`, `supabase/migrations/` | Firestore or Supabase (Postgres with RLS) | `references/nosql.md` (Firestore) or `references/postgres.md` (Supabase, RLS section) |
| `timescaledb`, `create_hypertable`, `influx`, `clickhouse` | Time-series / analytics | `references/search-timeseries-vector.md` |
| `pgvector`, `vector(1536)`, `pinecone`, `qdrant`, `weaviate`, `@elastic/elasticsearch`, `meilisearch`, `typesense`, `opensearch` | Vector / search engines | `references/search-timeseries-vector.md` |
| `pgbouncer`, `pgcat`, `?pgbouncer=true`, Prisma Accelerate, Neon/Supabase pooler URLs, serverless runtime | Connection pooling layer in play | `references/scaling-and-operations.md` (pooling section) |
| `factories/`, `factory_boy`, `factory_bot`, `fishery`, `@faker-js/faker`, `seed.ts`, `seeds.rb`, `fixtures/` | Test data strategy | `references/testing-and-seed-data.md` |

Always load `references/migrations.md` before writing or editing any
migration file. Always load `references/query-performance.md` when the
words "slow", "timeout", "takes N seconds", or "the dashboard" appear.
Always load `references/transactions-and-concurrency.md` for anything
involving "deadlock", "race", "double", "duplicate", "lost update", "queue"
or "lock".

### What to inspect beyond the stack

- **The existing schema.** Dump it (`pg_dump --schema-only`, `prisma db
  pull`, `db/schema.rb`, `SHOW CREATE TABLE`) or read the ORM models. Note
  the primary key style (serial, UUID, which UUID version), naming
  convention (`snake_case` vs `camelCase`, singular vs plural tables,
  `created_at` vs `createdAt`), timestamp types, soft-delete pattern,
  tenant column, audit columns, enum strategy. Match them.
- **The migration history.** How many migrations, how they are named, whether
  they are reversible, whether there are data migrations mixed with schema
  migrations, whether anyone has ever done an expand/contract. This tells
  you the team's deploy maturity and what will be accepted.
- **How the app connects.** Pool size, pooler, statement timeout, read
  replica usage, isolation level set anywhere, `SET search_path`, RLS. A
  change that is fine on a direct connection can break behind PgBouncer in
  transaction mode.
- **Data volume.** Row counts of the tables you will touch (`SELECT
  reltuples::bigint FROM pg_class WHERE relname = ...`, or ask). A 10k-row
  table and a 500M-row table need different migrations and different
  indexes. If you cannot find out, ask; do not assume small.
- **Tests.** Is there a real database in CI? A transactional test wrapper?
  Factories? Mocked repositories (a smell)? This decides how you verify.
- **Production reality.** Hosting (RDS, Cloud SQL, Neon, Supabase,
  PlanetScale, Turso, self-hosted), version (`SELECT version()`), extensions
  available, backup configuration if visible in IaC. Managed hosts restrict
  extensions and superuser operations.

## Core principles

1. **The schema outlives the code.** Applications get rewritten; tables get
   migrated forward for a decade. Spend disproportionate care on names,
   types and constraints, because changing them later costs a migration
   with a lock. Example: `amount_cents bigint not null` will still be right
   in ten years; `amount float` will produce a reconciliation bug next
   quarter.
2. **Model the data, then the access patterns, then the storage.** Start
   from the nouns and the invariants in the requirements, normalize until
   every fact lives in one place, and only then denormalize *for a measured
   read pattern*, writing down what you duplicated and what keeps it in
   sync. Example: `orders.total_cents` as a cached sum is fine when you
   state the trigger or application code that maintains it.
3. **Constraints are the last line of defense, and the cheapest.** A `NOT
   NULL`, a foreign key, a `CHECK`, a unique index: each one is a bug class
   that can never reach the data no matter which code path writes it.
   Application validation is for good error messages; database constraints
   are for truth. "No foreign keys for flexibility" means "orphans for
   free."
4. **Indexes are a trade, not a gift.** Every index speeds up some reads
   and slows every write, costs disk, and fights for cache. Add one when a
   query pattern needs it and you can show the plan; remove ones nothing
   uses. Example: a composite `(tenant_id, created_at desc)` serves the
   list page; six single-column indexes serve nothing well.
5. **Read the plan, not the vibes.** "It should be fast" is not an
   argument. `EXPLAIN (ANALYZE, BUFFERS)` on realistic data volume is. Row
   estimate off by 100x, a sort spilling to disk, a nested loop over a seq
   scan: these are the diagnoses, and each has a specific fix.
6. **Migrations run against production with traffic.** Any statement that
   takes an exclusive lock for longer than a few hundred milliseconds on a
   busy table is an outage. Expand, backfill in batches, contract. Create
   indexes concurrently. Add `NOT NULL` via a validated check constraint.
   Every migration gets the question "what lock does this take, for how
   long, and what is waiting behind it?"
7. **Transactions are about invariants, not about grouping statements.**
   Open one when a set of writes must be atomic or a read must be
   consistent; keep it short; never hold it across network calls or user
   think-time. Know the isolation level you are actually running at (Read
   Committed in Postgres, Repeatable Read in MySQL by default) and which
   anomalies it permits.
8. **The ORM is a convenience, not an abstraction over SQL.** You still own
   the SQL it emits. Log it once, read it once, and drop to raw
   (parameterized) SQL when the ORM fights you: window functions, upserts,
   CTEs, lateral joins, bulk operations. An ORM that hides N+1 behind lazy
   loading has not removed the problem.
9. **Postgres by default, with reasons to leave.** It is the right default
   for a new relational workload because of its type system, extensions,
   transactional DDL and ecosystem. SQLite is right far more often than
   people think (single-node, embedded, edge, tests). Document stores win
   when the data genuinely is a document with one owner and one access
   path. Choose the exception deliberately and write down why.
10. **Operations are part of the design.** A table design that cannot be
    backed up and restored in the RTO, vacuumed without bloat, or
    partitioned when it grows is incomplete. Ask "how does this get
    deleted?" and "how does this get restored?" before shipping it.

## Workflow

### Stage 1: understand the requirement as data

Write down, in plain language, the entities, their identity (what makes two
rows the same thing), their relationships and cardinalities, the invariants
that must always hold (an order has at least one line; a seat is booked by
at most one ticket), the lifecycle (created, changed, archived, deleted,
retained for how long), the read patterns with their expected frequency and
volume, and the write patterns and their concurrency (is this a counter a
thousand users increment at once?). Ten minutes here saves a week later.
If an invariant is unclear ("can a user belong to several organizations?"),
ask; it is a one-line question and the answer changes the schema shape.

### Stage 2: choose the storage shape

Default to the database already in the repo. For a greenfield decision use
the reasoning in `references/data-modeling.md` and the engine references:
relational (Postgres) unless the data is a self-contained document with
one access path (document store), a cache or ephemeral structure (Redis),
massive append-only time series (Timescale/ClickHouse), full-text relevance
ranking at scale (search engine), or embeddings (pgvector first, dedicated
vector DB only at scale). Adding a second database to a project is a large
decision with operational cost; propose it, do not just do it.

### Stage 3: model

Produce the tables, keys, types, constraints and relationships. Decide the
primary key strategy for *this repo* (match existing; if greenfield, prefer
`bigint generated always as identity` for internal tables and UUIDv7 when
IDs must be generated client-side or must not be guessable; avoid random
UUIDv4 as a clustered or heavily indexed key, see
`references/data-modeling.md`). Choose types with intent: `bigint` cents or
`numeric(19,4)` for money, `timestamptz` for instants, `text` with a check
constraint instead of `varchar(255)` by reflex, a lookup table or a
check-constrained text column instead of a native enum you will have to
migrate. Decide soft delete versus archive table versus hard delete with
audit log, and say which. Write audit columns (`created_at`, `updated_at`,
and if the domain needs it `created_by`). For multi-tenant systems, pick
the tenancy model consciously and put `tenant_id` first in composite keys
and indexes.

Stop and ask the user when: the cardinality of a core relationship is
ambiguous; the data is clearly regulated (health, payments, children) and
retention or encryption requirements are unknown; the choice between
tenancy models is open; or you would need to introduce a second database
or a paid extension.

Decide and note it when: naming follows an existing convention; the key
strategy matches the repo; the index set follows directly from the stated
queries; the migration pattern is the standard safe one.

### Stage 4: write the migration

Use the repo's migration tool, in the repo's style, with the repo's naming.
Never hand-write SQL migrations into a Prisma project or add Alembic to a
Django project. Every migration is reviewed with the questions in
`references/migrations.md`: what lock, how long, is it reversible, does it
need a backfill, is the backfill batched, does it create indexes
concurrently (and therefore outside a transaction), is the `NOT NULL` added
safely, is anything renamed (almost never do that directly in production;
expand/contract instead). Schema changes and data backfills are separate
migrations or separate steps. If the repo has a `down` convention, write a
real `down`, and be honest in the PR description about which steps cannot
be rolled back (dropped columns, lossy type changes).

### Stage 5: write the queries

Write the SQL you want first, even if the ORM will express it. Make it use
indexes you have or will add. Avoid `SELECT *` in anything that is not an
ad hoc query; name the columns so the plan can use covering indexes and so
adding a column later does not change the payload. Use keyset pagination
for anything that will exceed a few thousand rows. Use upserts (`INSERT ...
ON CONFLICT`, `INSERT ... ON DUPLICATE KEY UPDATE`) instead of
select-then-insert. Batch writes. Then express it in the ORM, and read the
SQL the ORM generated (every ORM has a log flag; see `references/orms.md`).
If the ORM output is wrong or slow, use the ORM's raw escape hatch with
bound parameters.

### Stage 6: verify against real data and real concurrency

See Verification below. Realistic volume means at least the order of
magnitude of production; a query that is fast on 100 rows tells you
nothing. Concurrency means running the write path from two sessions and
seeing what happens: that is how you find the lost update, the duplicate
insert, the deadlock.

### Stage 7: operational handoff

In the summary, state: the lock profile of the migration and when it should
run; any backfill and how long it will take at production volume; new
indexes and their size estimate; new tables and their expected growth and
retention; anything the on-call should watch (replication lag during
backfill, autovacuum on a table you churned). If you added a cron-like
cleanup or partition rotation, say where it runs.

## Quality bar

### What excellent looks like

- The schema reads like documentation: every table has a clear identity,
  every column a precise type, every relationship a foreign key with a
  chosen `ON DELETE` behavior, every invariant a constraint. Nullable
  columns are nullable because the absence means something.
- Keys and indexes are explained in one sentence each, and the list page,
  the detail page and the hot write path each have exactly the index they
  need, no more.
- The migration is boring: additive, concurrent index creation, batched
  backfill with progress logging, `NOT NULL` via `CHECK ... NOT VALID` then
  `VALIDATE`, no renames, reversible where physically possible, with a
  stated plan for the irreversible bits.
- Queries are shown with their `EXPLAIN ANALYZE` on realistic volume: index
  scans where expected, row estimates within 2-3x of actual, no sort spill,
  no nested loop over a seq scan. Pagination is keyset. Lists select named
  columns.
- Concurrency is handled explicitly: a unique constraint backs every
  "ensure only one" rule, a version column or `SELECT ... FOR UPDATE` guards
  every read-modify-write, `FOR UPDATE SKIP LOCKED` backs any queue, and
  idempotency keys back any externally triggered write.
- Tests run against a real database of the same engine, inside a
  transaction or on a fresh schema per test, with factories producing
  realistic rows, and at least one test proves a constraint fires.
- The summary tells operations what will happen when this deploys.

### What mediocre looks like: AI-specific failure modes

- **An index on every column.** Six single-column indexes on a table whose
  only query filters on two columns together. Fix: one composite index in
  the right order (equality columns first, then the range/sort column); see
  `references/indexing.md`.
- **UUIDv4 primary keys by reflex.** Random keys scatter inserts across the
  B-tree, bloat indexes, and destroy locality on clustered engines (MySQL
  InnoDB). Fix: identity `bigint` for internal tables, UUIDv7 (or ULID)
  when IDs must be client-generated or unguessable.
- **Offset pagination on a big table.** `LIMIT 20 OFFSET 400000` reads and
  discards 400k rows. Fix: keyset on `(created_at, id)` with a matching
  index.
- **Migrations that lock production.** `ALTER TABLE ... ADD COLUMN ... NOT
  NULL DEFAULT now()` (a volatile default rewrites the whole table on every
  Postgres version; only constant defaults are instant since PG 11),
  `CREATE INDEX` without
  `CONCURRENTLY`, `ALTER COLUMN TYPE` on a large table, renaming a column
  the running app still reads. Fix: `references/migrations.md`.
- **Money as float, or as `numeric` with no scale.** Fix: integer minor
  units in `bigint`, or `numeric(19,4)` with the currency alongside.
- **`timestamp` without time zone.** Stores a wall clock with no instant.
  Fix: `timestamptz` (Postgres) / `DATETIME(6)` stored as UTC with
  discipline (MySQL), and `date` when only a calendar day is meant.
- **JSON columns to avoid modeling.** `metadata jsonb` holding fields the
  app filters and joins on. Fix: columns for anything queried, constrained
  or related; JSON for genuinely schemaless, owner-scoped blobs.
- **`SELECT *` from the ORM by default.** Every list endpoint pulls every
  column including the 50 KB `body`. Fix: select/pluck/only the columns the
  endpoint returns.
- **N+1 by default.** A loop that touches `order.customer` with lazy
  loading. Fix: eager load (`include`, `select_related`,
  `joinedload`, `includes`, `Preload`, `with`) or a join; see
  `references/orms.md` and the detection recipes in
  `references/query-performance.md`.
- **No foreign keys "for flexibility" or "for performance."** Fix: add
  them; the write cost is a single index lookup and the alternative is
  orphan cleanup scripts forever.
- **Native enums for things that change.** `CREATE TYPE status AS ENUM`
  for a workflow that will grow states. Fix: a `text` column with a `CHECK
  (status IN (...))` constraint (cheap to change) or a lookup table when
  statuses carry data.
- **Mocking the database in tests.** A repository mock that returns what
  the test wants, proving nothing about the query or the constraints. Fix:
  a real database in tests; see `references/testing-and-seed-data.md`.
- **String-interpolated SQL.** `f"WHERE id = {id}"`. Fix: bound parameters,
  always; see `security/references/injection.md`.
- **Ignoring the repo's migration tool.** Writing a raw `.sql` file next to
  an Alembic directory. Fix: the detection table.
- **Soft delete everywhere with no filtering strategy.** `deleted_at` on
  every table and half the queries forget the predicate. Fix: decide per
  table; use a view, a partial index, or an archive table.
- **Treating a managed pooler as a plain connection.** Prepared statements
  or session settings behind PgBouncer transaction mode. Fix:
  `references/scaling-and-operations.md`.

## Reference map

| File | Read when | Contains |
|---|---|---|
| `references/data-modeling.md` | Designing or changing a schema, "how should I model" | Modeling method, normalization with intent, key choice (serial vs UUIDv4 vs UUIDv7/ULID), relationships and join tables, polymorphism, hierarchies, soft delete alternatives, audit/history tables, multi-tenancy patterns, type choices for money/time/text |
| `references/postgres.md` | Postgres is the engine | jsonb/arrays/ranges/enums, every index type, RLS, partitioning, extensions (pg_trgm, pgvector, pg_stat_statements), config basics, vacuum, annotated EXPLAIN examples |
| `references/mysql.md` | MySQL or MariaDB | InnoDB clustered PK consequences, isolation defaults, online DDL, utf8mb4, gotchas vs Postgres |
| `references/sqlite.md` | SQLite, Turso/libSQL, D1, embedded, tests | When it is the right call, WAL mode, pragmas, concurrency reality, Litestream, use in tests and at the edge |
| `references/nosql.md` | Mongo, DynamoDB, Redis as store, Firestore, "should we use NoSQL" | Document modeling, Mongo indexes and aggregation pitfalls, DynamoDB single-table design, Redis structures, Firestore/Supabase realtime, when not to |
| `references/indexing.md` | Any index decision, "add an index", slow filter/sort | Mental model, composite ordering rule, covering, partial, expression, selectivity, index-only scans, write amplification, finding missing and unused indexes |
| `references/query-performance.md` | "slow", timeouts, EXPLAIN, pagination, batch ops | EXPLAIN ANALYZE walkthroughs and fixes, keyset pagination, batch upserts, N+1 detection, statement timeouts, pg_stat_statements workflow, inspecting ORM SQL |
| `references/transactions-and-concurrency.md` | Transactions, races, duplicates, deadlocks, queues | Anomalies with examples, isolation levels per engine, locking, SKIP LOCKED queues, deadlock diagnosis, optimistic concurrency, idempotency, advisory locks |
| `references/migrations.md` | Any migration file | Zero-downtime patterns step by step, tooling per ecosystem, batched backfills, safe/unsafe operations table, PR review checklist, rollback reality |
| `references/orms.md` | Any ORM code | Per-ORM footguns and fixes, SQL logging flags, raw escape hatches, transaction APIs, when to drop to SQL |
| `references/scaling-and-operations.md` | Pooling, replicas, partitioning, sharding, backups, monitoring | PgBouncer modes and prepared statement gotchas, serverless pooling, replication lag, partitioning, sharding criteria, backup/PITR and restore drills, monitoring queries, bloat, capacity |
| `references/integrity-and-constraints.md` | Constraints, enums, triggers, validation layering | Constraint catalogue with syntax, deferred constraints, enums vs lookup tables, triggers, generated columns, app vs DB validation |
| `references/search-timeseries-vector.md` | Full-text, time series, embeddings | Postgres FTS vs engines, Timescale and partition-based time series, downsampling, pgvector HNSW/IVFFlat, hybrid search |
| `references/testing-and-seed-data.md` | Tests touching the DB, seeds, fixtures | Real DB in tests, transaction-per-test, factories, realistic seeds, migration tests, prod-like volume |
| `scripts/explain_summary.py` | You have an `EXPLAIN (ANALYZE, FORMAT JSON)` output | Prints top nodes by time with red flags (seq scans on large tables, estimates off >10x, sort spills, lossy bitmap scans) |

## Verification

Do not hand over a schema change you have only read. Run it.

1. **Migrate up and down on a scratch database.** Spin up the same engine
   and major version as production (`docker run postgres:16`, the repo's
   compose file, or the test database). Run the migration up, inspect the
   resulting schema (`\d+ table`, `SHOW CREATE TABLE`, `prisma db pull`
   diff), run it down, confirm the schema returns to the previous state.
   If `down` is not possible, say so in the PR.
2. **Time the migration at realistic volume.** Load the table to
   production order of magnitude (`generate_series`, a factory loop, or an
   anonymized dump) and run the migration with `\timing` on. Check what
   lock it takes (`SELECT locktype, mode, granted FROM pg_locks` from a
   second session while it runs). Anything holding `ACCESS EXCLUSIVE` for
   more than a blink on a hot table goes back to the drawing board.
3. **EXPLAIN ANALYZE every new or changed query** at that volume, with
   `BUFFERS`. Save the JSON and run `scripts/explain_summary.py` on it.
   Confirm the index you added is used, estimates are within a few x of
   actuals, no sort spills, no seq scan on a large table unless intended.
4. **Prove constraints fire.** Insert a row that violates each new
   constraint and confirm the error. Delete a parent and confirm the `ON
   DELETE` behavior. Try the duplicate the unique index is meant to stop.
5. **Run the write path concurrently.** Two sessions, same row or same
   natural key, interleaved. Confirm no lost update, no duplicate, no
   deadlock (or a retry that handles it).
6. **Run the test suite against a real database.** If the project mocks
   the DB, add at least one real integration test for the new path, using
   the pattern in `references/testing-and-seed-data.md`.
7. **Inspect the ORM-generated SQL once.** Turn on query logging for the
   touched code path and read the statements. Count them. If a list of N
   items produces N+1 statements, fix it before handing over.
8. **Check the pooler and the replica.** If the app runs behind a pooler
   in transaction mode, confirm the change does not rely on session state.
   If reads go to a replica, confirm the read-after-write path does not.

If you could not do one of these (no Docker, no data), say exactly which
and what risk remains.

## Final checklist

- Used the repo's existing engine, ORM, migration tool, naming and key
  conventions; nothing new introduced without saying so.
- Every table has a clear identity and primary key chosen on purpose; types
  chosen with intent (money, time, text, IDs); nullability means something.
- Invariants are constraints: NOT NULL, FK with chosen ON DELETE, UNIQUE,
  CHECK. No "flexibility" orphans.
- Indexes match the stated queries, composite order justified, nothing
  redundant; new index sizes estimated.
- Migration lock profile known and safe: concurrent indexes, batched
  backfill, safe NOT NULL, no renames in place; reversibility stated.
- Queries select named columns, paginate by keyset, batch writes, upsert
  instead of check-then-insert; EXPLAIN ANALYZE on realistic data attached.
- Concurrency handled: unique constraints, FOR UPDATE / version column /
  SKIP LOCKED / idempotency key as appropriate; isolation level known.
- ORM SQL inspected once; no N+1, no SELECT * on wide tables; raw SQL
  parameterized.
- Tests run against a real database; at least one test proves a constraint.
- Retention, deletion and PII handling decided for any new personal data.
- Summary includes operational notes: when to run, how long, what to watch.
