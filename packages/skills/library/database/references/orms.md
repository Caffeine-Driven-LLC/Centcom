# ORMs and query builders

Per-ORM footguns and their fixes: relation loading and N+1, select-all
defaults, transactions, raw SQL escape hatches, migrations ownership, and
the moment to stop fighting the ORM and write SQL. Covers Prisma, Drizzle,
Kysely/Knex, TypeORM, SQLAlchemy 2.0, Django ORM, ActiveRecord, Ecto, GORM,
sqlc/sqlx, Hibernate/JPA and Eloquent; EF Core follows the same rules as Hibernate
(`Include`, `AsNoTracking`, `AsSplitQuery`, `FromSqlInterpolated`). SQL logging flags
per ORM are in `query-performance.md` section 9.

## Contents

1. What every ORM gets wrong by default
2. When to drop to SQL
3. Prisma
4. Drizzle
5. Kysely and Knex
6. TypeORM
7. SQLAlchemy 2.0
8. Django ORM
9. ActiveRecord
10. Ecto
11. GORM
12. sqlc, sqlx, pgx (SQL-first Go)
13. Hibernate / JPA (Spring Data)
14. Eloquent
15. Cross-ORM transaction patterns

## 1. What every ORM gets wrong by default

- **Lazy loading or per-row fetch** turns `for order in orders:
  order.customer.name` into N+1 queries. Every ORM has an eager-loading
  verb; the default is almost always lazy or per-access.
- **Select all mapped columns.** The entity has 40 columns including a
  `jsonb` blob; the list page needs 4. ORMs fetch all unless told.
- **Implicit transactions you did not choose.** Some wrap every request,
  some none, some wrap `save()` only; nested "transactions" may be
  savepoints or no-ops.
- **Schema generation that is not a migration system** (`synchronize`,
  `AutoMigrate`, `hbm2ddl.auto=update`, `db push`). Fine locally,
  catastrophic in production.
- **Types that lie**: integers that are JS `number` (53-bit) for `bigint`
  columns, `Decimal` returned as string or float, timestamps parsed into
  local time, enums as strings with no validation.
- **In-memory operations that look like SQL**: `.filter()` on a loaded
  collection, counting a loaded array, `distinct` applied client-side.
- **Upsert, bulk and window-function gaps** that push people into loops.
- **Hidden `OFFSET` pagination** in "paginate" helpers.

The cure is the same everywhere: read the generated SQL once per code
path (`query-performance.md` section 9), count statements, and use the
ORM's eager-load, select, bulk and raw escape hatches on purpose.

## 2. When to drop to SQL

Write SQL (parameterized, through the ORM's raw API or a query builder)
when the query needs:

- Window functions, `DISTINCT ON`, `LATERAL`, recursive CTEs, `FILTER`,
  grouping sets.
- `INSERT ... ON CONFLICT` with a `WHERE` or arithmetic in the update,
  `MERGE`, `RETURNING` of computed values.
- `FOR UPDATE SKIP LOCKED`, advisory locks, `NOWAIT`.
- Bulk operations: `UPDATE ... FROM (VALUES ...)`, `COPY`, `unnest`
  inserts, batched deletes.
- Engine-specific types and operators (`jsonb @>`, arrays, ranges,
  `tsvector`, `pgvector <->`).
- Anything where the ORM's output is visibly wrong in EXPLAIN and the
  fix is not expressible.

Keep the SQL in one place (a repository/query module, a `.sql` file with
sqlc/aiosql/HugSQL/`yesql`-style loaders), map results into the same types
the ORM uses, and test it against the real database. Never build SQL
with string interpolation of user input; `security/references/
injection.md` covers the rules. Identifiers (table/column names) cannot be
bound as parameters; whitelist them.

## 3. Prisma

Model: schema in `schema.prisma`, generated typed client, migrations by
`prisma migrate`. Prisma does not lazy-load; relations are only present if
you `include` or `select` them, which prevents N+1 at the type level but
creates its own patterns.

Footguns and fixes:

- **Relation loading in loops.** `const posts = await prisma.post.findMany();
  for (const p of posts) await prisma.user.findUnique({ where: { id: p.authorId }})`
  is the Prisma N+1. Fix: `findMany({ include: { author: true } })` or
  `select: { author: { select: { name: true }}}`. Prisma batches relation
  loads by default (one query per relation using `IN`), and `relationLoadStrategy:
  "join"` (5.x preview, now GA for Postgres/MySQL) uses a single `LATERAL
  JOIN` query; choose based on the shape (joins for small child sets,
  separate queries for large fan-outs).
- **Select all.** `findMany()` returns every scalar column. Use `select` on
  list queries; `omit` (5.13+) to drop wide columns globally
  (`omit: { body: true }` in client options).
- **`count` inside `include`**: `include: { _count: { select: { comments:
  true }}}` is one query with a subquery; fine. Counting by iterating
  `comments.length` after `include: { comments: true }` loads everything.
- **Transactions.** `prisma.$transaction([q1, q2])` is a batch of
  independent operations, atomic but with no logic between.
  `prisma.$transaction(async (tx) => { ... })` is interactive; use `tx`,
  not `prisma`, inside, or the statements run outside the transaction. Set
  `timeout` and `maxWait` options; defaults are short (5s). Isolation via
  `isolationLevel: Prisma.TransactionIsolationLevel.Serializable`. There is
  no `FOR UPDATE`; use `tx.$queryRaw` inside the interactive transaction.
- **Raw SQL.** `$queryRaw` and `$executeRaw` as tagged templates are
  parameterized: `` prisma.$queryRaw`select * from users where id = ${id}` ``
  binds `id`. `$queryRawUnsafe(string)` is not; it is for whitelisted
  dynamic identifiers only. `Prisma.sql` / `Prisma.join` compose fragments
  safely. Type the result: `$queryRaw<User[]>`. Prisma `TypedSQL` (5.19+,
  `prisma/sql/*.sql` with `prisma generate --sql`) gives typed raw queries.
- **BigInt and Decimal.** `BigInt` columns come back as JS `BigInt` (JSON
  serialization fails; convert); `Decimal` as `Prisma.Decimal` (decimal.js);
  `DateTime` as `Date` in UTC.
- **Upsert** is `upsert({ where, create, update })`; it maps to `INSERT ...
  ON CONFLICT` on Postgres when the `where` is a unique field, otherwise
  a select-then-write (race-prone). `createMany({ skipDuplicates: true })`
  for `ON CONFLICT DO NOTHING`.
- **Pagination.** `skip`/`take` is offset; `cursor: { id }` with `take`
  and `skip: 1` is keyset (needs a unique ordered field).
- **Connection pool.** Default pool is `num_cpus * 2 + 1`; serverless
  needs a pooler (Accelerate, PgBouncer with `?pgbouncer=true`, Neon/
  Supabase poolers) because each function instance opens its own pool.
  With PgBouncer transaction mode, `pgbouncer=true` disables prepared
  statements.
- **Migrations.** `migrate dev` generates SQL from the diff; review and
  edit for safety (see `migrations.md`). Renaming a field in the schema
  generates drop+add (data loss) unless you use `@map` to keep the column
  name or hand-edit the SQL.
- **`relationMode = "prisma"`** (PlanetScale without FKs): referential
  actions emulated in the client; only your app is protected; add
  `@@index` on every relation scalar because the DB no longer creates FK
  indexes.
- **Soft delete**: no built-in; use client extensions (`$extends` with
  query hooks) and be explicit; the old `$use` middleware is deprecated.

## 4. Drizzle

Model: schema in TypeScript, SQL-like query builder plus a relational
query API (`db.query.users.findMany({ with: { posts: true }})`),
migrations via Drizzle Kit. Drizzle is thin; what you write is close to
what runs.

- **Relational API vs core API.** `db.query.*` with `with:` generates a
  single query with JSON aggregation (`json_agg`/lateral) on Postgres, no
  N+1. The core `db.select().from().leftJoin()` returns flat rows you
  shape yourself; use it for aggregates and anything the relational API
  cannot express. Mixing them is normal.
- **Select columns.** `db.select({ id: users.id, name: users.name })`
  instead of `db.select()`; `columns: { id: true, name: true }` in the
  relational API.
- **Transactions.** `await db.transaction(async (tx) => { ... })`; use
  `tx` inside; `tx.rollback()` throws to abort; nested `transaction` calls
  create savepoints. Isolation and access mode as options:
  `db.transaction(fn, { isolationLevel: 'serializable' })`.
- **Raw SQL.** The `sql` tag is parameterized: `` sql`select ... where id =
  ${id}` ``; `sql.raw()` is not; `sql.identifier()` for names;
  `db.execute(sql`...`)`. Fragments compose inside the builder (`where(sql`
  ${users.createdAt} > now() - interval '1 day'`)`).
- **Upsert.** `.insert(t).values(v).onConflictDoUpdate({ target: t.id, set:
  { ... } })`, `onConflictDoNothing()`; `sql`excluded.col`` for the
  excluded reference (`sql.raw('excluded.qty')` in the `set`).
- **Locking.** `.for('update', { skipLocked: true })` on selects.
- **Pagination.** Hand-rolled keyset with `where(and(eq(..), lt(..)))`,
  `orderBy(desc(..))`, `limit()`; there is no magic, which is good.
- **Types.** `bigint` mode `'number'` vs `'bigint'`; `numeric` returns
  strings; `timestamp` with `mode: 'date'` or `'string'`, `withTimezone:
  true` for `timestamptz`. Set these deliberately in the schema.
- **Migrations.** `drizzle-kit generate` emits SQL you should read and
  edit; `push` is for prototyping; `--> statement-breakpoint` separates
  statements. Index `.concurrently()` exists for pg, but the migrator wraps
  files in a transaction, so run concurrent builds separately.
- **Drivers.** Works over `pg`, `postgres` (porsager), `neon`, `vercel-
  postgres`, `better-sqlite3`, `libsql`, `mysql2`, `planetscale`; pooling
  is the driver's concern. Serverless HTTP drivers do not support
  interactive transactions (Neon HTTP); use the WebSocket driver when you
  need them.

## 5. Kysely and Knex

Both are query builders, not ORMs; no entity mapping, no lazy loading, no
N+1 hidden from you. Kysely is typed end to end (schema as a TS interface,
or generated with `kysely-codegen`/`prisma-kysely`); Knex is untyped and
older.

- Compose queries with `.selectFrom().select([...]).where().orderBy()
  .limit()`; `.execute()`, `.executeTakeFirst()`,
  `.executeTakeFirstOrThrow()`.
- Kysely: `sql` tag parameterized; `sql.ref()`, `sql.table()`, `sql.raw()`
  (unsafe); `.$call()` for reusable fragments; `jsonArrayFrom`/
  `jsonObjectFrom` helpers emit lateral JSON subqueries for nested
  results in one query.
- Transactions: `db.transaction().execute(async (trx) => {...})`;
  `.setIsolationLevel('serializable')`. Knex: `knex.transaction(async trx
  => {...})`, with `trx.commit()` implicit on resolve.
- Upserts: Kysely `.onConflict((oc) => oc.column('id').doUpdateSet({...}))`
  with `eb.ref('excluded.col')`; Knex `.insert().onConflict('id').merge()`.
- Locking: Kysely `.forUpdate().skipLocked()`; Knex `.forUpdate().skipLocked()`.
- Migrations: Kysely `Migrator` with `FileMigrationProvider`; Knex CLI
  with up/down and `config.transaction = false` per file.

## 6. TypeORM

Model: decorators on entity classes, `Repository` and `QueryBuilder`
APIs, Active Record or Data Mapper style. It is the most footgun-dense of
the Node ORMs; review its SQL religiously.

- **`relations` / `eager`.** `find({ relations: { author: true } })` emits
  a `LEFT JOIN` and hydrates; `@ManyToOne(() => User, { eager: true })`
  always loads (and is forbidden on both sides of a relation). Accessing
  an unloaded relation gives `undefined`, not a lazy query, unless the
  property is typed `Promise<T>` (lazy relations; avoid, they are N+1
  generators).
- **Joins with pagination break.** `find({ relations, take, skip })` with
  one-to-many relations makes TypeORM paginate in memory or emit a
  `DISTINCT` subquery; QueryBuilder `.leftJoinAndSelect().take()` triggers
  a two-query strategy. For paginated lists, select the parents paged,
  then load children with `In(ids)`.
- **`select` columns.** `find({ select: { id: true, name: true } })` or
  `.select(['u.id', 'u.name'])` in QueryBuilder. `getRawMany()` returns
  flat rows with aliased names (`u_id`); `getMany()` hydrates entities.
- **`save()` does a `SELECT` first** to decide insert vs update (and
  cascades); `insert()`/`update()` are single statements. For bulk use
  `insert().values([...])` or `.orIgnore()`/`.orUpdate([...cols], [...conflict])`
  for upserts; `upsert()` on repositories.
- **Transactions.** `dataSource.transaction(async (manager) => { ... })`;
  use `manager`, not the global repositories, inside. `@Transactional`
  decorators from third-party packages rely on CLS; verify they actually
  propagate. QueryRunner for manual control.
- **Locking.** `.setLock('pessimistic_write')`, `'pessimistic_write_or_fail'`
  (`NOWAIT`), `'for_no_key_update'`; `setOnLocked('skip_locked')`.
- **Raw.** `dataSource.query('select ... where id = $1', [id])`
  (positional parameters per driver: `$1` pg, `?` mysql). QueryBuilder
  `.where('u.id = :id', { id })` is parameterized; string-concatenating
  into `.where()` is not.
- **`synchronize: true`** must be false outside local dev. Migrations via
  `migration:generate`; review every statement; it frequently proposes
  drop+add for things that did not change (default formatting, enum
  arrays).
- **Types.** `bigint` columns return strings; `decimal` returns strings;
  `timestamptz` returns `Date`. Use `transformer` on columns to map.
- **`@DeleteDateColumn`** soft delete adds `WHERE deleted_at IS NULL` to
  finds automatically and silently; `withDeleted()` to include. Know it
  is there.

## 7. SQLAlchemy 2.0

Model: Core (SQL expression language) plus ORM (declarative models,
`Session`). 2.0 style is `select(User).where(...)` executed via
`session.execute(stmt).scalars()`; legacy `session.query()` still works but
new code should not use it. Check `sqlalchemy.__version__` and whether the
repo uses 1.x `Query` style, async (`AsyncSession`), or both.

- **Lazy loading is the default** (`lazy="select"`): `order.customer`
  emits a query on access; in a loop that is N+1. Fixes per relationship
  or per query: `selectinload(Order.customer)` (one extra `IN` query; the
  best default for collections), `joinedload(Order.customer)` (one query
  with a join; good for many-to-one), `subqueryload` (legacy),
  `raiseload('*')` to turn lazy access into an error in tests and find
  N+1s, `lazy="raise"` on the relationship for the same effect
  everywhere. `contains_eager` when you wrote the join yourself.
- **Async sessions cannot lazy-load at all** (`MissingGreenlet`); you must
  eager-load, or `await session.run_sync(...)`. This is a feature.
- **Select columns.** `select(User.id, User.name)` returns tuples;
  `select(User).options(load_only(User.id, User.name))` returns partial
  entities (`defer()` for wide columns); `defer(User.body, raiseload=True)`.
- **Sessions and transactions.** A `Session` is a unit of work; the
  recommended pattern is `with Session(engine) as session, session.begin():
  ...` (commit on exit, rollback on exception). `autoflush` means a query
  may flush pending changes first; `expire_on_commit=True` (default) means
  attributes reload after commit (one query per object touched after
  commit; set `False` for API serializers that read after commit).
  Nested `begin_nested()` is a savepoint. Scoped sessions per request
  in web apps; never share a session across threads or requests.
- **Isolation and locking.** `engine.execution_options(isolation_level=
  "REPEATABLE READ")` or per connection; `select(...).with_for_update(
  skip_locked=True, of=Job)`.
- **Bulk.** `session.execute(insert(User), [{"name": ...}, ...])` (2.0
  bulk insert), `insert(User).values(...).on_conflict_do_update(
  index_elements=[User.email], set_={...})` from `sqlalchemy.dialects.
  postgresql`; `session.execute(update(User).where(...).values(...))` for
  bulk updates (bypasses ORM events; `synchronize_session` option).
  `Session.bulk_*` methods are legacy.
- **Raw.** `session.execute(text("select ... where id = :id"), {"id": id})`;
  `text()` with `:name` binds; map to ORM with `select(User).from_statement(
  text(...))`. Never f-string into `text()`.
- **Types.** `Numeric` returns `Decimal`; `DateTime(timezone=True)` for
  `timestamptz` (plain `DateTime` is naive); `JSON`/`JSONB` from the pg
  dialect; `Enum` creates a native pg enum unless `native_enum=False`
  (prefer a `String` + `CheckConstraint`, or `native_enum=False` with
  `create_constraint=True`). Use `Mapped[...]` annotations with
  `mapped_column()` for typed models.
- **Alembic** autogenerate: catches adds/drops, misses renames (drop+add),
  often misses server defaults, check constraints and index changes
  unless `compare_server_default=True`; always read the revision file.
- **Connection pooling.** `QueuePool` default `pool_size=5, max_overflow=10`;
  `pool_pre_ping=True` for recycled connections; `NullPool` behind an
  external pooler in serverless.

## 8. Django ORM

Model: models in `models.py`, QuerySets are lazy and chainable, migrations
generated from models. Django's defaults are good; the problems are
performance idioms.

- **N+1.** `for book in Book.objects.all(): book.author.name` → N+1.
  `select_related('author')` (SQL join; for FK/one-to-one) and
  `prefetch_related('tags')` (second query with `IN`; for many-to-many and
  reverse FK; `Prefetch('tags', queryset=Tag.objects.filter(...))` to
  shape it). Combine both. Detect with `assertNumQueries(n)` in tests,
  `django-debug-toolbar`, `nplusone`, or `django-seal`/`django-zen-queries`
  that raise on lazy loads.
- **Select columns.** `.only('id', 'name')` (deferred model instances;
  touching other fields causes a query each), `.defer('body')`,
  `.values('id', 'name')` (dicts), `.values_list('id', flat=True)`.
- **`len(qs)` vs `.count()`, `if qs:` vs `.exists()`.** `len()` loads
  everything; `count()` is `SELECT COUNT(*)`; `exists()` is `LIMIT 1`.
  Also: evaluating a QuerySet twice runs it twice unless cached on the
  same object.
- **Updates.** `obj.field = x; obj.save()` writes all fields (`save(
  update_fields=['field'])` to limit) and races. `Model.objects.filter(
  pk=id).update(count=F('count') + 1)` is a single atomic statement.
  `F()` expressions, `Q()` for OR/NOT, `Case/When`, `Subquery`/`OuterRef`,
  `Window()` with `RowNumber()`, `annotate()` with aggregates: the ORM
  covers more than most people use.
- **Bulk.** `bulk_create(objs, batch_size=1000, ignore_conflicts=True)` or
  `update_conflicts=True, update_fields=[...], unique_fields=[...]` (4.1+)
  for upserts; `bulk_update(objs, ['field'], batch_size=500)` (generates a
  `CASE` per row; fine to thousands, slow beyond). Signals do not fire for
  bulk ops.
- **Transactions.** Autocommit per statement by default; `ATOMIC_REQUESTS
  = True` wraps every view (convenient, hurts with slow views). `with
  transaction.atomic():` for explicit blocks; nested atomic = savepoint.
  `select_for_update(skip_locked=True, of=('self',))` only inside
  `atomic()`. `transaction.on_commit(callback)` for side effects after
  commit (send the email after the row exists).
- **Raw.** `Model.objects.raw('select ... where id = %s', [id])` maps to
  models; `connection.cursor().execute(sql, params)` for anything.
  `%s` placeholders always, even for Postgres. `RawSQL()` expression
  inside annotations with `params`.
- **Migrations.** `makemigrations` is good at detecting changes; it asks
  about renames. `db_index=True` → non-concurrent index; use `Meta.indexes`
  with `AddIndexConcurrently` in an `atomic = False` migration for large
  tables. `RunPython` data migrations: keep them separate, use
  `apps.get_model()`, write `reverse_code`. `CheckConstraint` and
  `UniqueConstraint(condition=...)` in `Meta.constraints` are first-class.
- **Types.** `DecimalField(max_digits, decimal_places)` for money (never
  `FloatField`); `DateTimeField` with `USE_TZ=True` stores UTC (keep it
  on); `JSONField` with `KeyTransform` lookups (`data__status='x'`) and
  `GinIndex`; `ArrayField`, `CITextField`, `DateRangeField` from
  `django.contrib.postgres`. `choices` on a field is validation in forms
  only, not a DB constraint; add a `CheckConstraint` when it matters.
- **Connection pooling.** Django 5.1+ has `"OPTIONS": {"pool": True}` for
  psycopg 3; before that, `CONN_MAX_AGE` (persistent connections per
  worker) or PgBouncer. `CONN_HEALTH_CHECKS = True`.

## 9. ActiveRecord

Model: convention over configuration, `has_many`/`belongs_to`, lazy
relations, schema in `db/schema.rb`. Rails has the best N+1 tooling of any
ecosystem, if you use it.

- **N+1.** `Post.all.each { |p| p.author.name }` → N+1. `includes(:author)`
  (lets Rails choose preload vs eager_load), `preload(:author)` (separate
  `IN` query; default choice), `eager_load(:author)` (`LEFT OUTER JOIN`;
  needed when you filter on the association), `joins(:author)` (INNER
  JOIN without loading). Nested: `includes(comments: :author)`. Detect
  with `strict_loading` (per model, per association, or
  `config.active_record.strict_loading_by_default = true` in test/dev,
  raising `StrictLoadingViolationError`), the `bullet` gem, or
  `n_plus_one_control` in tests.
- **Select columns.** `select(:id, :title)`, `pluck(:id, :title)` (arrays,
  no models), `pick` (one row). `ids` for just primary keys. Models loaded
  with `select` raise `MissingAttributeError` on other attributes, which
  is honest.
- **`count` vs `size` vs `length`.** `count` always queries; `size` uses
  loaded data if present else counts; `length` loads everything. `exists?`
  / `any?` (`any?` on a loaded relation is in-memory; on an unloaded one
  it queries). `count` after `includes` can generate a `DISTINCT COUNT`
  join; use `size` or count the base relation.
- **Counter caches.** `belongs_to :post, counter_cache: true` maintains
  `posts.comments_count` on create/destroy (not on `update_all`/`delete_all`
  /`insert_all`); `reset_counters` to repair.
- **Bulk.** `insert_all`/`upsert_all` (Rails 6+; skip validations and
  callbacks; `unique_by:` for the conflict target; `on_duplicate:`
  `:update`/`:skip`, `update_only:` 7.0+); `update_all` and `delete_all`
  (single statements, no callbacks); `in_batches(of: 1000)` and
  `find_each` for iteration (ordered by PK, keyset underneath).
- **Transactions.** `ActiveRecord::Base.transaction do ... end`;
  exceptions roll back; `requires_new: true` for a savepoint; `after_commit`
  callbacks for side effects (not `after_save`, which runs inside the
  transaction). `lock` (`FOR UPDATE`), `lock("FOR UPDATE SKIP LOCKED")`,
  `with_lock` (reload + lock + block). `transaction(isolation:
  :serializable)`. Optimistic locking automatic with a `lock_version`
  column (`StaleObjectError`).
- **Raw.** `Model.find_by_sql(["select ... where id = ?", id])`,
  `connection.exec_query(sql, "name", binds)`, `sanitize_sql_array`,
  `where("created_at > ?", time)` is parameterized; `where("name =
  '#{name}'")` is injection. Arel for composable SQL when needed.
- **Migrations.** `strong_migrations` gem catches unsafe ops and prints
  the safe version; `disable_ddl_transaction!` + `algorithm: :concurrently`;
  `validate: false` then `validate_*`; `change` vs `up`/`down`;
  `reversible`; `db/structure.sql` for Postgres features (`config.
  active_record.schema_format = :sql`). Data migrations in rake tasks or
  `data_migrate`.
- **Types.** `decimal` with `precision:`/`scale:` for money (or the
  `money-rails` gem with integer cents); timestamps are `timestamptz` only
  if you set `ActiveRecord::ConnectionAdapters::PostgreSQLAdapter.datetime_type
  = :timestamptz` (Rails 7+); `enum` in the model is an integer or string
  column with no DB constraint (add `check_constraint` or use a pg enum via
  `create_enum` in Rails 7); `jsonb` with `store_accessor`.
- **Multiple databases.** `connects_to database: { writing: :primary,
  reading: :replica }` with automatic role switching and a
  read-after-write delay (`delay: 2.seconds`); understand it before
  enabling.

## 10. Ecto

Model: schemas, changesets for validation, `Repo` for execution, explicit
everything. Ecto has no lazy loading at all: accessing an unloaded
association gives `%Ecto.Association.NotLoaded{}`, which is the best
anti-N+1 design in the list.

- **Preloading.** `Repo.preload(posts, :author)` or `from(p in Post,
  preload: [:author])` (separate `IN` query) or `join: a in assoc(p,
  :author), preload: [author: a]` (single query). Nested: `preload:
  [comments: :author]`.
- **Select.** `select: {p.id, p.title}` or `select: %{id: p.id}` or
  `select: [:id, :title]` (struct with others nil).
- **Transactions.** `Repo.transaction(fn -> ... Repo.rollback(reason) end)`
  or `Ecto.Multi` for composable steps with named results and a single
  commit; `Multi` is the idiom for multi-step writes. `lock: "FOR UPDATE
  SKIP LOCKED"` in queries.
- **Bulk.** `Repo.insert_all(Post, rows, on_conflict: {:replace, [:title]},
  conflict_target: :id, returning: true)`; `Repo.update_all(query, set: [..],
  inc: [count: 1])`; `Repo.delete_all`. `Repo.stream` inside a transaction
  for large reads.
- **Raw.** `Repo.query("select ... where id = $1", [id])`,
  `Ecto.Adapters.SQL.query!`; `fragment("lower(?)", u.email)` inside
  queries, parameterized. Never interpolate into `fragment`.
- **Migrations.** `mix ecto.gen.migration`; `create index(..., concurrently:
  true)` with `@disable_ddl_transaction true` and `@disable_migration_lock
  true`; `execute("...", "...")` for up/down SQL; `flush()` before data ops.
- **Types.** `:decimal` for money; `:utc_datetime_usec` for `timestamptz`
  (plain `:naive_datetime` is the trap); `Ecto.Enum` maps atoms to strings
  or integers with no DB constraint (add a check in the migration);
  `:map` for jsonb.

## 11. GORM

Model: struct tags, method chaining, conventions (`ID`, `CreatedAt`,
`UpdatedAt`, `DeletedAt`). GORM's convenience hides a lot; `sqlc` or
`sqlx` is often the better choice in Go, but when the repo uses GORM:

- **N+1.** Associations are not loaded unless `Preload("Author")`
  (separate `IN` query) or `Joins("Author")` (single query, belongs-to/
  has-one only). Nested `Preload("Comments.Author")`; `Preload(clause.
  Associations)` for all first-level.
- **Select.** `db.Select("id", "name").Find(&users)`; `Model(&User{}).
  Select(...)`. `Find` into a smaller struct selects only its fields when
  you pass the model: `db.Model(&User{}).Find(&[]UserSummary{})`.
- **Soft delete is automatic** when the struct has `gorm.DeletedAt`:
  every query gets `WHERE deleted_at IS NULL` and `Delete` becomes an
  update. `Unscoped()` to bypass. Unique indexes must account for it.
- **Zero values.** `Updates(User{Active: false})` ignores `false` (zero
  value) silently; use `Updates(map[string]any{"active": false})` or
  `Select("active").Updates(...)`. `Where(User{Age: 0})` also drops zero
  fields. This is the GORM bug you will meet first.
- **Transactions.** `db.Transaction(func(tx *gorm.DB) error { ... })`
  (return error → rollback); manual `tx := db.Begin()`; use `tx` inside.
  `Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})`.
  `SkipDefaultTransaction: true` in config to stop GORM wrapping every
  write in its own transaction (a measurable speedup).
- **Bulk.** `CreateInBatches(users, 500)`; upsert `Clauses(clause.OnConflict{
  Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns(
  []string{"name"})})`; `UpdateOnConflict` patterns; `db.Model(&User{}).
  Where(...).Updates(map)` for bulk updates.
- **Raw.** `db.Raw("select ... where id = ?", id).Scan(&result)`,
  `db.Exec("update ... where id = ?", id)`; `?` placeholders are
  parameterized for all dialects; `gorm.Expr("count + ?", 1)`.
- **Migrations.** `AutoMigrate` adds columns and indexes and never
  removes or alters; it is not a production migration tool. Pair with
  Atlas (`atlas migrate diff --to "gorm://..."`) or golang-migrate/goose
  with hand SQL.
- **Types.** `decimal.Decimal` via `shopspring/decimal` with `type:numeric`
  tag for money; `time.Time` maps to `timestamptz` on pg; `datatypes.JSON`
  for jsonb; `pgtype` for arrays.
- **Logging.** `Logger: logger.Default.LogMode(logger.Info)` or
  `db.Debug()`; `SlowThreshold` in logger config.

## 12. sqlc, sqlx, pgx (SQL-first Go)

The SQL-first approach: you write the queries, the tool generates typed
Go. There is no N+1 by magic, but there is by loop; write one query with
`= any($1::bigint[])` for the children.

- **sqlc**: `query.sql` annotated `-- name: GetUser :one`, `:many`, `:exec`,
  `:execrows`, `:batchexec`/`:batchmany` (pgx batches), `:copyfrom` (COPY);
  `sqlc.arg()`, `sqlc.narg()` for nullable params, `sqlc.slice()` for
  `IN` on MySQL, `sqlc.embed()` for nested structs from joins; `sqlc vet`
  runs EXPLAIN rules in CI. Schema from migration files; keep `sqlc.yaml`
  pointed at them. Generated code uses `pgx/v5` types (`pgtype.Numeric`,
  `pgtype.Timestamptz`) or `database/sql`.
- **sqlx**: `db.Get(&u, "select ... where id = $1", id)`, `db.Select(&us,
  ...)`, `NamedExec` with `:name` params, `sqlx.In` to expand slices for
  `IN (?)` then `db.Rebind`. Struct tags `db:"col"`.
- **pgx**: `pool.QueryRow(ctx, sql, args...).Scan(...)`, `pgx.CollectRows(
  rows, pgx.RowToStructByName[T])` (v5), `pool.CopyFrom` for bulk, `Batch`
  for pipelining, `pgx.TxOptions{IsoLevel: pgx.Serializable}`; prepared
  statement cache modes (`default_query_exec_mode`) matter behind
  PgBouncer (set `QueryExecModeSimpleProtocol` or `QueryExecModeExec`).
- **Transactions**: `tx, err := pool.Begin(ctx); defer tx.Rollback(ctx);
  ... tx.Commit(ctx)`; pass `tx` (which satisfies the `DBTX` interface in
  sqlc) to the query functions.
- **Migrations**: golang-migrate, goose, Atlas, tern (pgx author's tool).

## 13. Hibernate / JPA (Spring Data)

Model: entities with annotations, a `Session`/`EntityManager` as a
first-level cache and unit of work, JPQL/Criteria/native queries, Spring
Data repositories generating queries from method names.

- **N+1.** `@ManyToOne` and `@OneToOne` are `EAGER` by default (a join or
  an extra select per entity depending on the query); `@OneToMany` and
  `@ManyToMany` are `LAZY` (a query per collection access, N+1 in loops).
  Fixes: `JOIN FETCH` in JPQL (`select o from Order o join fetch o.customer
  where ...`), `@EntityGraph(attributePaths = {"customer", "lines"})` on
  Spring Data methods, `@BatchSize(size = 50)` on collections or
  `hibernate.default_batch_fetch_size=50` (turns N+1 into N/50+1),
  `FetchMode.SUBSELECT`. Set all `@ManyToOne(fetch = FetchType.LAZY)`;
  eager on to-one is the common silent cost. Detect with
  `hibernate.generate_statistics=true` and `SessionStatistics`, or
  `datasource-proxy`/`p6spy` counting, or the `digma`/`jpa-buddy` tooling;
  assert statement counts in tests.
- **Fetching multiple bags** (`join fetch` two `List` collections) throws
  `MultipleBagFetchException`; use `Set` or fetch in two queries.
- **Pagination with join fetch** on collections: Hibernate warns
  `HHH000104: firstResult/maxResults specified with collection fetch;
  applying in memory` and loads everything. Paginate IDs first, then
  fetch by `id in (:ids)`.
- **Open Session in View** (`spring.jpa.open-in-view=true` default in
  Spring Boot) keeps the session open through view rendering so lazy
  loads "work" in templates and serializers: hidden N+1 and a connection
  held for the whole request. Set it `false` and fetch what the view
  needs explicitly; use DTO projections (`select new com.x.OrderDto(o.id,
  c.name) from ...` or interface projections in Spring Data) for read
  models.
- **Select columns.** Entities load all basic columns (except `@Basic(
  fetch = LAZY)` with bytecode enhancement); DTO projections are the
  real answer for lists.
- **Transactions.** `@Transactional` on service methods (not repositories
  or controllers); self-invocation bypasses the proxy; `readOnly = true`
  for reads (skips dirty checking, may route to a replica);
  `Propagation.REQUIRES_NEW` for audit writes that must survive rollback;
  `isolation = Isolation.SERIALIZABLE` when needed. The flush happens at
  commit or before queries (`FlushMode.AUTO`), so a "missing" write is
  usually an unflushed one. `@Version` for optimistic locking;
  `LockModeType.PESSIMISTIC_WRITE` plus `jakarta.persistence.lock.timeout`
  hint (`-2` for `SKIP LOCKED` on Hibernate 6 with pg).
- **Bulk.** JPQL `update`/`delete` bypass the session cache (clear
  after); `hibernate.jdbc.batch_size=50` with `order_inserts`/
  `order_updates=true` for batched inserts (and `SEQUENCE` generators with
  `allocationSize`, never `IDENTITY`, which disables JDBC batching);
  `@SQLInsert` or native queries for upserts; `StatelessSession` for
  large loads.
- **IDs.** `GenerationType.SEQUENCE` with `allocationSize = 50` (pooled);
  `IDENTITY` kills batching; UUIDs via `@UuidGenerator` (Hibernate 6;
  `style = TIME` for v7-like ordering in 6.5+).
- **Raw.** `entityManager.createNativeQuery(sql, Dto.class)` with
  positional `?1` or named `:p` parameters; `@Query(nativeQuery = true)` on
  repositories. String concatenation into JPQL is injection too.
- **Migrations.** Flyway/Liquibase; `spring.jpa.hibernate.ddl-auto=validate`
  in production (verify the mapping matches the schema and fail fast),
  never `update`.
- **Types.** `BigDecimal` with `@Column(precision = 19, scale = 4)`;
  `Instant`/`OffsetDateTime` for `timestamptz` (`LocalDateTime` is naive);
  `@Enumerated(EnumType.STRING)` never `ORDINAL`; `@JdbcTypeCode(SqlTypes.
  JSON)` for jsonb in Hibernate 6.
- **Connection pool.** HikariCP; `maximumPoolSize` ~ cores × 2 to 4;
  `connection-timeout` short; `leak-detection-threshold` in dev.

## 14. Eloquent

Model: Active Record style, fluent query builder, lazy relations,
migrations via Artisan schema builder.

- **N+1.** `$posts = Post::all(); foreach ($posts as $p) $p->author->name;`
  → N+1. `Post::with('author')->get()`, nested `with('comments.author')`,
  constrained `with(['comments' => fn($q) => $q->latest()->limit(3)])`
  (note: limit inside `with` applies to the whole set, not per parent,
  before Laravel 11's `limit` per-parent support; use a lateral subquery
  or the `staudenmeir/eloquent-eager-limit` package). `load()` for lazy
  eager loading after the fact. `Model::preventLazyLoading(!app()->
  isProduction())` in `AppServiceProvider` throws on lazy loads in dev
  and tests. `withCount('comments')` for counts without loading.
- **Select columns.** `Post::select(['id', 'title'])->get()`; include the
  FK columns needed by `with()`; `pluck('title', 'id')`.
- **Chunking.** `chunkById(1000, fn($rows) => ...)` is keyset;
  `chunk()` with offset breaks when rows change; `lazyById()` /
  `cursor()` for generators.
- **Transactions.** `DB::transaction(fn() => ..., attempts: 3)` retries
  on deadlock; manual `DB::beginTransaction()/commit()/rollBack()`;
  `lockForUpdate()`, `sharedLock()`; `DB::afterCommit()`
  (`dispatchAfterCommit` for jobs). Nested transactions use savepoints.
- **Bulk.** `Model::insert([...])` (no timestamps, no events),
  `upsert($rows, ['email'], ['name'])`, `Model::where(...)->update([...])`
  (no events; `increment('count')` is atomic).
- **Raw.** `DB::select('select ... where id = ?', [$id])`, `whereRaw('lower(email)
  = ?', [$email])`, `DB::raw()` for expressions (not for user input),
  `selectRaw`. Named bindings `:id`.
- **Casts.** `$casts = ['price' => 'decimal:2', 'meta' => 'array',
  'paid_at' => 'immutable_datetime']`; `decimal` casts return strings (use
  `brick/money` or integer cents for money); enums via `->cast` to a
  backed enum (no DB constraint; add one in the migration).
- **Migrations.** `$table->foreignId('user_id')->constrained()->cascadeOnDelete()`;
  `$table->index(['tenant_id', 'created_at'])`; `fullText()`; for
  Postgres concurrent indexes use `DB::statement()` with
  `$withinTransaction = false`. `SoftDeletes` trait adds the global scope
  and `deleted_at`; `withTrashed()` to bypass.

## 15. Cross-ORM transaction patterns

| Need | Rule |
|---|---|
| Side effect after a write (email, queue publish) | After commit hook (`transaction.on_commit`, `after_commit`, `DB::afterCommit`, Spring `TransactionSynchronization`, Prisma: do it after `$transaction` resolves), or an outbox table |
| Lock for read-modify-write | The ORM's `for update` verb inside its transaction API; never `select` then `update` without it |
| Retry on serialization failure / deadlock | Wrap the ORM transaction in a retry loop at the service layer; the body must be side-effect free; `backend` owns where that loop lives |
| Nested transaction | Know whether the ORM makes a savepoint (Django `atomic`, Rails `requires_new`, SQLAlchemy `begin_nested`, Drizzle nested `transaction`) or joins the outer one silently (Rails default, Spring `REQUIRED`) |
| Long job | Many short transactions; never one transaction for a million rows |
| Behind PgBouncer transaction mode | No session state (`SET`, session advisory locks, prepared statements by name, temp tables, `LISTEN`); see `scaling-and-operations.md` |
