# Reviewing tests

Tests are the part of a PR that tells you what the author believed
mattered, and the part most reviewers skip. This file covers what makes a
test worth having, the test smells and their fixes, coverage as a signal
rather than a target, how to review a flaky test, when property-based and
table-driven tests are the better shape, and how to read test names and
structure. UI-specific testing (Testing Library, Playwright) is in
`frontend/references/testing.md`; API and integration test design is in
`backend/references/testing.md`.

## Contents

1. What a good test does
2. Reading tests as a reviewer
3. Test smells
4. Coverage: signal, not target
5. Flaky tests
6. Table-driven and property-based tests
7. Mocks, fakes, stubs: what to allow
8. Test names and structure
9. Reviewing test changes in a behavior PR
10. Reviewing tests written by an AI

## 1. What a good test does

A good test fails when the behavior it names is broken, passes otherwise,
and when it fails tells you what broke without a debugger. Everything
else follows:

- **It tests behavior through the public surface.** Inputs in, outputs or
  observable effects out. It does not know how the function is
  implemented, so the implementation can change without the test
  changing.
- **It is deterministic.** Same result every run, in any order, on any
  machine, at any time of day.
- **It is independent.** No shared mutable state with other tests; it
  sets up what it needs and cleans up (or uses a fresh fixture).
- **It is specific.** One behavior per test, named for that behavior.
  When it fails, the name is the bug report.
- **It is fast enough to run on every change.** Unit tests in
  milliseconds; integration tests in seconds; anything slower is tagged
  and run separately.
- **Its assertions are strong.** It asserts the actual result, not that
  something was called or that no exception occurred.

## 2. Reading tests as a reviewer

Read tests before the implementation (`review-methodology.md` Pass 1).
For each test, answer:

1. **What behavior does this pin?** If you cannot say in one sentence,
   the test is unclear or is testing several things.
2. **Would it fail if the feature were broken?** Imagine the obvious bug
   (off by one, wrong field, missing branch). Does any assertion catch
   it? If the only assertion is "mock was called" or "no exception",
   probably not.
3. **What inputs are exercised?** List them. Compare against the inputs
   you would expect from the branches in the implementation: empty,
   one, many, boundary, invalid, duplicate, unicode, concurrent.
4. **What is mocked, and is the mock the thing under test in disguise?**
   A test of `OrderService.create` that mocks `OrderRepository.insert`
   and asserts it was called with the order has tested nothing but the
   glue.
5. **Does the test name match the assertion?** `test_handles_empty_list`
   that asserts on a list of three is lying.

The output of this pass is a list of covered behaviors and a list of
uncovered ones that matter. The second list is where the bugs are.

## 3. Test smells

### Asserting the implementation

```python
# smell: pins how, not what
def test_send_welcome(mock_mailer):
    service.register(user)
    mock_mailer.send.assert_called_once_with(
        to=user.email, template="welcome_v2", context={"name": user.name, "plan": "free"}
    )
```

If someone renames the template or adds a context key, this fails with no
behavior change. If someone sends the wrong email to the right address,
it may pass. Better: a fake mailer that records sent messages, and an
assertion on the observable outcome.

```python
def test_registering_sends_a_welcome_email(fake_mailer):
    service.register(user)
    [msg] = fake_mailer.sent
    assert msg.to == user.email
    assert "Welcome" in msg.subject
```

### Mocking everything

```ts
// smell: every collaborator is a mock; the test exercises nothing real
jest.mock("../db"); jest.mock("../cache"); jest.mock("../validator"); jest.mock("../events");
test("create order", async () => {
  (validator.validate as jest.Mock).mockReturnValue(true);
  (db.insert as jest.Mock).mockResolvedValue({ id: 1 });
  await createOrder(input);
  expect(db.insert).toHaveBeenCalled();
});
```

This test passes for any implementation that calls `db.insert`. Prefer
in-memory fakes (a Map-backed repo, an in-process SQLite) over mocks for
collaborators you own; mock only the boundary you cannot run (third-party
HTTP, payment providers, the clock).

### Snapshot abuse

Snapshots are good for pinning large, stable, generated output
(rendered HTML of a static component, a serialized AST, a golden file
during a refactor). They are bad when:

- The snapshot is updated with `-u` whenever it fails, without reading
  the diff. The test then asserts "whatever the code does".
- The snapshot includes volatile data (timestamps, ids, ordering of a
  set).
- The snapshot is the only test of logic. A snapshot of a price
  calculation result does not say which case it covers.

Review comment: "This snapshot was updated in this PR; the diff changes
the total from 27.00 to 27.50. Is that intended? If so the test name
should say what rule produced it." Ask for an explicit assertion
alongside any snapshot that encodes logic.

### Sleeps and timing

```java
// smell
service.enqueue(job);
Thread.sleep(2000);
assertTrue(repo.findById(job.id).isDone());
```

Flaky under load, slow always. Fix: run the worker synchronously in tests,
or poll with a deadline (`Awaitility.await().atMost(5, SECONDS).until(...)`,
`waitFor` in Testing Library, `eventually` in Go test helpers, Python
`tenacity` or a loop with `time.monotonic()`), or inject a controllable
clock and scheduler.

### Order dependence and shared mutable fixtures

```ruby
# smell: test B passes only because test A ran first and created the user
describe Account do
  before(:all) { @user = User.create!(email: "a@b.c") }   # shared across tests, mutated by some
  it("A") { @user.update!(plan: "pro") ... }
  it("B") { expect(@user.plan).to eq("pro") }              # depends on A
end
```

Fix: `before(:each)` (fresh state per test), transactional tests, or
factories that build per test. Detect order dependence by running the
suite in random order (`pytest -p randomly`, `rspec --order rand`, `jest
--randomize`, `go test -shuffle=on`, JUnit `@TestMethodOrder(Random)`).

### Testing the framework or the language

`test_list_append_adds_item`, a test that a getter returns the field, a
test that the ORM saves a model. These pass forever and tell you nothing.
Delete or replace with a test of the behavior that uses them.

### Conditional logic in tests

```go
// smell: the test has branches, so some assertions may never run
func TestParse(t *testing.T) {
    for _, in := range inputs {
        out, err := Parse(in)
        if err != nil {
            if in.shouldFail { continue }
            t.Fatal(err)
        }
        if out != nil && out.Kind == "x" { assert.Equal(t, 1, out.N) }
    }
}
```

Tests should be straight-line. Branching means you do not know what was
asserted. Table-driven tests (section 6) with explicit expected values
per row fix this.

### Catching exceptions to make a test pass

```csharp
// smell
try { service.Process(bad); } catch { /* expected */ }
Assert.True(true);
```

If an exception is expected, assert the specific exception and its
message or type: `Assert.Throws<ValidationException>(() =>
service.Process(bad))`. If it is not expected, let it fail the test.

### Over-specified assertions

Asserting the entire JSON response when the test is about one field,
asserting on log output, asserting on the exact error message string when
the contract is the error type. These break on unrelated changes and
train authors to update tests without reading them. Assert on what the
test name promises.

### Tests with no assertion

Surprisingly common: a test that calls the function and asserts nothing,
relying on "it did not throw". Linters catch some (`jest/expect-expect`,
`pytest` with `--strict` plugins, `go vet` cannot). In review, every test
needs at least one assertion that could fail.

### Hidden test dependencies on environment

Tests that read real env vars, hit the real network, depend on the local
timezone (`new Date()` without a fixed zone), on the locale (number
formatting), on the filesystem layout, or on a file the developer has
locally. Inject the clock, the zone, the config; use temp dirs; block
network in unit tests (`pytest-socket`, `nock.disableNetConnect()`,
`httptest` servers in Go).

## 4. Coverage: signal, not target

Coverage tells you which lines ran, not whether anything was checked. A
suite with 95% coverage and weak assertions is worse than 70% with strong
ones, because it looks safe.

Use coverage as a reviewer to answer specific questions:

- **Did the new branches run?** Run the suite with coverage limited to
  the changed files: `pytest --cov=pkg.module`, `jest --coverage
  --collectCoverageFrom='src/orders/**'`, `go test -coverprofile=c.out
  ./orders/ && go tool cover -html=c.out`, `cargo llvm-cov`, JaCoCo
  report filtered to the package. Uncovered new lines are a concrete
  comment: "lines 40-48 (the retry path) are not exercised by any test."
- **Is a drop meaningful?** A 2% drop because a large generated file was
  added is noise. A drop in the module the PR changed is a question.

Do not ask for a coverage number. Ask for the specific uncovered case
that matters. Do not accept "coverage went up" as evidence of quality;
look at what the new tests assert.

Mutation testing is the better signal when it is available (`stryker`
for JS/TS/C#/Scala, `mutmut` or `cosmic-ray` for Python, `pitest` for
JVM, `cargo-mutants` for Rust, `go-mutesting`): if a mutant in the
changed code survives, the tests do not pin that behavior. Running it on
just the changed files is cheap enough for a high-risk PR.

## 5. Flaky tests

A flaky test is a test with a bug, or a test exposing a bug in the code.
Both deserve a fix, not a retry annotation. When a PR touches a flaky
test or adds a `@retry`, `retries: 3`, `@Flaky`, or
`--reruns`:

1. **Ask for the failure.** The actual assertion message from a failed
   run. "Flaky" without a failure message is not diagnosable.
2. **Classify.** Common causes, roughly by frequency:
   - Timing: sleeps, timeouts too tight, waiting for the wrong event.
   - Order dependence: shared state, global singletons, leaked mocks.
   - Concurrency in the code under test: a real race the test exposes.
   - Nondeterministic iteration: set/map ordering (Go maps, Python sets,
     Java HashMap), parallel collection.
   - Environment: time of day, timezone, locale, DST, leap day, port
     already in use, disk full on CI.
   - Resource leaks from earlier tests: unclosed connections, open
     handles, exhausted pools.
   - Random data without a fixed seed.
3. **Reproduce.** `pytest --count=50 -x` (pytest-repeat), `go test
   -count=100 -race`, `jest --testNamePattern x` in a loop, `rspec --seed
   <failing seed>`. Under `stress`/`nice` to change timing.
4. **Fix the cause**, not the symptom. A retry decorator on a test that
   exposes a real race in production code is hiding a production bug.

Review comment template: "should-fix: adding `retries: 3` here hides the
failure rather than fixing it. The failure in the CI log is
`expected 3 messages, got 2`, which looks like the consumer is checked
before the producer finishes (line 40 has no await on `flush()`). Await
the flush, or poll with a deadline, and remove the retry."

## 6. Table-driven and property-based tests

### Table-driven

When the same behavior is checked across many inputs, a table is clearer
than N copy-pasted tests and makes the missing row visible.

```go
func TestParseDuration(t *testing.T) {
    cases := []struct {
        name    string
        in      string
        want    time.Duration
        wantErr bool
    }{
        {"seconds", "30s", 30 * time.Second, false},
        {"minutes", "5m", 5 * time.Minute, false},
        {"compound", "1h30m", 90 * time.Minute, false},
        {"empty", "", 0, true},
        {"negative", "-5s", 0, true},
        {"unit missing", "5", 0, true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := ParseDuration(tc.in)
            if (err != nil) != tc.wantErr { t.Fatalf("err = %v, wantErr %v", err, tc.wantErr) }
            if got != tc.want { t.Errorf("got %v, want %v", got, tc.want) }
        })
    }
}
```

```python
@pytest.mark.parametrize("raw,expected", [
    ("1,000.50", Decimal("1000.50")),
    ("1.000,50", Decimal("1000.50")),   # EU format
    ("-0", Decimal("0")),
    ("", None),
], ids=["us", "eu", "negative-zero", "empty"])
def test_parse_money(raw, expected): ...
```

Reviewing a table: are the rows named? Is each row one case? Are the
boundary rows present (empty, zero, max, just-over, just-under)? Is there
a row for each branch in the implementation?

### Property-based

When the behavior is a law rather than a list of examples: round-trips
(`decode(encode(x)) == x`), invariants (`len(sort(xs)) == len(xs)`),
idempotence (`f(f(x)) == f(x)`), commutativity, equivalence with a
reference implementation (`new(x) == old(x)` during a refactor).

```ts
import fc from "fast-check";
test("money round-trips through formatting", () => {
  fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.constantFrom("USD", "JPY", "EUR"), (minor, cur) => {
    const m = { minor, currency: cur };
    expect(parseMoney(formatMoney(m))).toEqual(m);
  }));
});
```

Libraries: `fast-check` (JS/TS), `hypothesis` (Python), `proptest` and
`quickcheck` (Rust), `jqwik` and `kotest` property testing (JVM),
`rapid` and `gopter` (Go), `FsCheck` (.NET), `rantly` (Ruby),
`SwiftCheck`. When a property test finds a case, the shrunk
counterexample belongs in the table-driven test as a named row so the
regression is pinned deterministically.

Review question for property tests: is the generator realistic enough to
hit the interesting region (does it generate the empty case, the maximum,
unicode)? Is the property actually about the behavior, or trivially true?

## 7. Mocks, fakes, stubs: what to allow

| Collaborator | Prefer | Why |
|---|---|---|
| Your own database | Real (test container, SQLite in memory, transactional rollback) or an in-memory fake implementing the repository interface | Query behavior is where the bugs are |
| Your own services/modules | The real thing | Mocking them tests the wiring, not the behavior |
| Third-party HTTP (payment, email, maps) | Recorded responses (VCR, nock, WireMock, httptest) or a fake with the contract's shape | You cannot run them; recordings keep the shape honest |
| Clock, randomness, ids | Injected and controlled | Determinism |
| Filesystem | Temp directories (real) | Fast enough; fakes drift from real semantics |
| Message queues | In-memory implementation or the real broker in a container | Delivery semantics matter |
| Expensive computation | The real thing with small inputs | Mocking it hides algorithmic bugs |

Flag in review: a mock of something the test could have run for real; a
mock whose return value does not match the real collaborator's shape
(the test passes against a fiction); `verify`/`assert_called` as the
only assertion; mock setup longer than the test body (the design may need
a seam).

## 8. Test names and structure

The name is the specification and the failure message. It should say the
behavior and the condition, not the method name:

| Weak | Strong |
|---|---|
| `testCreate` | `creating an order with no items is rejected with EMPTY_ORDER` |
| `test_parse_1`, `test_parse_2` | `test_parse_rejects_negative_durations` |
| `it("works")` | `it("returns the cached value when the key is present and unexpired")` |
| `TestUserService` | `TestRegister_DuplicateEmail_ReturnsConflict` |

Structure: arrange, act, assert (or given/when/then), visibly separated.
One act per test. Assertions after the act only. Setup shared across
tests goes in a fixture or factory with a name that says what state it
produces (`an_expired_subscription()`, not `setup2()`).

Test file placement and naming follow the codebase (`__tests__/`,
`*.test.ts`, `*_test.go`, `test_*.py`, `spec/`). Deviations are a
consistency nit.

## 9. Reviewing test changes in a behavior PR

- **Tests deleted or weakened?** Look at `-` lines in test files first.
  An assertion removed or loosened (`toEqual` to `toBeDefined`, exact
  count to `> 0`) needs a reason in the description. If none, ask.
- **Tests skipped?** `xit`, `it.skip`, `@pytest.mark.skip`, `t.Skip`,
  `@Disabled`, `#[ignore]`. Each needs a ticket and a reason; a skip
  added in a feature PR usually means the feature broke something.
- **Expected values changed?** A snapshot or golden value changed in the
  same PR as the logic. Read the diff of the expectation; is the new
  value correct, and does the description say so?
- **Fixtures changed?** A shared fixture altered to make a new test pass
  can silently change what the old tests exercise.
- **New behavior with no new tests?** Name the test you expected:
  "should-fix: no test for the new `CANCELLED` transition; one that
  cancels a shipped order and asserts the rejection would pin it."

## 10. Reviewing tests written by an AI

LLM-written tests have characteristic weaknesses
(`reviewing-ai-generated-code.md` has the full list): asserting the
implementation's exact calls, mocking the thing under test, asserting
only that no exception was thrown, testing trivial getters, and
generating many near-duplicate tests that cover one path. Also:
expected values computed by re-running the same logic in the test
(`assert total == sum(i.price for i in items)` next to an implementation
that does exactly that), which pins nothing.

The quickest check: comment out the body of the function under test (or
return a constant) and run the tests. If they pass, they are not tests.
For a reviewer without a checkout, read each assertion and ask "what
implementation would make this fail?". If the answer is "almost none",
say so with the specific test name.
