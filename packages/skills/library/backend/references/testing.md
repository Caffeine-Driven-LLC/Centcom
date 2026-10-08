# Testing backend code

A taxonomy that matches how backends actually fail, why the database in
integration tests should be real (and how to make that fast), what to mock
and what never to mock, contract tests against OpenAPI/proto/GraphQL
schemas and against consumers, fixtures and factories, controlling time
and randomness, the test cases every endpoint and job needs, and keeping
CI under ten minutes.

## Contents

1. Taxonomy for backends
2. The real-database rule
3. What to fake, and how
4. HTTP-level tests: the cases every endpoint needs
5. Use-case and domain tests
6. Job tests
7. Contract tests
8. Fixtures and factories
9. Time, randomness, IDs, and other non-determinism
10. Test data isolation and parallelism
11. CI speed
12. Flaky tests
13. Anti-patterns with fixes

## 1. Taxonomy for backends

| Level | Scope | Real DB? | Real network? | Speed | Share |
|---|---|---|---|---|---|
| Unit | Domain rules, pure functions, policy decisions, mappers, parsers | No | No | ms | Many; cheap; where logic lives |
| Use-case / service | One use case with real DB and fake external services | Yes | No (fakes) | 10-100 ms | The core of the suite |
| HTTP / handler | Route through the real app (middleware, validation, serialization, error mapping) | Yes | No | 10-100 ms | One per endpoint × key cases |
| Contract | Response/request shapes vs OpenAPI/proto/GraphQL; provider vs consumer expectations | Sometimes | No | fast | Per contract |
| Integration with real dependency | Real broker/cache/third-party sandbox | Yes | Yes | s | A few; nightly or gated |
| End-to-end | Deployed system, real flows | Yes | Yes | s-min | A handful of critical paths |

The old "pyramid" over-weights unit tests for backends; most backend bugs
are at the seams (query returns wrong rows, transaction does not roll
back, validation lets a shape through, error maps to the wrong status).
Weight the middle: use-case and HTTP tests against a real database are
the best value per line. Unit tests for genuinely complex domain logic
(pricing, permissions, state machines) and parsers.

## 2. The real-database rule

Integration tests run against the same database engine as production
(Postgres in prod → Postgres in tests, same major version). Not SQLite,
not H2, not an in-memory fake, not a mocked repository. Reasons: SQL
dialects differ (JSON functions, constraints, `RETURNING`, case
sensitivity, transaction semantics), ORMs generate different SQL per
dialect, and a mocked repository tests your mock. The AI failure mode is
mocking `prisma.order.create` and asserting it was called; that test
passes while the real query fails on a constraint.

How to make it fast:

- **Testcontainers** (Node `testcontainers`, Python `testcontainers`, Go
  `testcontainers-go`, Java `testcontainers` + Spring `@ServiceConnection`,
  Ruby via docker-compose, Rust `testcontainers`) starts one Postgres per
  test run (not per test). Or a `services:` block in CI and a local
  `docker compose up db`.
- **One schema migration per run**, then per-test isolation via one of:
  a transaction opened before each test and rolled back after (fastest;
  Django's `TestCase`, Rails transactional tests, SQLAlchemy session
  rollback, Spring `@Transactional` tests, Prisma needs a wrapper or
  per-test truncate); `TRUNCATE ... CASCADE` of all tables between tests
  (~5-20 ms); template databases cloned per test (`CREATE DATABASE test_x
  TEMPLATE test_template`, what `#[sqlx::test]` and `pytest-django --reuse-db`
  style tools do; good for parallel workers).
- **Tune the test Postgres**: `fsync=off`, `synchronous_commit=off`,
  `full_page_writes=off`, tmpfs data dir. Fine for tests, never for prod.
- **Reuse the container** locally (Testcontainers reuse flag, or a
  long-running `docker compose` DB) so the 3 s startup is paid once a day.

Rollback-per-test has one caveat: code that relies on `after_commit`
hooks or `READ COMMITTED` visibility from another connection (jobs,
outbox relays) will behave differently; use truncate isolation for those
tests.

Redis, queues, object storage: the same rule applies when the behavior
matters (Lua scripts, `SET NX` semantics, S3 multipart). Testcontainers
has modules for Redis, LocalStack, RabbitMQ, Kafka. For simple
get/set usage a fake (`ioredis-mock`, `fakeredis`, `miniredis`) is
acceptable in unit tests.

## 3. What to fake, and how

Fake (with a hand-written fake or a recorded stub) the boundaries you do
not own and cannot run locally: third-party HTTP APIs, email/SMS
providers, payment gateways, external identity providers, the clock, the
random source. Do not fake your own database, your own queue (except in
unit tests of enqueue logic), or your own modules.

Prefer **fakes** (a small in-memory implementation of the interface that
records calls and can be told to fail) over **mocks** (expectation-based
`expect(x).toHaveBeenCalledWith`). Fakes test behavior ("the email was
recorded with this recipient"); mocks test implementation ("this method
was called with these args") and break on refactors.

```ts
export class FakeMailer implements Mailer {
  sent: Email[] = []; failNext: Error | null = null;
  async send(e: Email) { if (this.failNext) { const err = this.failNext; this.failNext = null; throw err; } this.sent.push(e); }
}
```

For outbound HTTP, stub at the HTTP layer so the real client code
(serialization, headers, timeout, retry) runs: `msw`/`nock` (Node),
`respx`/`responses` (Python), `httptest.NewServer` (Go), WireMock/
MockServer (Java), `webmock`/`vcr` (Ruby), `Http::fake` (Laravel),
`wiremock` crate (Rust). Configure the stub library to fail on unexpected
requests so a new call path cannot silently hit production APIs.

Recorded fixtures (VCR style) for complex providers: record once against
the sandbox, commit the cassettes, scrub secrets, refresh on a schedule.

## 4. HTTP-level tests: the cases every endpoint needs

For each endpoint, through the real app (no port needed: `supertest`,
`app.inject`, `httpx.AsyncClient(transport=ASGITransport)`, Django test
client, `httptest.NewRecorder`, MockMvc/WebTestClient, Rails request
specs, Laravel `postJson`, `tower::ServiceExt::oneshot`):

1. **Happy path**: status, `Content-Type`, `Location` on 201, body shape
   (assert on fields you promise, tolerate extras), and the database state
   after (the row exists with the right values; not just the response).
2. **Validation failure**: malformed body (400), semantically invalid
   (422), the error envelope shape, a field-level error pointing at the
   right field, `requestId` present.
3. **Unauthenticated** (401) and **forbidden** (403 or 404 per the repo's
   convention): another user's resource, a missing permission.
4. **Not found** (404) with a well-formed but nonexistent ID; **malformed
   ID** (400 or 404, be consistent).
5. **Idempotency**: same `Idempotency-Key` twice → same response, one row;
   different body with same key → 422.
6. **Concurrency** where it matters: two parallel requests that should
   produce one effect (unique constraint, lock) → one succeeds, one 409.
7. **Pagination**: `limit` above max is clamped, cursor round-trips, the
   last page has `hasMore: false`, items are not duplicated or skipped
   across pages (insert between page fetches).
8. **Side effects**: the expected job was enqueued (with payload asserted)
   and nothing else; the outbox row exists; the email fake has one entry.
9. **Query count** for list endpoints: assert a bound (Django `assertNumQueries`,
   Rails `assert_queries`/`db-query-matchers`, Prisma/pg query log
   counting, Spring `datasource-proxy`, Laravel `expectsDatabaseQueryCount`)
   so N+1 regressions fail CI.
10. **Headers**: `X-Request-Id` echoed; `Cache-Control` set as intended;
    CORS for a cross-origin client if applicable.

Assert on behavior visible to clients and on persisted state, not on
internal calls.

## 5. Use-case and domain tests

Use-case tests call the service function with a real DB and fakes, and
cover each branch of business logic: the success path, each named domain
error (`InsufficientStock`, `OrderNotCancellable`), the authorization
denial, transaction rollback on failure (assert the first write is gone
when the second fails), and the "run twice" case for idempotent
operations.

Domain tests are pure: a pricing function with a table of inputs and
expected outputs; a state machine with every legal and illegal
transition; a policy function with an actor × resource × expected matrix.
Property-based tests (`fast-check`, `hypothesis`, `gopter`/`rapid`,
`jqwik`, `proptest`) for parsers, serializers, and anything with an
invariant ("decode(encode(x)) == x", "total never negative").

## 6. Job tests

- Handler as a function: call it with a payload; assert effects on DB
  and fakes. Include: run twice (same effect once), referenced row deleted
  (discard, not retry), transient failure (raises the retryable type),
  permanent failure (raises the non-retryable type).
- Enqueue: at the use-case level, assert the job type and payload with
  the queue faked; and one test that the enqueue happens *after commit*
  (fail the transaction after the enqueue call; assert the queue is empty).
- Scheduling: parse the cron expression; assert the tick enqueues the
  expected job with the period key; do not sleep.
- One real-broker test per queue technology in CI (Redis/Postgres
  container) that enqueues, runs a worker for a bounded time, and asserts
  the effect; catches serialization and config bugs eager mode hides.

## 7. Contract tests

Three kinds, use the ones that match the repo:

- **Schema conformance**: validate every response in HTTP tests against
  the OpenAPI spec (`jest-openapi`, `openapi-response-validator`,
  `schemathesis` which also fuzzes, `openapi-core`, `kin-openapi`
  `ValidateResponse`, `springdoc` + `swagger-request-validator`, `rswag`,
  `spectator` for Laravel). For gRPC, the proto *is* the contract; `buf
  breaking` in CI detects incompatible changes. For GraphQL, `graphql-
  inspector`/`graphql-schema-linter` diff the schema and flag breaking
  changes.
- **Breaking-change detection**: diff the generated/committed spec against
  the main branch (`oasdiff breaking`, `buf breaking`, `graphql-inspector
  diff`) and fail CI on removals, type changes, or new required fields.
- **Consumer-driven contracts** (Pact, Spring Cloud Contract): consumers
  publish the interactions they rely on; the provider's CI verifies it
  still satisfies them. Worth it when several teams own clients and
  services; overkill for one team with a monolith. Snapshot tests of JSON
  responses are a cheap approximation if reviewed with care.

## 8. Fixtures and factories

Factories (`factory_bot`, `factory_boy`, `fishery`/`@faker-js/faker` +
small builder functions, Laravel factories, Instancio or hand-built
builders in Java, `fake`/`proptest` in Rust) build valid objects with
sensible defaults and let a test override only what matters:

```python
class OrderFactory(factory.django.DjangoModelFactory):
    class Meta: model = Order
    customer = factory.SubFactory(UserFactory)
    status = Order.Status.PENDING
    currency = "USD"

order = OrderFactory(status=Order.Status.PAID, customer=alice)   # only what the test is about
```

Rules: defaults produce a *valid* object that satisfies all constraints;
avoid shared global fixture files (`fixtures.json` with 40 interdependent
rows) because every test depends on everything; build only what the test
needs; use traits/variants for common shapes (`:paid`, `with_items(3)`);
make the test readable from its setup (a reader should see what differs
from default). Seed faker with a fixed seed per test run for
reproducibility, and print the seed on failure.

Builders for request payloads too (`validOrderPayload({ items: [] })`),
so validation tests mutate one field from a known-valid base.

## 9. Time, randomness, IDs, and other non-determinism

- **Clock**: inject it. A `clock: () => Date` dependency, a `Clock`
  interface (Java `java.time.Clock`, Go `func() time.Time`), or library
  faking (`vi.useFakeTimers`/`vi.setSystemTime`, `freezegun`/`time-machine`,
  Rails `travel_to`, Laravel `travelTo`, `tokio::time::pause`). Never
  `sleep` in tests to wait for time-based behavior; advance the fake
  clock.
- **Randomness**: inject the RNG (`Random` seeded, `rand.New(rand.NewSource
  (1))`, `random.Random(42)`) or stub the generator. Security randomness
  (tokens) can stay real; assert on properties (length, charset), not
  values.
- **IDs**: UUIDv7/ULIDs are time-based; assert on shape, or inject the ID
  generator when the test needs a known ID.
- **Ordering**: assert on sets or sort before comparing when the database
  does not guarantee order; or add an `ORDER BY` in the code if order is
  part of the contract.
- **Environment**: tests set their own config (a `.env.test` or an
  explicit config object); never read the developer's shell env. Fail
  loudly if `APP_ENV != test` to protect the real database.
- **Network**: block all outbound by default (stub library in strict mode;
  `nock.disableNetConnect()`, `respx(assert_all_mocked=True)`, WebMock's
  default).

## 10. Test data isolation and parallelism

Parallel workers each need their own database (or schema): `pytest-xdist`
with `--create-db` per worker (pytest-django does it), Rails
`parallelize(workers:)` creates `db_test-N`, Vitest/Jest workers with a
`DATABASE_URL` suffixed by worker ID and a template clone, Go `t.Parallel()`
with per-test schemas or template databases, `#[sqlx::test]` databases per
test. Never share one database between parallel workers with truncation;
they will truncate each other's data.

Within a worker, tests must not depend on each other's data or order
(`--shuffle`/`-shuffle=on`/`--random-order` in CI catches it). Clean up
in fixtures, not at the start of the next test.

## 11. CI speed

Target: the full backend suite under 10 minutes; the pre-merge subset
under 5. Techniques, in order of payoff:

1. Real database with rollback isolation and tuned Postgres (section 2).
2. Parallel workers (section 10), sized to CI CPU.
3. Container reuse and layer caching for the test DB image.
4. Split slow suites (real broker, e2e, contract fuzzing) into a separate
   job that runs in parallel or nightly.
5. Avoid full-context framework boot per test (Spring slices, FastAPI
   `TestClient` reuse, Rails `spring`/`bootsnap`, one `app` instance per
   file).
6. Cache dependencies and compiled artifacts (Go build cache, Cargo
   target, Gradle, `node_modules`).
7. Run only affected tests on PRs when the tooling supports it (Nx/
   Turborepo `affected`, `pytest-testmon`, Gradle test filtering), with
   the full suite on main.
8. Fail fast (`-x`, `--bail`) locally; never in CI (you want the full
   picture).

Keep a CI timing dashboard; a suite that creeps from 6 to 15 minutes does
so one test at a time.

## 12. Flaky tests

A flaky test is a bug in the test or in the code; quarantine and fix
within days, never `retry: 3` as a permanent fix. Usual causes in
backends: shared state between tests (database rows, module-level
singletons, env vars), real time (`setTimeout`, `sleep`, timestamps
compared with `now()`), unordered query results, port collisions, test
containers not ready (wait for a real readiness check, not a sleep), race
between a job worker and the test's assertion (await the job explicitly
or run inline), leaking connections hitting pool limits. Reproduce with
`--repeat`/`-count=50` and random order; the shuffle seed is your friend.

## 13. Anti-patterns with fixes

- **Mocking the database/ORM in integration tests.** Fix: real DB,
  rollback isolation.
- **SQLite/H2 in tests, Postgres/MySQL in prod.** Fix: testcontainers.
- **Asserting mocks were called** instead of effects. Fix: fakes; assert
  persisted state and responses.
- **One giant fixture file.** Fix: factories with defaults; build per
  test.
- **`sleep(2)` to wait for a job or a container.** Fix: await the effect;
  readiness checks; fake clock.
- **Tests that pass only in a given order.** Fix: random order in CI; fix
  shared state.
- **Only happy-path tests.** Fix: section 4's list for every endpoint.
- **Testing validation by calling the schema directly** and skipping the
  HTTP mapping. Fix: one HTTP test per endpoint for the error envelope.
- **No "run twice" test for retried operations.** Fix: add it to every
  idempotent write and every job.
- **Hitting the real third-party sandbox in the unit suite.** Fix: stubs
  in strict mode; nightly contract job.
- **Snapshotting entire responses including timestamps and IDs.** Fix:
  assert the fields you promise; redact or inject non-determinism.
- **Skipping the forbidden case** because "auth is tested elsewhere."
  Fix: one 403 test per endpoint; it is the test that catches the
  forgotten policy call.
- **`@SpringBootTest`/full app boot for every test.** Fix: slices and
  plain unit tests.
- **Retrying flaky tests in CI config forever.** Fix: quarantine, fix,
  delete the retry.
