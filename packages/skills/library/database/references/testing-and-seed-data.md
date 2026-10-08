# Testing and seed data

How to test code that talks to a database honestly: a real database of the
production engine in tests, isolation via transaction-per-test or
schema-per-worker, factories over fixtures, realistic seed data for
development, migration tests, constraint tests, query-count assertions,
and testing against production-like volume. Per-ecosystem setups included.

## Contents

1. Principles
2. Running the real engine in tests
3. Isolation strategies
4. Factories and test data
5. What to test at the database boundary
6. Migration tests
7. Seed data for development
8. Production-like volume and anonymized snapshots
9. Per-ecosystem setup notes
10. Anti-patterns

## 1. Principles

- **Mocking the database tests the mock.** A repository mock that returns
  whatever the test wants proves nothing about the query, the constraint,
  the transaction boundary, or the ORM's generated SQL, which is where the
  bugs are. Unit-test pure logic with mocks if you like; test anything
  that touches persistence against the real engine.
- **Same engine, same major version as production.** SQLite standing in
  for Postgres hides the failures most likely to ship (`sqlite.md`
  section 9). Docker makes the real thing cheap.
- **Every test starts from a known state and leaves none.** Transaction
  rollback, truncation, or a fresh schema; never "tests clean up after
  themselves" by hand.
- **Test data looks like real data.** Realistic lengths, unicode, nulls
  where allowed, timestamps across zones, several tenants. Uniform toy
  data hides planner behavior and encoding bugs.
- **Schema comes from migrations, not from the ORM's sync.** Tests run
  the real migration chain so the migrations themselves are tested every
  CI run.

## 2. Running the real engine in tests

Locally and in CI, start the engine as a service:

```yaml
# docker-compose.test.yml
services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app_test }
    ports: ["5433:5432"]
    tmpfs: ["/var/lib/postgresql/data"]            # RAM-backed: much faster, disposable
    command: >
      postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off
               -c shared_buffers=256MB -c max_connections=200
```

`fsync=off` and tmpfs are safe for a throwaway test database and cut
test time substantially. GitHub Actions `services:` blocks do the same;
`testcontainers` (Java, Go, Node, Python, .NET, Rust) starts a container
per test run from code and is the cleanest option when CI has Docker.

For MySQL use `mysql:8` with `--innodb-flush-log-at-trx-commit=0`; for
Mongo `mongo:7` (replica set mode if you use transactions:
`--replSet rs0`); DynamoDB Local, Firestore emulator, Redis `redis:7`.

Embedded alternatives when Docker is unavailable: `embedded-postgres`
(Java, Go, Node ports), `pglite` (Postgres compiled to WASM; fast, good
for unit-level tests, not every extension), `pg_tmp`. Prefer Docker.

## 3. Isolation strategies

| Strategy | How | Pros | Cons |
|---|---|---|---|
| Transaction per test | Begin before each test, roll back after; the code under test uses the same connection | Fastest; no cleanup | Code that commits or opens its own connections escapes; `after_commit` hooks need special handling; cannot test transaction behavior itself; concurrent tests in one process are tricky |
| Truncate between tests | `truncate ... restart identity cascade` on all tables after each test | Works with multi-connection code | Slower (ms per table); sequences reset only with `restart identity` |
| Schema or database per worker | Each parallel worker gets `app_test_<n>`, migrated once; tests use transactions or truncation within | Parallelism; realistic connection behavior | Setup time; must template the migrated DB (`create database x template app_test`) |
| Template database | Migrate once into `app_test_template`, then `create database app_test_1 template app_test_template` per worker (sub-second) | Fast fresh DBs | Postgres-specific; MySQL needs a dump/restore |
| Savepoint per test inside a wrapping transaction | Nested rollback (`SAVEPOINT`) | Allows code under test to "commit" (release savepoint) | ORM must support it (Django does, Rails does, SQLAlchemy via `join_transaction_mode`) |

Frameworks implement these for you: Rails transactional tests (and
`use_transactional_tests = false` for system tests, with
`database_cleaner`), Django `TestCase` (transaction) vs `TransactionTestCase`
(truncation), pytest-django `db`/`transactional_db` fixtures, SQLAlchemy
"join an external transaction" recipe, Spring `@Transactional` on tests,
Ecto `Ecto.Adapters.SQL.Sandbox` (shared or ownership mode for async),
Laravel `RefreshDatabase` (transaction) / `DatabaseTransactions`, Go
`testcontainers` with a `TRUNCATE` helper or a schema per package,
Prisma with `vitest`/`jest` plus `prisma-test-utils`-style truncation or
`pg-transactional-tests`, Drizzle via `db.transaction` rollback or
truncation.

Testing concurrency (deadlock retry, `SKIP LOCKED`, serialization
failures) requires real commits from two connections; use the truncation
or per-test-database strategy for those tests specifically.

## 4. Factories and test data

Factories build valid rows with sensible defaults and let a test override
only what matters. Fixtures (static YAML/JSON dumps) rot, hide
relationships, and produce tests that break when an unrelated field is
added.

```python
# Python: factory_boy with SQLAlchemy or Django
class CustomerFactory(factory.alchemy.SQLAlchemyModelFactory):
    class Meta: model = Customer; sqlalchemy_session = session
    name  = factory.Faker("company")
    email = factory.Sequence(lambda n: f"customer{n}@example.test")   # unique, deterministic
    region = factory.Iterator(["EU", "US", "APAC"])

class OrderFactory(factory.alchemy.SQLAlchemyModelFactory):
    class Meta: model = Order; sqlalchemy_session = session
    customer = factory.SubFactory(CustomerFactory)
    status = "placed"
    total_cents = factory.Faker("pyint", min_value=100, max_value=500_000)
    created_at = factory.Faker("date_time_between", start_date="-1y", tzinfo=timezone.utc)
```

```ts
// TypeScript: fishery + faker with Prisma or Drizzle
export const customerFactory = Factory.define<CustomerInput>(({ sequence }) => ({
  name: faker.company.name(),
  email: `customer${sequence}@example.test`,
  region: faker.helpers.arrayElement(['EU', 'US', 'APAC']),
}));
const customer = await prisma.customer.create({ data: customerFactory.build({ region: 'EU' }) });
```

Ruby: `factory_bot` with `sequence(:email)`, `association :customer`,
`trait :paid`, `transient` attributes; `build_stubbed` for no-DB unit
tests. Go: hand-written `NewTestCustomer(t, db, overrides...)` helpers;
`gofakeit` for values. Java: builders plus `Instancio` or `EasyRandom`;
Testcontainers. PHP: Laravel model factories (`Customer::factory()->count(5)
->has(Order::factory()->count(3))->create()`). Elixir: ExMachina.

Rules: unique fields come from sequences (not random, which collides
eventually); every FK is satisfied by a sub-factory; timestamps are
spread, not all `now()`; include a factory trait for every status in a
state machine; keep factories in one place and treat them as production
code.

Faker output seeded (`faker.seed(42)`) when reproducibility matters
(snapshot tests); unseeded otherwise to surface edge cases over time.

## 5. What to test at the database boundary

- **Constraints fire.** For each unique, check and FK you add: a test
  inserts the violating row and asserts the specific error (and that the
  application translates it). Cheap, and documents the invariant.
  ```python
  def test_duplicate_email_rejected(session):
      CustomerFactory(email="a@example.test"); session.flush()
      with pytest.raises(IntegrityError):
          CustomerFactory(email="a@example.test"); session.flush()
  ```
- **Referential actions.** Delete the parent; assert children cascaded,
  nulled, or the delete was refused as designed.
- **Query shape.** Assert the query count for list endpoints
  (`assertNumQueries(3)`, `assert_queries_count`, Hibernate statistics,
  Prisma `$on('query')` counter, SQLAlchemy `before_cursor_execute`
  listener). This is the N+1 regression test.
- **Query correctness on realistic data.** Keyset pagination across page
  boundaries with duplicate timestamps; soft-delete filters; tenant
  isolation (seed two tenants, query as one, assert zero leakage; with
  RLS, set the tenant setting and query as the app role).
- **Transactions.** The multi-write operation rolls back fully on failure
  in the middle (inject a failure after the first write). `after_commit`
  side effects do not fire when rolled back.
- **Concurrency where it matters.** Two goroutines/threads/processes
  claim from the queue; assert each job is claimed once. Two concurrent
  increments; assert the counter is right. Use real commits (section 3).
- **Raw SQL** has a test as any code does, including the parameter
  binding path (a value with a quote in it).
- **Time**: freeze or inject the clock; tests that depend on `now()` in
  the database versus the app clock drift.
- **Timezones**: at least one test with a timestamp near midnight UTC
  and a non-UTC display zone; a `date` boundary test.
- **Unicode and length**: names with combining characters, emoji
  (`utf8mb4` on MySQL), the maximum length your check allows and one
  more.

## 6. Migration tests

- CI runs the full migration chain from an empty database on every PR
  (this is what "tests use migrations, not sync" buys).
- For the new migration: run up, then down (where down exists), then up
  again; assert the schema matches the ORM's model (`prisma migrate diff
  --from-url ... --to-schema-datamodel schema.prisma --exit-code`,
  `alembic check`, Django `makemigrations --check`, Rails `db:schema:dump`
  diff clean, Atlas `migrate lint`/`schema diff`).
- Data migrations: a test that seeds the "before" shape, runs the
  migration, asserts the "after" shape (Django `MigrationExecutor` to a
  specific state; Rails `require_migration!` and calling `migrate(:up)`;
  Alembic via `command.upgrade` to a revision in a test DB).
- Timing test for anything touching a large table: load N million rows in
  a scratch DB and time the migration; record it in the PR.
- Lint: `squawk` (Postgres SQL files), `strong_migrations`, `atlas migrate
  lint`, `django-migration-linter`, Prisma `migrate diff` review.

## 7. Seed data for development

Development seeds should make the app look real on first run: several
users with different roles, a few tenants, orders across every status,
dates spanning months, some edge cases (long names, empty optional
fields, a cancelled subscription). Build them from the same factories as
tests, driven by a script (`prisma db seed` → `prisma/seed.ts`, Django
management command or fixtures via `loaddata` for small reference data,
Rails `db/seeds.rb` with `find_or_create_by!` for idempotency, Laravel
`DatabaseSeeder`, Go `cmd/seed`, Ecto `priv/repo/seeds.exs`).

Rules: idempotent (`upsert`/`find_or_create`) so re-running does not
duplicate; deterministic IDs or lookups for things other seeds reference;
reference data (countries, currencies, plan tiers) is a migration or an
idempotent seed that production also runs; fake PII only (never a copy
of production into dev seeds); a seeded admin login documented in the
README with an obviously-dev password; seeds run in CI so they do not
rot.

Separate: reference data (needed in production, versioned, small),
development seeds (fake, generous), test factories (minimal, per-test).

## 8. Production-like volume and anonymized snapshots

Query plans change with data volume and skew; a test suite on 50 rows
cannot catch a seq scan on 50M. Two approaches:

- **Generated volume** with `generate_series` and skewed distributions
  (`query-performance.md` section 10), loaded into a staging database;
  run the migration and EXPLAIN the hot queries there. Automate as a
  nightly job for the top 20 queries from `pg_stat_statements`, alerting
  on plan changes or latency regression.
- **Anonymized production snapshot**: restore a backup to a locked-down
  instance, run an anonymization script (replace emails with
  `user<id>@example.test`, names via a deterministic faker keyed by id so
  joins still work, null free-text fields or replace with lorem ipsum,
  hash tokens, drop tables that are pure PII), verify no raw PII remains
  (grep for `@realdomain.com`, phone patterns), then dump for staging.
  Tools: `pg_anonymizer`/`postgresql_anonymizer`, `greenmask`,
  `pgsync`/`replibyte`, `tonic`, or a hand-written SQL script. The
  anonymization script is code, reviewed like code, and run in the
  isolated environment before the data moves anywhere.

Anonymized snapshots are the best input for migration timing, EXPLAIN
work, and load tests; generated data is the fallback when the regulatory
answer is "no production data leaves production", which is common and
correct.

## 9. Per-ecosystem setup notes

| Stack | Setup |
|---|---|
| Node + Prisma | `DATABASE_URL` to the test DB; `prisma migrate deploy` in a global setup; truncate between tests (`TRUNCATE ... CASCADE` over `information_schema.tables`) or a per-worker DB (`vitest` `poolOptions.threads.singleThread` or a DB per worker id); `prisma.$transaction` cannot wrap the whole test without passing `tx` everywhere, so truncation is common |
| Node + Drizzle/Kysely | Same DB setup; `db.transaction(async tx => { ...; tx.rollback() })` per test when the code under test takes a `db` argument; else truncation |
| Python + SQLAlchemy | pytest fixture: connection → `begin()` → `Session(bind=conn, join_transaction_mode="create_savepoint")` → yield → rollback. Alembic `upgrade head` once per session |
| Django | `TestCase` (transaction per test, fast) for most; `TransactionTestCase` for concurrency/`on_commit`; `--parallel` creates a DB per worker; `--keepdb` speeds local runs; pytest-django equivalents |
| Rails | Transactional tests default; `parallelize(workers: :number_of_processors)` creates `app_test-N` DBs; `ActiveRecord::Base.connection.truncate_tables` or `database_cleaner` for system tests; `fixtures :all` is fine for tiny reference data, factories for the rest |
| Ecto | `Ecto.Adapters.SQL.Sandbox` with `:manual` mode and `checkout` per test; `async: true` works with ownership |
| Go | `testcontainers-go` or a CI service; one migrated DB, `TRUNCATE` helper between tests, or a schema per package (`CREATE SCHEMA pkg_x; SET search_path`); `t.Cleanup`; `sqlc`-generated code tested directly; `dockertest` as an alternative |
| Java/Spring | Testcontainers `@Container PostgreSQLContainer`, `@DynamicPropertySource`; `@Transactional` on test classes for rollback; `@Sql` scripts for setup; Flyway runs on context start; Hibernate statistics for query counts |
| PHP/Laravel | `RefreshDatabase` (migrates once, wraps tests in transactions); `DatabaseTruncation` for Dusk; `.env.testing` pointing at a real MySQL/Postgres, not SQLite, unless production is SQLite |
| Rust | `sqlx::test` macro creates a database per test and runs migrations automatically; `testcontainers` crate |
| .NET | Testcontainers for .NET or Respawn for resetting; EF `EnsureCreated` is not migrations; use `Migrate()` |
| Mobile (Room, Core Data, SQLDelight) | In-memory SQLite per test is correct here because production is SQLite; Room `MigrationTestHelper` for migration tests |

## 10. Anti-patterns

- **Mocked repositories as the only persistence tests.** Fix: at least
  one integration test per repository method against the real engine.
- **SQLite standing in for Postgres/MySQL.** Fix: Docker service.
- **`synchronize`/`create_all`/`db push` to build the test schema.**
  Migrations are untested until production. Fix: run migrations.
- **Shared mutable fixtures** loaded once and modified by tests. Fix:
  factories per test, isolation per test.
- **Tests that pass only in order** (one test's leftover row satisfies
  another's assertion). Fix: randomize order (`pytest-randomly`, Rails
  default, `--shuffle`), fix leaks.
- **Sleeping to wait for the database** in tests of async behavior. Fix:
  poll with a timeout or use the framework's synchronous hooks.
- **Asserting on generated SQL strings** instead of behavior and query
  counts. Brittle; prefer `assertNumQueries` plus a correctness check.
- **Seeds that are copies of production.** PII in every developer laptop.
  Fix: anonymize or generate.
- **Ignoring the test DB's version.** Running `postgres:latest` in CI
  while production is 14 (or the reverse) hides syntax and planner
  differences. Pin the tag to production's major version.
