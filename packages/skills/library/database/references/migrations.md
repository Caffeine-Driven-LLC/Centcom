# Migrations

How to change a production schema without downtime: the lock model that
makes naive migrations dangerous, the expand/contract method step by step,
batched backfills with real scripts, the safe/unsafe operations table per
engine, migration tooling per ecosystem (Prisma Migrate, Drizzle Kit,
Alembic, Django, Rails, Flyway/Liquibase, golang-migrate, Atlas, Ecto,
Knex/Kysely, Supabase CLI), a PR review checklist, and the truth about
rollbacks.

## Contents

1. Why migrations break production: the lock model
2. The expand/contract method
3. Operation-by-operation: safe, careful, unsafe
4. Recipes
5. Backfills in batches
6. Tooling per ecosystem
7. Rollback reality
8. Migration PR review checklist
9. Process: how migrations should flow

## 1. Why migrations break production: the lock model

Postgres DDL takes an `ACCESS EXCLUSIVE` lock on the table for the
duration of the statement. While it holds that lock, every read and write
on that table waits. Worse, *before* it gets the lock, it waits for every
transaction currently touching the table to finish, and while it waits in
the queue, every new statement on the table queues behind it (lock
queues are FIFO). So a `ALTER TABLE` that would take 5ms, issued while
one long report transaction is reading the table, stalls the entire
application for as long as that report runs.

Two consequences:

1. Set `lock_timeout` in every migration session (`set lock_timeout =
   '5s'`), so the DDL gives up instead of poisoning the queue, and retry
   in a loop. Rails `strong_migrations`, Django `django-pg-zero-downtime-
   migrations`, Alembic custom env, and Flyway placeholders all allow this.
2. Classify each operation by (a) how long it holds the exclusive lock
   (instant metadata change vs full table rewrite) and (b) whether it
   blocks reads, writes or both.

MySQL InnoDB uses metadata locks with the same queueing problem, plus
`ALGORITHM` tiers (`INSTANT`/`INPLACE`/`COPY`); see `mysql.md`. SQLite
takes the single write lock for the whole rebuild; with small tables it
is a blip; with large ones it is a pause, and there is no concurrent
alternative.

Also: Postgres DDL is transactional (a failed migration rolls back
cleanly), MySQL DDL is not (each statement commits; a failed multi-step
migration leaves a partial state you must fix by hand).

## 2. The expand/contract method

Any change that is not purely additive goes through three deploys, with
the application tolerant of both schemas in between:

1. **Expand.** Add the new structure alongside the old (new column, new
   table, new index). Deploy application code that *writes to both* old
   and new (or writes new and keeps old as read fallback), and reads from
   old. Nothing breaks if this deploy is rolled back.
2. **Migrate data.** Backfill the new structure in batches (section 5).
   Verify (counts, checksums, spot checks). Switch reads to the new
   structure (a feature flag helps). Add constraints (`NOT NULL`, FK) now
   that the data is complete, using the non-blocking forms.
3. **Contract.** Deploy application code that no longer references the
   old structure. Then, in a later migration, drop the old column/table.
   Keep a backup or a rename-to-`_old` grace period if the data is
   irreplaceable.

Renaming a column is the canonical example: `rename column` is instant in
Postgres but the running application (old pods during a rolling deploy,
or the previous version if you roll back) still issues `select old_name`,
which now errors. Expand/contract: add `new_name`, dual-write, backfill,
switch reads, stop writing old, drop `old_name`. For a trivially small
table in a single-instance app with a maintenance window, a direct rename
is fine; say which situation you are in.

Views can shortcut some renames: rename the table and create a view with
the old name during the transition (Postgres views are updatable for
simple cases).

## 3. Operation-by-operation: safe, careful, unsafe

Postgres 12+ unless noted. "Lock time" is how long `ACCESS EXCLUSIVE` is
held; "blocks" is what waits.

| Operation | Lock time | Verdict | Safe form |
|---|---|---|---|
| `create table`, `create index concurrently`, `create view`, `create function` | none / short on new object | Safe | As is; `concurrently` cannot be inside a transaction |
| `add column` nullable, no default or constant default (PG 11+) | instant (metadata) | Safe | As is; still blocks momentarily, so `lock_timeout` + retry |
| `add column ... default <volatile>` (`now()`, `gen_random_uuid()`) | full table rewrite | Unsafe | Add nullable, backfill in batches, then set default for new rows |
| `add column ... not null` with constant default (PG 11+) | instant | Safe | Default fills virtually; combine with `not null` is fine |
| `add column ... not null` with no default on a non-empty table | fails | n/a | Add nullable, backfill, then `not null` via check constraint (below) |
| `alter column set not null` | full scan holding lock | Careful | `add constraint c check (col is not null) not valid` (instant) → `validate constraint c` (SHARE UPDATE EXCLUSIVE, allows writes) → `alter column set not null` (PG 12+ uses the validated check to skip the scan) → `drop constraint c` |
| `add foreign key` | scans referencing table under lock on both | Careful | `add constraint ... foreign key ... not valid` then `validate constraint` in a separate transaction |
| `add check constraint` | scan under lock | Careful | `not valid` then `validate` |
| `add unique constraint` | builds index under lock | Careful | `create unique index concurrently` then `alter table add constraint ... unique using index idx` (instant) |
| `add primary key` | builds index under lock | Careful | Same: unique index concurrently, then `add constraint pk primary key using index` |
| `create index` (non-concurrent) | SHARE lock: blocks writes for the build | Unsafe on live tables | `concurrently`; handle `INVALID` on failure |
| `drop index` | brief exclusive | Careful | `drop index concurrently` |
| `drop column` | instant (marks dropped; space reclaimed later) | Careful | Only after no code references it; app rollback cannot bring it back |
| `drop table` | instant | Careful | Same; consider renaming to `_old_<date>` first and dropping a week later |
| `rename column` / `rename table` | instant | Unsafe for running apps | Expand/contract; or a view with the old name |
| `alter column type` (e.g. `int` → `bigint`, `varchar(50)` → `varchar(100)`) | full rewrite, except binary-compatible changes (`varchar(n)` to larger `n` or `text` is instant; `int`→`bigint` is a rewrite) | Unsafe | New column + backfill + swap, or for `int`→`bigint` on a PK the full dance (new column, trigger to sync, backfill, swap constraints) |
| `set default` / `drop default` | instant | Safe | |
| `add column` to a table with triggers/RLS | instant | Safe | Check policies still make sense |
| `alter type ... add value` (enum) | instant, cannot be in a transaction before PG 12 | Safe-ish | Cannot remove values; see `integrity-and-constraints.md` |
| `truncate` | exclusive; fast | Careful | Blocks everything briefly; never in a prod migration without intent |
| `vacuum full`, `cluster`, `reindex` (non-concurrent) | exclusive for the duration | Unsafe | `pg_repack`, `reindex concurrently` |
| Large `update`/`delete` in a migration | row locks + WAL + replication lag | Unsafe | Batches, out of band (section 5) |
| `set statement_timeout`/`lock_timeout` in the migration | n/a | Required | Do it |

MySQL: same table with `ALGORITHM` in mind. Add column at end: `INSTANT`
(8.0.12+). Add index: `INPLACE, LOCK=NONE`. Change type, add FK with
checks: `COPY` → use `gh-ost`/`pt-osc`. Rename column: `INSTANT` (8.0.28+)
but the running-app problem is identical. Add `NOT NULL` to an existing
column: `INPLACE` with a full read; OK on moderate tables, `gh-ost` on
huge ones.

SQLite: anything beyond add/rename/drop column is a table rebuild inside a
transaction; fine for the typical SQLite deployment with a brief pause.

## 4. Recipes

### Add a NOT NULL column with a backfilled value (Postgres)

```sql
-- migration 1 (expand)
alter table users add column locale text;                       -- instant
-- deploy: app writes locale on create/update, reads with fallback 'en'

-- backfill (out of band, batched; section 5)

-- migration 2 (constrain)
set lock_timeout = '5s';
alter table users add constraint users_locale_not_null check (locale is not null) not valid;  -- instant
alter table users validate constraint users_locale_not_null;    -- scans without blocking writes
alter table users alter column locale set not null;             -- PG 12+: instant, uses the validated check
alter table users drop constraint users_locale_not_null;
alter table users alter column locale set default 'en';
```

### Add a foreign key to a large table

```sql
create index concurrently orders_customer_id_idx on orders (customer_id);   -- first, or the validate scans without it
alter table orders add constraint orders_customer_fk
  foreign key (customer_id) references customers (id) not valid;             -- instant; enforces new rows
alter table orders validate constraint orders_customer_fk;                   -- separate transaction; SHARE UPDATE EXCLUSIVE
```

Before validating, find orphans: `select count(*) from orders o where not
exists (select 1 from customers c where c.id = o.customer_id)`; fix or
`set null` them, or the validate fails.

### int → bigint primary key (the big one)

```sql
-- 1. expand
alter table events add column id_new bigint;
create or replace function events_sync_id() returns trigger as $$
begin new.id_new := new.id; return new; end $$ language plpgsql;
create trigger events_sync_id before insert or update on events for each row execute function events_sync_id();

-- 2. backfill in batches: update events set id_new = id where id between $lo and $hi and id_new is null;

-- 3. constrain and index
alter table events add constraint events_id_new_nn check (id_new is not null) not valid;
alter table events validate constraint events_id_new_nn;
create unique index concurrently events_id_new_key on events (id_new);

-- 4. swap (brief exclusive lock; in a transaction, with lock_timeout and retry)
begin;
set lock_timeout = '5s';
alter table events drop constraint events_pkey;
alter table events add constraint events_pkey primary key using index events_id_new_key;
alter table events alter column id_new set not null;
alter table events drop column id;                 -- FKs referencing events.id must be moved first
alter table events rename column id_new to id;
alter sequence events_id_seq as bigint owned by events.id;
alter table events alter column id set default nextval('events_id_seq');
drop trigger events_sync_id on events;
commit;
```

Every foreign key referencing the old column needs its own expand/
contract. This is a multi-week project on a large system; start it when
the sequence passes 50% of `int` range, not 95%.

### Split a column, change semantics, move a column to another table

All the same: new structure, dual-write (app or trigger), backfill,
switch reads, drop old. Triggers for dual-write are useful when several
services write the table; application dual-write is clearer when one
service owns it.

### Add an index to a huge table

```sql
set maintenance_work_mem = '2GB';
set statement_timeout = 0;              -- index builds can take long; the web role's timeout would kill it
create index concurrently if not exists orders_tenant_created_idx on orders (tenant_id, created_at desc);
select indexrelid::regclass from pg_index where not indisvalid;   -- should be empty
```

Run outside the migration tool's transaction (each tool has a flag;
section 6). Consider running it from a shell with `nohup`/`screen` for
very large tables, and record the index in a migration marked as already
applied.

## 5. Backfills in batches

Rules: batch by primary key range (not `OFFSET`), small transactions
(1-10k rows), commit each, sleep between (50-500ms, longer if replicas
lag), idempotent (re-runnable from any point), observable (log progress),
and throttled by replication lag or load if you can measure it. Keep
backfills out of the schema migration files when the tool runs
migrations inside a single transaction or at deploy time; run them as a
script, a one-off job, or a data migration the tool runs outside a
transaction.

Postgres, plain SQL loop in a script (psql `\gexec` or any language):

```sql
-- find bounds once
select min(id), max(id) from users;
```

```python
# Python/psycopg, re-runnable, keyed by id range
import time, psycopg
BATCH, SLEEP = 5000, 0.1
with psycopg.connect(DSN, autocommit=True) as conn:
    lo, hi = conn.execute("select min(id), max(id) from users").fetchone()
    cur = lo
    while cur <= hi:
        n = conn.execute(
            "update users set locale = coalesce(locale, 'en') "
            "where id >= %s and id < %s and locale is null",
            (cur, cur + BATCH),
        ).rowcount
        print(f"{cur}/{hi} updated {n}", flush=True)
        cur += BATCH
        time.sleep(SLEEP)
```

Node (any driver), the same shape:

```ts
let cur = min;
while (cur <= max) {
  const { rowCount } = await sql`
    update users set locale = coalesce(locale, 'en')
    where id >= ${cur} and id < ${cur + BATCH} and locale is null`;
  console.log(cur, rowCount);
  cur += BATCH;
  await new Promise(r => setTimeout(r, 100));
}
```

Rails (`in_batches`), Django (`iterator()` with `chunk_size` plus
`bulk_update`, or `django-pg-bulk-update`; or raw SQL in a `RunPython` that
commits per batch with `atomic=False` on the migration), Ecto
(`Repo.stream` or id-range loop), Laravel (`chunkById`). Django's
`RunPython` runs inside the migration transaction by default; set
`atomic = False` on the migration class for large backfills.

Keyset by `id` assumes a dense-ish integer id. For UUID keys, page by
`(created_at, id)` or use `ctid` ranges on Postgres for a one-off.

Monitor during the backfill: replication lag (`select now() -
pg_last_xact_replay_timestamp()` on the replica), `n_dead_tup` on the
table, and the app's latency. Pause on anomalies; because it is
idempotent and keyed, resuming is a restart.

## 6. Tooling per ecosystem

Use what the repo uses. Each row: how to run, where the gotchas are, how
to do a non-transactional step (concurrent index).

| Tool | Commands | Notes |
|---|---|---|
| **Prisma Migrate** | `prisma migrate dev --name x` (dev; generates SQL from schema diff), `prisma migrate deploy` (prod), `prisma migrate diff`, `prisma migrate resolve --applied/--rolled-back` | Edit the generated `migration.sql` before committing when the diff is unsafe (it generates `ALTER COLUMN ... SET NOT NULL`, non-concurrent `CREATE INDEX`, and `DROP`+`ADD` for renames unless you edit). Prisma runs each migration file inside a transaction on Postgres, and `CREATE INDEX CONCURRENTLY` cannot run inside one; the reliable path is to run the concurrent index by hand (psql or a script) against each environment, then record it with an empty-bodied migration marked `migrate resolve --applied`, or to accept the non-concurrent index on small tables and say so. No `down` migrations; roll forward. `prisma db push` is for prototyping only. Shadow database required for `migrate dev` |
| **Drizzle Kit** | `drizzle-kit generate` (SQL from schema TS), `drizzle-kit migrate`, `drizzle-kit push` (dev only), `drizzle-kit check` | Generated SQL is editable; add `--> statement-breakpoint` between statements. Supports a `custom` migration (`drizzle-kit generate --custom`) for hand SQL. No built-in `down`. For concurrent indexes, mark the index `.concurrently()` in schema (pg) and ensure the migrator does not wrap it (the default migrator runs each file in a transaction; put it in its own file and run it manually if needed) |
| **Knex** | `knex migrate:make`, `migrate:latest`, `migrate:rollback`, `migrate:up/down` | `exports.config = { transaction: false }` per migration for concurrent indexes; has real `down` |
| **Kysely** | `Migrator` with up/down functions in TS files | You write SQL via the builder or `sql` tag; transactions per migration configurable |
| **TypeORM** | `typeorm migration:generate`, `migration:run`, `migration:revert` | Generated diffs are often wrong on renames and defaults; review every line. `transaction: "none"` option per migration for concurrent indexes. Never `synchronize: true` outside local dev |
| **Sequelize CLI / Umzug** | `sequelize db:migrate`, `db:migrate:undo` | Hand-written up/down; `queryInterface.addIndex` with `concurrently: true` |
| **Alembic** (SQLAlchemy) | `alembic revision --autogenerate -m x`, `alembic upgrade head`, `alembic downgrade -1`, `alembic history` | Autogenerate misses renames (sees drop+add), server defaults, some constraints; review. `op.create_index(..., postgresql_concurrently=True)` inside `with op.get_context().autocommit_block():`. `render_as_batch=True` for SQLite table rebuilds. Branches/merges when two devs create revisions in parallel: `alembic merge` |
| **Django migrations** | `makemigrations`, `migrate`, `sqlmigrate app 0007` (print SQL), `showmigrations`, `squashmigrations` | `atomic = False` on the Migration class for concurrent indexes (`AddIndexConcurrently` from `django.contrib.postgres.operations`) and big `RunPython`. Renames: Django asks "did you rename?"; answer honestly. `db_index=True` on a field creates a non-concurrent index. `django-pg-zero-downtime-migrations` rewrites unsafe ops. Separate schema and data migrations; `RunPython` with `reverse_code` |
| **Rails / ActiveRecord** | `rails g migration AddLocaleToUsers locale:string`, `rails db:migrate`, `db:rollback`, `db:migrate:status`, `db:schema:dump` | `disable_ddl_transaction!` + `add_index ..., algorithm: :concurrently`; `add_check_constraint ..., validate: false` then `validate_check_constraint`; `add_foreign_key ..., validate: false`; `add_column` with default on large tables is safe on PG 11+. Use the `strong_migrations` gem; it blocks unsafe ops and tells you the safe form. `db/schema.rb` vs `db/structure.sql` (use structure for Postgres-specific features). Data migrations via `data_migrate` gem or rake tasks, not in schema migrations |
| **Ecto** | `mix ecto.gen.migration x`, `mix ecto.migrate`, `mix ecto.rollback`, `mix ecto.migrations` | `@disable_ddl_transaction true` and `@disable_migration_lock true` for `create index(..., concurrently: true)`; `execute/2` with up and down SQL; `flush()` to run accumulated commands before data ops |
| **Flyway** | `flyway migrate`, `flyway info`, `flyway validate`, `flyway repair`; `V1__desc.sql`, `U1__desc.sql` (undo, paid), `R__view.sql` repeatable | Plain SQL, versioned by filename; checksums enforce immutability (never edit an applied migration; add a new one). `-- flyway:executeInTransaction=false` header in the script for concurrent indexes. Java-based migrations for logic. Baseline for existing DBs |
| **Liquibase** | `liquibase update`, `rollback`, `status`; changelogs in XML/YAML/SQL | Changesets with `runInTransaction="false"` for concurrent indexes; rollback blocks per changeset; `preConditions` for idempotency; heavier than Flyway, more portable across engines |
| **golang-migrate** | `migrate -path migrations -database $URL up`, `down 1`, `force N`; files `000001_name.up.sql`/`.down.sql` | Each file runs as one multi-statement exec; Postgres driver option `x-multi-statement`; no transaction wrapping by default on pg (statements run as sent; wrap in `BEGIN/COMMIT` yourself when you want atomicity). `force` fixes a dirty state after a failed run |
| **goose** | `goose up`, `goose down`, `goose status`; `-- +goose Up`/`-- +goose Down` markers, `-- +goose NO TRANSACTION` | Go or SQL migrations; the `NO TRANSACTION` annotation is for concurrent indexes |
| **Atlas** | `atlas migrate diff` (declarative HCL/SQL schema → versioned migrations), `atlas migrate apply`, `atlas migrate lint` (flags unsafe ops), `atlas schema apply` (declarative) | Lint analyzers for destructive changes, non-concurrent indexes, backward incompatibility; integrates with GORM, Ent, Sequelize, TypeORM, Prisma schemas as sources |
| **dbmate** | `dbmate up`, `down`, `new`; SQL with `-- migrate:up`/`-- migrate:down`, `transaction:false` option | Minimal, language-agnostic |
| **sqitch** | `sqitch deploy/revert/verify` | Dependency-ordered plan, verify scripts |
| **Supabase CLI** | `supabase migration new x`, `supabase db push`, `supabase db diff`, `supabase db reset` (local) | Plain SQL in `supabase/migrations/`; same Postgres rules; remember RLS policies are schema and belong in migrations |
| **GORM AutoMigrate** | `db.AutoMigrate(&User{})` | Adds columns/indexes, never drops or alters types; not a migration system. Pair with Atlas or golang-migrate for production |
| **Hibernate `hbm2ddl.auto`** | `update`/`create` | Dev only; production uses Flyway/Liquibase |
| **EF Core** | `dotnet ef migrations add X`, `database update`, `migrations script --idempotent` | Generate the SQL script for review and apply it via pipeline; `migrationBuilder.Sql()` for hand SQL; transactions per migration (`suppressTransaction: true` on `Sql()` for concurrent indexes) |
| **Laravel** | `php artisan make:migration`, `migrate`, `migrate:rollback`, `migrate:status`, `schema:dump` | `public $withinTransaction = false;` on the migration for concurrent indexes; `DB::statement()` for raw SQL; `doctrine/dbal` was needed for column changes before Laravel 11 |
| **Room (Android)** | `Migration(from, to)` objects with SQL; `autoMigrations` with specs | SQLite rules; test with `MigrationTestHelper` and exported schemas |

Universal rules regardless of tool:

- Never edit a migration that has run anywhere but your machine. Add a
  new one.
- One logical change per migration file; schema and data separate.
- Migrations are code: reviewed, in version control, run by CI against a
  scratch database on every PR (up, and down where it exists).
- The migration runner uses a role with a long `statement_timeout` and a
  short `lock_timeout`; the app role has the opposite.
- Lock the migration runner so two deploys cannot migrate concurrently
  (most tools take an advisory lock; verify for yours).

## 7. Rollback reality

- `down` migrations are useful locally and in CI; in production they are
  rarely run and often untested. Prefer **roll forward**: a new migration
  that fixes the problem.
- Physically irreversible: `drop column`, `drop table`, lossy type changes,
  `delete`/`update` of data without a backup copy. A `down` that
  recreates the column recreates it empty. Say so in the PR.
- Reversible by design: additive migrations under expand/contract. If
  the app is rolled back after "expand", the extra column is harmless.
  This is the real rollback strategy: design each deploy so the previous
  app version works against the new schema.
- Dangerous `down`: `drop index` as the down of `create index` on a hot
  table turns a rollback into an outage. Consider leaving it.
- For destructive steps, stage them: rename to `_old`/move to an archive
  table, deploy, wait a week, drop. Or take a table-level backup (`create
  table users_bak_20260304 as select ...`, or `pg_dump -t`) immediately
  before.
- Point-in-time recovery (`scaling-and-operations.md`) is the rollback
  of last resort for data loss, and it loses everything written since
  the point. Restoring to a side instance and copying back the affected
  rows is the realistic version.

## 8. Migration PR review checklist

For each migration, answer in the PR description or be able to:

- What lock does each statement take, and for how long at production
  volume? (Instant metadata? Full scan? Rewrite?) Any `ACCESS EXCLUSIVE`
  held beyond a blink on a hot table?
- Is `lock_timeout` set and is there a retry?
- Are indexes created `CONCURRENTLY` (or `INPLACE, LOCK=NONE`), outside a
  transaction, with `IF NOT EXISTS`, and is the invalid-index case handled?
- Is any `NOT NULL`, FK, CHECK or UNIQUE added via the non-blocking
  two-step?
- Is any column or table renamed or dropped while running code may still
  reference it? Is this an expand step, a contract step, or a
  single-step change justified by table size and deploy model?
- Does the previous application version work against the new schema
  (rollback safety)? Does the new application version work against the
  old schema (for rolling deploys)?
- Is there a backfill? Is it batched, idempotent, separate from the
  schema migration, throttled, and do we know its runtime at production
  volume?
- Are new columns typed correctly (money, time, text, ids) and do they
  follow the repo's naming?
- Does every new FK column have an index? Does every new index earn its
  write cost (which query)?
- Is `down` real, or is irreversibility stated?
- Was it run up and down on a scratch database in CI? Was it timed at
  realistic volume for anything touching a large table?
- Is any data destroyed, and is there a backup or a staged drop?
- Any engine-specific trap: volatile default rewrite (PG), `COPY`
  algorithm (MySQL), enum value removal, partition key in unique
  constraints, RLS policy for a new tenant table, `search_path` for
  schema-per-tenant?

## 9. Process: how migrations should flow

1. Developer writes the migration with the tool, reviews the generated
   SQL line by line (`prisma migrate diff`, `alembic upgrade --sql`,
   `rails db:migrate` then read `structure.sql` diff, `sqlmigrate`,
   `atlas migrate lint`).
2. CI spins the production engine version, runs all migrations from
   empty, runs the test suite, runs `down` for the new migration where
   supported, and runs a linter (`strong_migrations`, `atlas migrate
   lint`, `squawk` for raw Postgres SQL, `django-migration-linter`).
3. Deploy applies migrations before or alongside the app in a step that
   is separate from app startup (a job, not every pod racing to migrate),
   with the migration role's timeouts.
4. Backfills run as jobs after deploy, monitored.
5. Contract migrations ship in a later release once metrics show no
   references to the old structure (`pg_stat_statements` normalized
   queries mentioning the old column should be zero).
