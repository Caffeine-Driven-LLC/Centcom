# Integrity and constraints

The database is the only component that sees every write from every code
path, every script and every future service, which makes constraints the
cheapest correctness tool you have. This file is the constraint catalogue
with syntax (Postgres, with MySQL and SQLite differences), deferred
constraints, enums versus lookup tables, triggers and when they are
acceptable, generated columns, and how to layer validation between the
application and the database.

## Contents

1. Why constraints, and the layering argument
2. NOT NULL and defaults
3. Primary and unique constraints
4. Foreign keys and referential actions
5. Check constraints
6. Exclusion constraints
7. Deferred constraints
8. Enums vs check constraints vs lookup tables
9. Generated columns
10. Triggers: acceptable uses and the cost
11. Domains and custom types
12. Adding constraints to live tables
13. Engine differences summary

## 1. Why constraints, and the layering argument

Validation belongs at every layer, but each layer does a different job:

| Layer | Job | Example |
|---|---|---|
| UI / client | Fast feedback, formatting | "Email looks invalid" before submit |
| API / application | Business rules with context, good error messages, rules that span systems | "You cannot invite more than your plan allows" |
| Database constraint | Invariants that must hold for every row no matter who wrote it | `unique (tenant_id, email)`, `check (qty > 0)`, FK |

The application layer cannot guarantee uniqueness or referential
integrity under concurrency; two requests pass the same check at the
same time. The database can, with a unique index or FK, atomically. So:
application validation for messages and context, database constraints
for truth. Catch the constraint violation (SQLSTATE `23505` unique,
`23503` FK, `23514` check, `23502` not null) in the application and
translate it to a user-facing error; most ORMs surface these as typed
exceptions (`Prisma.PrismaClientKnownRequestError` code `P2002`, Django
`IntegrityError`, Rails `RecordNotUnique`, SQLAlchemy `IntegrityError`,
Hibernate `ConstraintViolationException`, Ecto changeset `unique_constraint`
mapping).

"No foreign keys for flexibility/performance" costs: an index lookup per
insert (microseconds) is the performance cost; orphan rows, broken
joins, and a cleanup job forever is the alternative. The legitimate
exceptions: sharded systems where the parent is on another shard,
extreme ingest tables (raw events) where the referenced entity may not
exist yet and you accept it, and some managed MySQL offerings that
historically did not support FKs (PlanetScale; now optional).

## 2. NOT NULL and defaults

Every column is `NOT NULL` unless the absence of a value has a meaning
you can name. "Unknown" and "not applicable" are different meanings; if
both exist, a nullable column cannot express both.

```sql
status      text        not null default 'draft',
created_at  timestamptz not null default now(),
deleted_at  timestamptz,                         -- null means "live"; that is a meaning
```

Defaults: constants and `now()`/`gen_random_uuid()` are fine. Defaults
are applied by the database only when the insert omits the column; ORMs
that send explicit `NULL` for unset fields bypass them (check the ORM's
behavior; Prisma and Django send defaults from the model side).

Three-valued logic bites in queries: `where status <> 'paid'` excludes
NULL rows; `not in (subquery)` with any NULL returns nothing; `unique`
treats NULLs as distinct (section 3). Fewer nullable columns, fewer
surprises.

## 3. Primary and unique constraints

```sql
create table memberships (
  tenant_id bigint not null references tenants(id),
  user_id   bigint not null references users(id),
  role      text   not null,
  primary key (tenant_id, user_id)
);

alter table users add constraint users_email_key unique (email);              -- creates an index; takes a lock on big tables (see section 12)
create unique index concurrently users_lower_email_key on users (lower(email));  -- expression uniqueness (case-insensitive)
create unique index concurrently payment_methods_default_key on payment_methods (user_id) where is_default;  -- partial: one default per user
```

Nulls: SQL standard says NULLs are distinct in unique constraints, so
`unique (parent_id, name)` allows many rows with the same `name` and
`parent_id IS NULL`. Postgres 15: `unique nulls not distinct (parent_id,
name)`. Elsewhere: `coalesce(parent_id, 0)` in a unique expression index,
or make the column `NOT NULL` with a sentinel root.

Uniqueness across a soft-deleted table needs the partial form (`where
deleted_at is null`). Uniqueness per tenant needs the tenant in the key.
Uniqueness that is case- or whitespace-insensitive needs an expression
index or `citext`.

Postgres `unique` constraints cannot be partial or on expressions; use a
unique *index* for those (functionally the same, not referenceable by an
FK). An FK can reference any unique constraint, not only the PK.

## 4. Foreign keys and referential actions

```sql
alter table orders
  add constraint orders_customer_fk
  foreign key (customer_id) references customers (id)
  on delete restrict        -- cannot delete a customer with orders
  on update cascade;        -- rarely needed; PKs should not change

alter table order_lines
  add constraint order_lines_order_fk
  foreign key (order_id) references orders (id) on delete cascade;   -- lines die with the order

alter table tickets
  add constraint tickets_assignee_fk
  foreign key (assignee_id) references users (id) on delete set null; -- unassign when the user goes

-- composite FK to enforce same-tenant references
alter table project_members
  add constraint project_members_project_fk
  foreign key (tenant_id, project_id) references projects (tenant_id, id);
```

Actions: `no action` (default; checked at statement end, deferrable),
`restrict` (checked immediately), `cascade`, `set null`, `set default`.
Postgres 15: `on delete set null (col1)` for a subset of columns.

Rules:

- Index the referencing column (Postgres does not; MySQL does). Without
  it, `delete from customers where id = 1` scans `orders`.
- `cascade` only for true ownership. Cascading through five levels from
  `tenants` is convenient for erasure and terrifying when someone deletes
  the wrong tenant; consider `restrict` at the top and an explicit
  erasure procedure.
- FK checks take a `for key share` lock on the parent row; heavy inserts
  of children while updating the parent's key columns contend. `for no
  key update` when locking parents (see `transactions-and-concurrency.md`).
- Polymorphic references cannot have FKs (see `data-modeling.md` section
  5 for alternatives).
- Partitioned tables: FKs referencing a partitioned table are supported
  from PG 12; FKs from a partitioned table are fine.
- MySQL: FK columns must have identical types (including signedness and
  charset/collation for strings); the FK requires an index on both
  sides; `foreign_key_checks = 0` during bulk loads, then verify.
- SQLite: `PRAGMA foreign_keys = ON` per connection or FKs are decorative.

## 5. Check constraints

A boolean expression over the row (cannot reference other rows or tables,
cannot call volatile functions reliably):

```sql
alter table order_lines add constraint order_lines_qty_check check (qty > 0);
alter table products add constraint products_price_check check (price_cents >= 0);
alter table orders add constraint orders_status_check
  check (status in ('draft','placed','paid','shipped','cancelled'));
alter table events add constraint events_period_check check (ends_at > starts_at);
alter table users add constraint users_email_format_check check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
alter table comments add constraint comments_one_target_check check (num_nonnulls(post_id, photo_id) = 1);
alter table subscriptions add constraint subscriptions_trial_check
  check ((status = 'trial') = (trial_ends_at is not null));           -- conditional requirement
```

Checks pass when the expression is true *or NULL*; a check on a
nullable column does not enforce presence. Combine with `not null` where
needed.

Keep the regex ones loose (the email check above rejects obvious
garbage, not RFC 5322 edge cases). Checks are cheap to add and change
(`not valid` + `validate` on live tables; drop and re-add to change the
set of allowed values).

MySQL enforces `CHECK` from 8.0.16; MariaDB from 10.2.1; SQLite always
has. Older MySQL parses and ignores them, which has caused real incidents.

## 6. Exclusion constraints

Postgres only. Generalized uniqueness: no two rows may have overlapping
values under a given operator.

```sql
create extension if not exists btree_gist;

create table reservations (
  id       bigint generated always as identity primary key,
  room_id  bigint not null references rooms(id),
  during   tstzrange not null,
  exclude using gist (room_id with =, during with &&)
);

-- only one active price per product at any time
alter table prices add constraint prices_no_overlap
  exclude using gist (product_id with =, tstzrange(valid_from, valid_to, '[)') with &&)
  where (deleted_at is null);
```

This is the correct implementation of "no double booking", "no
overlapping shifts", "one current record per key"; application-level
checks race. Without Postgres, the pattern is a transaction with `select
... for update` on the parent row and a manual overlap check.

## 7. Deferred constraints

By default constraints are checked per statement. `deferrable initially
deferred` postpones the check to commit, which allows temporarily
inconsistent states within a transaction:

```sql
alter table employees add constraint employees_manager_fk
  foreign key (manager_id) references employees (id) deferrable initially deferred;

-- swap two unique positions without a temporary value
alter table playlist_items add constraint playlist_items_pos_key unique (playlist_id, position) deferrable initially immediate;
begin;
set constraints playlist_items_pos_key deferred;
update playlist_items set position = 2 where id = 10;   -- would collide with id 11 immediately
update playlist_items set position = 1 where id = 11;
commit;                                                 -- checked here; fine
```

Uses: circular references (insert A referencing B and B referencing A),
reordering unique positions, bulk loads where parents and children arrive
out of order. Costs: deferred unique constraints cannot be used as
`ON CONFLICT` targets and are slightly slower; errors arrive at commit
instead of at the statement, which some ORMs handle poorly. Use
`initially immediate` + `set constraints ... deferred` for the specific
transaction rather than `initially deferred` globally.

MySQL has no deferred constraints (disable `foreign_key_checks` in the
session as a blunt substitute); SQLite supports `DEFERRABLE INITIALLY
DEFERRED` for FKs.

## 8. Enums vs check constraints vs lookup tables

| Option | Change the set | Attach data to values | Sort order | Cross-DB | Verdict |
|---|---|---|---|---|---|
| Native enum (`create type`) | Add value: easy (not transactional before PG 12); remove or rename: painful (rebuild) | No | Declaration order | Postgres, MySQL inline enum (changing it rewrites on MySQL if not appended) | Fixed vocabularies with meaningful order (`'low' < 'high'`) |
| `text` + `check (col in (...))` | Drop and re-add the check (`not valid` + `validate` on big tables; cheap) | No | Alphabetical unless you add a sort column | All | Default choice for status-like columns |
| Lookup table + FK | Insert a row | Yes (label, description, sort_order, active flag, i18n) | Explicit `sort_order` | All | Values managed by users or carrying attributes; many values |
| Application-only enum (ORM `choices`) | Code change | In code | Code | All | Not integrity; fine as a complement, never alone |

The "enum baked into the schema" failure mode is a native enum (or an
ORM-level one with no DB constraint) for a workflow that grows states
every quarter. `text + check` changes with a two-statement migration;
the lookup table changes with an insert. Reserve native enums for sets
that are fixed by the domain (days of the week, ISO currency codes are a
lookup table because they carry data).

Storage: Postgres enums are 4 bytes; `text` status values of 5-10
characters are 6-11 bytes; irrelevant at any realistic scale next to the
row's other columns. Do not choose enums for size.

## 9. Generated columns

`generated always as (expr) stored` (Postgres 12+, MySQL 5.7+ with
`VIRTUAL`/`STORED`, SQLite 3.31+): a column computed from others in the
same row, kept consistent by the engine, indexable and constrainable.

```sql
alter table order_lines add column total_cents bigint
  generated always as (qty * unit_price_cents) stored;

alter table users add column email_normalized text
  generated always as (lower(trim(email))) stored;
create unique index on users (email_normalized);

alter table documents add column search tsvector
  generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) stored;
create index on documents using gin (search);

alter table events add column event_type text
  generated always as (payload->>'type') stored;
create index on events (event_type);
```

Use for: normalized duplicates for indexing, extracted JSON fields,
derived totals within a row, search vectors. Not for anything referencing
other rows (that needs a trigger or application code). Postgres supports
only `STORED` (virtual generated columns arrive in PG 18); MySQL
`VIRTUAL` costs nothing on write and computes on read, can still be
indexed.

## 10. Triggers: acceptable uses and the cost

Triggers run invisible code on every write. They are acceptable when the
logic is (a) purely about the data, (b) must apply to every writer
regardless of application, and (c) is small and side-effect free within
the database:

- Maintain `updated_at`.
- Maintain a history/audit table (`data-modeling.md` section 8).
- Maintain a denormalized counter or total in the same transaction
  (`orders.total_cents` from lines) when the application cannot be
  trusted to do it everywhere.
- Enforce cross-row invariants a check cannot express (max 5 active
  sessions per user; no cycles in a tree), when an exclusion constraint
  or unique index cannot.
- Dual-write during an expand/contract migration.
- Populate the `tenant_id` of a child from its parent.

Not acceptable: calling external services (`http` extensions), sending
notifications, business workflows ("when status becomes paid, create a
shipment"), anything that makes `INSERT` slow in ways developers cannot
see, logic that should be testable in the application.

```sql
create or replace function order_lines_total() returns trigger
language plpgsql as $$
begin
  update orders set total_cents = (
    select coalesce(sum(qty * unit_price_cents), 0) from order_lines where order_id = coalesce(new.order_id, old.order_id)
  ) where id = coalesce(new.order_id, old.order_id);
  return null;   -- AFTER trigger; return value ignored
end $$;

create trigger trg_order_lines_total
after insert or update or delete on order_lines
for each row execute function order_lines_total();
```

Costs to state in the PR: write latency (each line change re-sums the
order; fine for 10 lines, not for 10k), lock contention on the parent
row (every line insert updates `orders` → serialized per order),
invisibility (document triggers in the table comment and in the repo's
schema docs), and recursion/ordering surprises with multiple triggers.
Statement-level triggers with transition tables (`referencing new table
as`) batch the work for bulk operations. Keep trigger functions in
version control as migrations, and test them.

## 11. Domains and custom types

```sql
create domain email_address as text
  check (value ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(value) <= 254);
create domain money_cents as bigint check (value >= 0);
create domain slug as text check (value ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create table users (id bigint primary key, email email_address not null unique);
```

A domain is a reusable type-plus-check; changing the check changes it
everywhere (`alter domain ... add constraint ... not valid` then
`validate`). Composite types and arrays of domains have quirks; keep
domains scalar.

## 12. Adding constraints to live tables

See `migrations.md` section 3 for the lock profile. Summary:

- `not null`: `check (col is not null) not valid` → `validate` → `set
  not null` (PG 12+ skips the scan).
- FK and check: `... not valid` (instant, enforces new writes) →
  `validate constraint` (scan with a weak lock) in a separate transaction.
- Unique / PK: `create unique index concurrently` → `add constraint ...
  using index`.
- Exclusion: no concurrent path; build in a window, or on a new table
  via expand/contract.
- Before validating, query for violators and fix them, or the validate
  fails and you have learned something about your data.

## 13. Engine differences summary

| Feature | Postgres | MySQL 8 | SQLite |
|---|---|---|---|
| CHECK enforced | Yes | 8.0.16+ | Yes |
| Partial unique index | Yes | No (generated column trick) | Yes |
| Expression unique index | Yes | Functional index 8.0.13+ | Yes |
| Exclusion constraint | Yes | No | No |
| Deferred constraints | Yes | No | FKs only |
| FK requires index on referencing side | No (add it yourself) | Yes (auto-created) | No (add it yourself) |
| FK enforcement default | On | On (`foreign_key_checks=1`) | Off (`PRAGMA foreign_keys=ON`) |
| Native enum | `create type` | Inline `ENUM(...)` | No (use check) |
| Domains | Yes | No | No |
| Generated columns | Stored (PG 12+); virtual in PG 18 | Virtual and stored | Virtual and stored (3.31+) |
| NULLS NOT DISTINCT | PG 15+ | No | No |
| `ON DELETE SET NULL (cols)` subset | PG 15+ | No | No |
| Transactional DDL for adding constraints | Yes | No | Yes |
