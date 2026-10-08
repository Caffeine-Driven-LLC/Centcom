# Data modeling

How to go from requirements to a schema that will still be right in five
years: a modeling method, normalization with intent, the key debate (serial
vs UUIDv4 vs UUIDv7/ULID) settled with reasons, relationships, polymorphism,
hierarchies, soft delete alternatives, history tables, multi-tenancy, and
type choices for money, time and text. SQL is Postgres unless marked.

## Contents

1. Method: from requirements to tables
2. Normalization with intent, denormalization with a reason
3. Choosing primary keys
4. Relationships and join tables
5. Polymorphic associations
6. Hierarchies and trees
7. Soft delete and its alternatives
8. Audit columns and history tables
9. Multi-tenancy models
10. Type choices: money, time, text, identifiers, booleans
11. Naming and schema conventions
12. Data privacy basics in the schema

## 1. Method: from requirements to tables

Work in this order; each step is short but skipping one shows up as a
migration later.

1. **Nouns and identity.** List the entities. For each, ask "what makes two
   of these the same thing?" That is the natural key, even if you give it a
   surrogate. A `user` is identified by a verified email (or by an external
   IdP subject). An `order_line` is identified by `(order_id, product_id)`
   or by position. If you cannot answer, you do not understand the entity
   yet.
2. **Relationships and cardinality.** For each pair that relates: one-to-one,
   one-to-many, many-to-many, optional or mandatory on each side. Ask the
   awkward questions now: can a user belong to two organizations? Can an
   order have zero lines while it is a draft? Can a product belong to no
   category? The answers become `NOT NULL`, foreign keys, join tables.
3. **Invariants.** Sentences with "always" or "never": a seat is never sold
   twice; the sum of ledger entries for a transaction is always zero; an
   invoice number is always unique per tenant per year. Each becomes a
   constraint (unique, check, exclusion) or, when it spans rows, a
   transaction design.
4. **Lifecycle.** How is each entity created, changed, ended? Does "ended"
   mean deleted, archived, anonymized? For how long is it retained? Who may
   see it after? This decides soft delete vs archive vs hard delete, and
   history tables.
5. **Access patterns.** The ten most frequent reads and writes with rough
   volumes: "list the current user's orders, newest first, 20 at a time,
   100 req/s"; "insert an event, 2k/s, never updated"; "monthly report
   grouping by region". Indexes and denormalization come from this list,
   not from imagination.
6. **Draw it** (in text is fine): tables, keys, FKs with cardinality. Walk
   each access pattern through the drawing and note the joins and the
   filter columns. Where a pattern needs five joins and a group by on the
   hot path, that is where you consider a denormalized column or a
   materialized view, deliberately.

## 2. Normalization with intent, denormalization with a reason

Normalization is not an academic exercise; it is "every fact is stored once,
so it cannot disagree with itself." Aim for third normal form by default:

- Every column depends on the key (no `order_lines.customer_name`; that
  belongs on `customers` and is reachable via `orders`).
- No repeating groups (`phone1, phone2, phone3` becomes a `phones` table or
  an array if truly unqueried).
- No derived data stored unless deliberately cached (see below).

Denormalize when a *measured or clearly predictable* read pattern needs it,
and write down the sync mechanism:

| Denormalization | When | Kept in sync by |
|---|---|---|
| `orders.total_cents` | Totals shown in every list; recomputing joins lines on every list page | Application code in the same transaction as line changes, or a trigger; verified by a periodic reconciliation query |
| `posts.comment_count` | Counter shown everywhere; `COUNT(*)` per row is a join per row | Counter cache (Rails `counter_cache`, Django `F() + 1`), accepting occasional drift and a repair job |
| `users.organization_name` copied onto an event row | Event log must show the name *at the time*, not the current one | Nothing; it is intentionally a snapshot. Say so in a column comment |
| Materialized view of a dashboard aggregate | Expensive aggregation read often, tolerates staleness | `REFRESH MATERIALIZED VIEW CONCURRENTLY` on a schedule |
| Search document (name + tags + description in one `tsvector`) | Full-text search across fields | Generated column (`GENERATED ALWAYS AS ... STORED`) |

A denormalized column without a stated sync mechanism is a bug with a
delay. A snapshot column (price at time of order) is not denormalization;
it is correct modeling of a historical fact, and the "normalized" version
(joining to current price) is the bug.

### JSON columns: when they are fine

`jsonb` (Postgres), `JSON` (MySQL 5.7+), `TEXT` with `json_extract` (SQLite)
are fine for:

- Data you store and return but never filter, join or constrain on
  (webhook payloads, raw API responses, user preferences as a blob).
- Truly schemaless per-row attributes with one owner (plugin settings,
  product attributes in a long-tail catalog) where a key-value table would
  be worse to query.
- Append-only event payloads with a `type` column you do index.

They are the wrong tool when the app filters on `data->>'status'`, joins
on `data->>'customer_id'`, or needs a uniqueness or FK guarantee on a
field inside. Promote those to columns. The tell: if you are about to
create a GIN index on the whole document "to be safe", model the fields
instead. A middle ground is a generated column extracted from the JSON,
indexed and constrained, while the blob stays as the source:

```sql
alter table events
  add column customer_id bigint
    generated always as ((payload->>'customer_id')::bigint) stored;
create index on events (customer_id);
```

## 3. Choosing primary keys

Three realistic options; the right answer depends on who generates the ID,
whether it is exposed, and the storage engine.

### Identity / serial (`bigint generated always as identity`)

- Pros: 8 bytes, monotonic so inserts append to the right of the B-tree
  (dense pages, cache-friendly), fast joins, readable in logs.
- Cons: generated by the database so clients cannot know the ID before
  the insert returns; sequential IDs leak volume and allow enumeration if
  exposed in URLs; merging data from two databases collides.
- Use `bigint`, never `int`/`serial`; 2.1 billion arrives sooner than you
  think and the type change is one of the worst migrations there is.
- Prefer `generated always as identity` over `serial` in Postgres (SQL
  standard, owns its sequence, prevents accidental explicit inserts).

### UUIDv4 (random)

- Pros: globally unique, generated anywhere, unguessable.
- Cons: 16 bytes; fully random so every insert lands on a random B-tree
  page, which means the whole index must stay in cache to avoid random
  I/O, pages split constantly, and bloat is high. On MySQL InnoDB (where
  the PK is the clustered index) and SQL Server, random PKs physically
  scatter the rows themselves, which is markedly worse. Secondary indexes
  on InnoDB carry the 16-byte PK in every entry. Range scans "recent
  first" cannot use the PK. Sorting by ID is meaningless.
- Verdict: do not use as a primary key by reflex. If you need a random,
  public, unguessable identifier, consider a `public_id` column (UUIDv4 or
  a short random string) with a unique index, alongside an internal
  identity or UUIDv7 primary key.

### UUIDv7 / ULID (time-ordered)

- UUIDv7 (RFC 9562): 48-bit millisecond timestamp prefix, then random
  bits. ULID is the same idea with a different text encoding. Both sort
  roughly by creation time.
- Pros: client-generated, globally unique, inserts append to the right
  of the index like a serial (locality restored), "recent rows" are a
  range scan on the PK, still 122 bits of effective uniqueness. Standard
  `uuid` type in Postgres; `BINARY(16)` in MySQL.
- Cons: leaks creation time (usually acceptable, sometimes not); 16 bytes
  vs 8; slightly fewer random bits than v4 (irrelevant in practice); needs
  a generator (Postgres 18 has `uuidv7()`; earlier versions use a small SQL
  function or generate in the app; most languages have libraries).
- Verdict: the right default when IDs must be generated client-side
  (offline-first, distributed writers, idempotent create), when records
  from multiple sources merge, or when an exposed ID must not be
  sequential but you still care about index health.

Postgres function for versions before 18:

```sql
create or replace function uuid_generate_v7() returns uuid as $$
  select encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send((extract(epoch from clock_timestamp())*1000)::bigint) from 3)
              from 1 for 6),
      52, 1), 53, 1), 'hex')::uuid;
$$ language sql volatile;
```

### Decision summary

| Situation | Key |
|---|---|
| Internal table, IDs never leave the backend, single writer | `bigint identity` |
| IDs exposed in URLs/APIs and enumeration matters | `bigint identity` + `public_id` (random), or UUIDv7 PK if time leakage is fine |
| Client generates IDs (offline, idempotent create, event sourcing) | UUIDv7 / ULID |
| MySQL InnoDB with any UUID | UUIDv7 stored as `BINARY(16)`; never random v4 as PK |
| Join / link tables | Composite PK `(a_id, b_id)`; no surrogate unless the row has its own identity and is referenced elsewhere |
| Natural key is short, stable and truly unique (ISO country code, currency) | Use it as the PK |
| Repo already uses UUIDv4 everywhere | Match it; propose v7 for new high-volume tables with a note; do not mix styles within one table's references |

Natural keys as PKs are fine when they are immutable; an email is not
immutable, a country code is. When in doubt, surrogate PK plus a unique
constraint on the natural key.

## 4. Relationships and join tables

```sql
-- one-to-many: FK on the many side, indexed, ON DELETE chosen on purpose
create table orders (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references customers(id) on delete restrict,
  status      text   not null check (status in ('draft','placed','paid','shipped','cancelled')),
  created_at  timestamptz not null default now()
);
create index on orders (customer_id, created_at desc);

-- many-to-many: join table with composite PK and the reverse index
create table project_members (
  project_id bigint not null references projects(id) on delete cascade,
  user_id    bigint not null references users(id)    on delete cascade,
  role       text   not null check (role in ('owner','editor','viewer')),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on project_members (user_id);   -- "projects for this user"

-- one-to-one: FK that is also unique; or just put the columns on the parent
create table user_profiles (
  user_id bigint primary key references users(id) on delete cascade,
  bio     text,
  avatar_url text
);
```

Points that matter:

- **Index every foreign key column** (Postgres does not do it for you;
  MySQL does). Without it, deleting a parent scans the child table, and
  the join from the parent side is a seq scan.
- **Choose `ON DELETE` explicitly.** `cascade` for owned children
  (lines of an order, members of a project), `restrict`/`no action` for
  referenced things that must not vanish (customer of an order), `set
  null` for optional references (assignee of a ticket). The default `no
  action` is a fine choice when you mean it; it is a bad choice by
  omission.
- **A join table gets a composite PK**, with the column that is most often
  the lookup key first, and a second index on the other column. Add a
  surrogate ID only if other tables need to reference the membership.
- **One-to-one is usually a smell** unless splitting for access control,
  very wide optional columns, or a different lifecycle.

## 5. Polymorphic associations

"A comment can belong to a post or a photo." Four options, in order of
preference:

1. **Separate tables per target** (`post_comments`, `photo_comments`). Real
   FKs, simplest queries. Pick when targets are few and stable.
2. **Exclusive-arc nullable FKs** on one table:
   ```sql
   create table comments (
     id        bigint generated always as identity primary key,
     post_id   bigint references posts(id)  on delete cascade,
     photo_id  bigint references photos(id) on delete cascade,
     body      text not null,
     check (num_nonnulls(post_id, photo_id) = 1)
   );
   ```
   Real FKs, one table, a check ensuring exactly one target. Scales to a
   handful of targets.
3. **Supertype table**: `commentables(id)` that both `posts` and `photos`
   reference as their PK (shared ID space); `comments.commentable_id`
   references `commentables`. Real FKs, any number of subtypes, one extra
   insert per subtype row.
4. **`(target_type, target_id)` pair with no FK** (Rails `polymorphic:
   true`, Django `GenericForeignKey`). Flexible and integrity-free: no FK,
   orphans possible, joins need a `CASE`. Accept it only when the ORM
   convention is already established in the repo, and add an index on
   `(target_type, target_id)`.

## 6. Hierarchies and trees

| Pattern | Read subtree | Read ancestors | Move subtree | Insert | Fits |
|---|---|---|---|---|---|
| Adjacency list (`parent_id`) + recursive CTE | Recursive query (fine to ~depth 20 and 100k nodes) | Recursive | One update | Trivial | Default; comments, org charts, categories |
| Materialized path (`path text` like `1/4/9/`) | `WHERE path LIKE '1/4/%'` with a `text_pattern_ops` index | Split the path | Rewrite paths of all descendants | Compute path | Read-heavy, rarely moved; breadcrumbs |
| Closure table (`ancestor_id, descendant_id, depth`) | One join | One join | Delete and reinsert closure rows | Insert `depth+1` rows | Heavy ancestor/descendant queries, moderate writes |
| Postgres `ltree` | `path <@ '1.4'` with a GIST index | `@>` | Update with `subpath` | Compute | Postgres-only; the best materialized path |
| Nested sets (`lft, rgt`) | Range query | Range query | Renumber half the table | Renumber | Legacy; avoid for new work |

Recursive CTE over an adjacency list:

```sql
with recursive tree as (
  select id, parent_id, name, 0 as depth, array[id] as path
  from categories where id = $1
  union all
  select c.id, c.parent_id, c.name, t.depth + 1, t.path || c.id
  from categories c join tree t on c.parent_id = t.id
  where not c.id = any(t.path)          -- cycle guard
)
select * from tree order by path;
```

Add `create index on categories (parent_id)`. Prevent cycles with a trigger
or the `path` guard; a `check` constraint cannot see other rows.

## 7. Soft delete and its alternatives

`deleted_at timestamptz` is popular because it is easy to add and
reversible. Its costs: every query in the system must remember `WHERE
deleted_at IS NULL` (ORM default scopes help and also hide bugs), unique
constraints must become partial (`unique (email) where deleted_at is
null`), FKs to a soft-deleted row still "work", reports include ghosts,
and GDPR erasure is not satisfied by a flag.

Alternatives, pick per table:

- **Hard delete + audit log.** Delete the row; the `audit_log` (or the
  history table below) records what was deleted and by whom. Right for
  most operational data where "undo" is rare.
- **Archive table.** `orders_archive` with the same columns; move rows
  with `with d as (delete from orders where ... returning *) insert into
  orders_archive select * from d;`. Live tables stay small; archived data
  is queryable; constraints on the live table stay simple.
- **Status column that means something.** `status = 'cancelled'` is not a
  soft delete; it is domain state and belongs in the model.
- **Soft delete done properly**, when restore-by-user is a feature (trash
  bin): `deleted_at` plus partial unique indexes, a view `active_things`
  that the app reads from, a partial index `where deleted_at is null` on
  hot paths, and a scheduled purge that hard-deletes after N days.

Whatever you choose, document it in the table comment and make the ORM
scope explicit, not magical.

## 8. Audit columns and history tables

Baseline for nearly every table:

```sql
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()   -- maintained by app or trigger
```

Add `created_by`/`updated_by` (FK to users, or a text actor identifier for
system processes) when the domain cares who did it. Postgres does not
update `updated_at` for you; use the ORM (most do) or a trigger:

```sql
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
create trigger trg_updated_at before update on orders
  for each row execute function set_updated_at();
```

When you need "what did this row look like on March 3rd" or "who changed
the price", a history table beats soft delete and beats `jsonb` diffs
stuffed into a log:

```sql
create table products_history (
  history_id  bigint generated always as identity primary key,
  product_id  bigint not null,
  valid_from  timestamptz not null,
  valid_to    timestamptz,                  -- null = current
  changed_by  bigint,
  op          char(1) not null check (op in ('I','U','D')),
  -- snapshot of the row
  name        text not null,
  price_cents bigint not null
);
create index on products_history (product_id, valid_from desc);
```

Populate from a trigger (`AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW`
inserting `OLD`/`NEW`) or from application code in the same transaction.
Extensions like `temporal_tables` or `periods` automate this on Postgres.
For "who did what" across many tables, a single `audit_log(actor_id,
table_name, row_pk, op, before jsonb, after jsonb, at)` is acceptable
because it is never joined, only read by key or time.

## 9. Multi-tenancy models

| Model | Isolation | Ops cost | Noisy neighbor | Per-tenant customization | Fits |
|---|---|---|---|---|---|
| Shared schema, `tenant_id` column (+ RLS) | Logical; one bug away unless RLS enforces | Lowest: one DB, one migration | Shared | Hard | SaaS with many small tenants (hundreds to millions) |
| Schema per tenant (Postgres schemas, `search_path`) | Stronger; still one DB | Migrations run N times; catalog bloat past a few thousand schemas | Shared | Possible | Dozens to low thousands of mid-size tenants |
| Database per tenant | Strongest; separate backups and restores | Highest: N connection pools, N migrations, N monitoring targets | Isolated | Full | Few large enterprise tenants, regulated data, residency requirements |

Shared schema is the default. Make it safe:

- `tenant_id` on every tenant-owned table, `not null`, FK to `tenants`.
- `tenant_id` **first** in composite primary keys, unique constraints and
  indexes (`unique (tenant_id, slug)`, `index (tenant_id, created_at
  desc)`); almost every query filters by tenant, so this gives locality and
  lets the planner prune.
- Composite FKs across tenant-owned tables where cross-tenant references
  would be a security bug: `foreign key (tenant_id, project_id) references
  projects (tenant_id, id)`; this makes a cross-tenant link impossible, not
  merely unlikely.
- **Row-level security** as the enforcement layer rather than trusting every
  query to include the predicate. See `postgres.md` for the full setup; the
  shape is `set local app.tenant_id = '...'` at the start of each
  transaction and a policy `using (tenant_id = current_setting('app.tenant_id')::bigint)`.
  Behind a pooler in transaction mode, use `set local` and never `set`.
- Partition by tenant only when a few tenants dominate; hash partitioning
  across many tenants rarely helps and complicates everything.

Schema-per-tenant works well with Rails `apartment`-style gems or Django
`django-tenants`, until it does not: migration time scales linearly, `pg_dump`
of thousands of schemas is slow, and connection poolers that pin
`search_path` are a trap in transaction mode.

## 10. Type choices

### Money

Never float. Two good options:

- **Integer minor units**: `amount_cents bigint not null` plus `currency
  char(3) not null`. Exact, fast, obvious. Sub-cent precision (FX rates,
  per-unit prices like $0.0012) needs the other option.
- **`numeric(19,4)`** (or wider scale when needed) plus `currency`. Exact,
  handles fractional units, slower arithmetic (irrelevant for most apps).

Store the currency next to the amount; a column named `amount` with no
currency is a bug waiting for the first non-USD customer. Round in one
place in the application using banker's or half-up rounding as the domain
specifies, and store the rounded result. MySQL: `DECIMAL(19,4)`. SQLite has
no decimal type: store integer cents.

### Time

- **Instants** (when something happened): `timestamptz` in Postgres. It
  stores UTC and converts on display; `timestamp` (without time zone)
  stores a wall-clock reading with no zone and is wrong for instants. In
  MySQL use `DATETIME(6)` and store UTC by convention (`TIMESTAMP` has the
  2038 limit and session-zone conversion surprises); set the connection
  time zone to UTC. SQLite: ISO-8601 text in UTC (`2026-03-04T10:15:00Z`)
  or integer epoch milliseconds.
- **Calendar dates** (birthday, invoice date, due date): `date`. Not a
  timestamp at midnight; midnight in which zone?
- **Future local events** (a meeting at 9am in Berlin next year): store
  the local wall time *and* the IANA zone name (`starts_at_local
  timestamp, tz text`), because zone rules change; compute the instant when
  needed. This is the one legitimate use of `timestamp` without zone.
- **Durations**: `interval` (Postgres) or integer seconds/milliseconds.
- **Ranges** (bookings, validity): Postgres `tstzrange` with an exclusion
  constraint to prevent overlap (see `integrity-and-constraints.md`).
- Default timestamps with `default now()`; `now()` is the transaction
  start time, which is what you want. Use `clock_timestamp()` only for
  measuring inside a transaction.

### Text

- Postgres: `text` everywhere, with `check (length(name) <= 200)` when a
  limit matters. `varchar(n)` buys nothing but a harder-to-change limit.
  MySQL: `VARCHAR(n)` with a real `n` (it affects index key length and
  temp table memory), `TEXT` for long content, `utf8mb4` always.
- Case-insensitive uniqueness (emails, usernames): `citext` extension, or
  a unique index on `lower(email)`, or Postgres 15+ nondeterministic
  collations. Do not rely on the app lowercasing.
- Store the user's input as given; normalize (NFC, trimmed) once at the
  boundary; never strip beyond what the domain says.
- Enumerated values: `text` + `check (status in (...))` by default, lookup
  table when values carry attributes or are user-managed, native `enum`
  only for truly fixed sets (see `integrity-and-constraints.md`).

### Identifiers from outside

Stripe IDs, external order numbers, IdP subjects: `text` with a unique
index, never parsed into integers. Keep the provider in a sibling column
when more than one provider is possible.

### Booleans

`boolean not null default false`. A nullable boolean is a three-state
enum in disguise; if you need three states, name them.

### Arrays and sets

Postgres arrays (`tags text[]`) are fine for small, owner-scoped,
unqueried-by-join lists; index with GIN if filtered by containment. A set
that other tables reference or that needs per-element attributes is a
table.

## 11. Naming and schema conventions

Match the repo. When greenfield:

- `snake_case` for everything in SQL; the ORM maps to the language's case.
- Tables plural (`orders`) or singular (`order`): both are defensible;
  Rails/Django default to plural, Prisma/Drizzle leave it to you. Pick one
  and never mix.
- Primary key `id`; foreign keys `<singular>_id` (`customer_id`); join
  tables `<a>_<b>` alphabetically or by the domain term (`memberships`).
- Booleans read as predicates: `is_active`, `has_paid`, or simply `active`
  if the repo does that. Timestamps end in `_at`; dates in `_on` or
  `_date`.
- Indexes named by convention `<table>_<cols>_idx`, unique `_key`, checks
  `<table>_<rule>_check`; Postgres generates these shapes if you do not
  name them, which is acceptable.
- Column comments (`comment on column orders.total_cents is 'cached sum of
  lines; maintained by trg_order_total'`) are cheap and show up in every
  tool.
- Avoid reserved words (`user`, `order`, `group` need quoting in several
  engines; `users`, `orders`, `groups` do not).

## 12. Data privacy basics in the schema

- Tag PII columns in comments or a data dictionary (`comment on column
  users.email is 'PII'`); it makes erasure and export scripts
  mechanical.
- Separate rarely needed sensitive data (government IDs, full card data
  which you should not store, health details) into its own table with
  tighter grants and optional column-level encryption (`pgcrypto`
  `pgp_sym_encrypt`, or application-side encryption with a KMS-managed key
  and a key ID column so rotation is possible). Encrypted columns cannot be
  indexed or searched; keep a blind index (HMAC of the normalized value)
  if you need equality lookup.
- Plan deletion from day one: user erasure means deleting or anonymizing
  across every table with a `user_id`; FKs with `on delete cascade` or
  `set null` chosen for that purpose make it a single statement. Backups
  will still hold the data until they expire; state your backup retention
  in the privacy notice.
- Retention: tables of events, logs and sessions get a `created_at` index
  (or partitioning by month) and a scheduled purge; writing the purge job
  is part of creating the table.
- Encryption at rest is a hosting setting (RDS, Cloud SQL, disk
  encryption); it protects against stolen disks, not against SQL access.
  Do not describe it as protecting PII from the application.
