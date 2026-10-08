# Error handling review

Error paths are where reviewers spend the least attention and where
production incidents spend the most. This file covers what to look for
when a diff adds, removes or changes error handling: swallowed errors,
catch-all handlers, error types and wrapping per language, messages for
humans versus logs, where retries belong, failing loud versus degrading,
resource cleanup constructs, and partial failure in batch and multi-step
operations. Resilience patterns (timeouts, circuit breakers, bulkheads)
and the error envelope for HTTP APIs are in `backend/references/
resilience.md` and `backend/references/api-design.md`.

## Contents

1. The questions to ask of every error path
2. Swallowed errors
3. Catch-all handlers
4. Error types, wrapping and context, per language
5. Messages: for the user, for the operator, for the log
6. Where retries belong
7. Fail loud or degrade: deciding
8. Resource cleanup constructs
9. Partial failure
10. Error handling in tests
11. Severity guide

## 1. The questions to ask of every error path

For each place the diff handles (or fails to handle) an error:

1. **Can this operation fail, and how?** Network, disk, parse, validation,
   permission, not-found, conflict, timeout, resource exhaustion. If the
   code assumes it cannot fail and it can, that is the finding.
2. **Who should know?** The caller (return or throw), the operator (log
   at the right level with context), the user (a message they can act
   on), a metric. Often more than one; never none.
3. **What state is left behind?** Half-written file, open transaction,
   lock held, partial batch, queued message for a failed write.
4. **Can the caller do anything with this error?** If yes, the error type
   must let them distinguish it (`NotFound` vs `Forbidden` vs
   `Transient`). If no, it should propagate without being caught here.
5. **Is the handling at the right layer?** Low layers add context and
   propagate; the layer that owns the user interaction or the retry
   policy decides. Catching at the bottom and returning a default steals
   the decision from the layer that has the context to make it.

## 2. Swallowed errors

The error is caught and nothing meaningful happens.

```python
try:
    publish(event)
except Exception:
    pass                      # the event is gone; nobody knows
```

```js
fetchConfig().catch(() => {});     // config silently missing
```

```go
result, _ := strconv.Atoi(input)   // 0 on failure, indistinguishable from "0"
```

```java
try { file.close(); } catch (IOException e) { }   // sometimes fine, see below
```

```ruby
rescue StandardError
  nil
```

Variants that look like handling but are not:

- Logging at `debug` or `info` and continuing: invisible in production.
- Logging without the exception object or stack trace (`log.error("failed")`
  with no `exc_info=True`, no `%w`, no `e`): undebuggable.
- Logging and returning a default (`return []`, `return None`, `return
  false`, `return {}`): the caller cannot tell failure from an empty
  result, and fails later, elsewhere, confusingly.
- Catching and re-throwing a new error without the cause (`throw new
  Error("failed")` dropping `e`): the stack trace of the real problem is
  gone.
- `console.error(e)` in a code path that should propagate.

When swallowing is legitimate: the error truly does not matter and a
comment says why (`// best-effort metrics; never fail the request over
telemetry`); closing a resource after the main operation already failed
(and you log at debug); a known benign error (`FileNotFoundError` on
delete) with the specific type caught, not `Exception`.

Comment template: "should-fix: `except Exception: pass` on line 40 drops
the publish failure, so a broker outage silently loses events. At minimum
log at error with `exc_info=True` and a metric; better, let it propagate
so the job retries (the consumer is idempotent per line 12)."

## 3. Catch-all handlers

`except Exception`, `catch (Exception e)`, `catch (e)`, `rescue =>
e`, `catch Throwable`, `catch (...)`, `_ => ` in a match on error kinds.

Problems: they catch programming errors (`TypeError`, `NullPointer`,
`KeyError` from a typo) and treat them as runtime failures, hiding bugs;
they catch cancellation and interruption (`asyncio.CancelledError` is a
`BaseException` in 3.8+ for exactly this reason; Java `InterruptedException`
must re-set the interrupt flag; Go has no exceptions but `recover()`
catches everything including nil dereferences); they retry things that
can never succeed; they often sit at the wrong layer.

Acceptable catch-alls, each with a condition:

- At the top of a request handler or job, to translate any unhandled
  error into a 500 or a failed job *with full logging*, re-raising
  programming errors in development. This is the framework's job in most
  stacks; check it is not duplicated.
- At a thread or task boundary, to prevent one failure from killing the
  worker, *with logging and a metric*, and with cancellation re-raised.
- In a plugin or callback dispatcher, to isolate one plugin's failure
  from the others, *with the plugin identified in the log*.

In review: for each catch-all, ask which specific exceptions the author
expects. If they can name them, catch those. If they cannot, ask what
should happen on a `NullPointerException` here, and whether the handler
does that.

```python
# before
try:
    user = fetch_user(uid)
except Exception as e:
    logger.warning("fetch failed: %s", e)
    user = None

# after: the expected failures are named; bugs propagate
try:
    user = fetch_user(uid)
except (httpx.TimeoutException, httpx.ConnectError) as e:
    logger.error("user service unavailable uid=%s", uid, exc_info=True)
    raise UserServiceUnavailable(uid) from e
except UserNotFound:
    user = None
```

## 4. Error types, wrapping and context, per language

The common principle: an error should carry what happened (type), where
(stack or wrap chain), and the values that matter (ids, inputs), and
should be translated at module boundaries so callers depend on your error
types, not your dependencies'.

### Python

- Define a small hierarchy per module rooted at one base
  (`class BillingError(Exception)`; `class CardDeclined(BillingError)`).
  Callers catch the base or a specific child.
- Chain with `raise ... from e` so the original traceback is kept;
  `raise X` inside an `except` without `from` sets `__context__` but
  reads as an accident. `raise ... from None` only to deliberately hide.
- Catch specific types. `except Exception` per section 3.
- Never catch `BaseException` (swallows `KeyboardInterrupt`,
  `SystemExit`, `CancelledError`).
- Carry data on the exception as attributes, not only in the message.
- `logger.exception(...)` or `exc_info=True` when logging inside an
  `except`.

### JavaScript / TypeScript

- Throw `Error` subclasses (or `Error` with a `cause`), never strings or
  plain objects; stack traces and `instanceof` depend on it.
- `new Error("context", { cause: e })` (ES2022) preserves the chain.
- `catch (e: unknown)` in TS; narrow before using (`e instanceof
  MyError`, or a type guard). `e.message` on `unknown` is a type error
  for a reason.
- Async: every `await` can throw; every un-awaited promise needs
  `.catch`. `performance-and-concurrency-review.md` section 6.
- Express: async handler errors do not reach the error middleware
  without a wrapper (`express-async-errors`, Express 5, or `next(e)`).
- Distinguish operational errors (expected: validation, not found,
  timeout) from programmer errors (bugs); crash on the latter in
  services, do not try to continue.
- Result types (`neverthrow`, `ts-results`, Effect) are fine if the
  codebase already uses them; do not introduce a second convention.

### Go

- Return errors; do not panic for expected failures. `panic` is for
  programming errors and unrecoverable init.
- Wrap with context and `%w`: `fmt.Errorf("load user %d: %w", id, err)`.
  Without `%w`, `errors.Is`/`errors.As` cannot see through it.
- Do not wrap twice with the same message; the chain reads "load user:
  load user: ...". Each layer adds what it knows.
- Sentinel errors (`var ErrNotFound = errors.New(...)`) for callers to
  check with `errors.Is`; custom types with fields for `errors.As`.
- Check every error. `_ = f()` requires a comment. `errcheck` and
  `golangci-lint` catch the rest.
- `if err != nil { return err }` without wrapping is acceptable in thin
  layers; at a boundary (package public API), wrap or translate.
- `defer` the cleanup; check `Close()` errors on writers (a failed close
  on a file being written is a lost write).
- `recover()` only at goroutine tops and only with logging; never to
  implement control flow.

### Java / Kotlin

- Checked vs unchecked: match the codebase. Modern Java code leans
  unchecked with a small domain hierarchy; Spring translates.
- Always pass the cause: `throw new DomainException("...", e)`.
- Never catch `Throwable` or `Error` (`OutOfMemoryError` is not yours to
  handle).
- `InterruptedException`: either re-throw, or
  `Thread.currentThread().interrupt()` before handling. Swallowing it
  breaks cancellation.
- Do not use exceptions for flow control in hot paths (they are expensive
  on the JVM); `Optional`, sealed results, or a check.
- Kotlin: no checked exceptions; `runCatching` returns `Result` and
  catches everything including `CancellationException` (a known pitfall
  in coroutines; rethrow it). `Result` from the stdlib is not meant as a
  return type for domain errors; sealed classes are.
- Kotlin coroutines: exceptions in `launch` propagate to the parent scope
  and cancel siblings unless a `SupervisorJob` is used; `async` defers
  the exception to `await`. Check the author knows which they have.

### Rust

- `Result<T, E>` everywhere; `?` to propagate. `unwrap()`/`expect()` only
  where failure is a bug (and `expect` with a message saying why it
  cannot fail) or in tests and prototypes.
- Library code: a concrete error enum (`thiserror`) so callers can
  match. Application code: `anyhow`/`eyre` with `.context("...")` is
  fine.
- `Box<dyn Error>` in public library APIs loses the ability to match;
  prefer an enum.
- `map_err` with a closure that drops the source loses the chain;
  implement `source()` or use `#[from]`/`#[source]`.
- Panics in library code (indexing, `unwrap` on user input) are a bug.
  `clippy::unwrap_used`, `clippy::expect_used`, `clippy::panic` as lints.
- `let _ = fallible();` ignores a `Result`; needs a comment. `#[must_use]`
  on `Result` warns by default; check warnings are not suppressed.

### Ruby

- `rescue => e` catches `StandardError`, which is right; `rescue
  Exception` catches `SignalException` and `SystemExit` and is almost
  always wrong.
- Define a module hierarchy (`class MyApp::Error < StandardError`).
- `raise CustomError, "msg"` inside a `rescue` keeps `cause`
  automatically.
- `retry` inside `rescue` with no counter is an infinite loop.
- Rails: `rescue_from` in controllers for translation; do not rescue in
  models to return `nil`.
- `ensure` for cleanup; a `return` inside `ensure` swallows the
  exception.

### PHP

- Exceptions over error codes and `false` returns in new code; wrap
  legacy `false`-returning calls at the boundary.
- `catch (\Throwable $e)` catches `Error` (type errors, OOM); usually you
  want `\Exception` or a specific type.
- Pass `$previous` to the constructor to keep the chain.
- `@` error suppression is a swallowed error.
- Laravel: report via the handler; do not `Log::error($e->getMessage())`
  without the exception object (`Log::error('...', ['exception' => $e])`
  or `report($e)`).

### Swift

- `throws` and `do/catch`; typed throws (Swift 6) when the codebase has
  adopted them. `try?` discards the error (a swallow); `try!` crashes.
  Each `try?` needs a reason.
- `Result<T, E>` for stored or async-callback outcomes.
- Catch specific cases (`catch NetworkError.timeout`) before a general
  `catch`.
- Do not use `fatalError` for recoverable conditions; `precondition` for
  programmer errors.

### C#

- Throw exception types from the domain; pass `innerException`.
- `catch (Exception)` with `throw;` (not `throw ex;`, which resets the
  stack) to log and rethrow.
- `when` filters (`catch (HttpRequestException e) when (e.StatusCode ==
  ...)`) instead of catch-and-rethrow.
- `async void` swallows exceptions into the void; never outside event
  handlers.
- `OperationCanceledException` should propagate on cancellation, not be
  logged as an error.
- Do not use exceptions for expected validation outcomes in hot paths;
  `TryParse` patterns or result objects.

### SQL and stored procedures

- Transactions: an error mid-transaction must roll back; check the
  client code's `try/finally` or `with transaction` wraps the whole unit.
- `ON CONFLICT DO NOTHING` silently drops rows; is that intended?
- Stored procedure `EXCEPTION WHEN OTHERS THEN NULL` is the SQL
  swallow.

## 5. Messages: for the user, for the operator, for the log

Three audiences, three messages, and the diff should not conflate them.

**User-facing:** says what happened in their terms and what they can do.
No stack traces, no internal names, no "an error occurred". Not a
security leak ("user not found" vs "wrong password" enables enumeration;
`security/references/authn-authz-threats.md`). Stable enough to be
translated and tested. The UI copy itself is `design`'s territory; the
review question is whether the code produces the right category of
message.

**Operator-facing (API error responses, CLI output):** a stable machine-
readable code, a human-readable message, and a correlation id. For HTTP,
RFC 9457 problem details; `backend/references/api-design.md`.

**Log:** everything needed to debug without reproducing: the exception
with stack, the operation, the identifiers (request id, user id, order
id), the inputs that matter (redacted of secrets and PII:
`security/references/logging-privacy.md`), the attempt number if retried.
Structured fields over string interpolation so they can be searched.

Review the level: `error` for things that need action, `warn` for
degraded-but-handled, `info` for expected events, `debug` for diagnosis.
A `warn` for every 404 floods; an `info` for a failed payment hides.

```python
# before: one message for all three audiences
raise Exception(f"DB error: {e}")   # shown to user, logged without stack, no id

# after
logger.error("order.create failed", extra={"order_id": oid, "user_id": uid}, exc_info=True)
raise OrderCreationFailed(order_id=oid) from e        # handler maps to 503 + problem details + request id
# UI shows: "We couldn't place your order. Nothing was charged. Try again in a moment."
```

## 6. Where retries belong

Retries are a policy decision and belong at one layer, chosen
deliberately:

- **At the client/library layer** for transport-level transient failures
  (connection reset, 503, 429 with `Retry-After`), with backoff and
  jitter and a budget. Most HTTP clients and SDKs offer this; do not
  reimplement it per call.
- **At the job layer** for whole-unit retries (the job runner re-runs the
  job), which requires the job to be idempotent.
- **Never at both** without knowing: three client retries inside three
  job retries is nine attempts and a thundering herd.
- **Never on non-transient errors:** validation, 4xx other than 429/408,
  `NotFound`, permission, deserialization. Retrying a bad payload five
  times is five times the load for the same failure. Check the retry
  condition names the transient types.
- **Never around a non-idempotent operation** without an idempotency key
  (`performance-and-concurrency-review.md` section 9).
- **Never without a cap and a dead-letter path.**
- **Timeouts come first.** A retry without a timeout on the attempt can
  hang forever on the first try. `backend/references/resilience.md`.

```ts
// before: retries everything, including the validation error thrown on line 3
await retry(() => processWebhook(payload), { retries: 5 });

// after: validate outside; retry only transient
const event = parseWebhook(payload);              // throws ValidationError, no retry
await retry(() => deliver(event), {
  retries: 5,
  retryIf: (e) => e instanceof TransientError || isRetryableStatus(e),
  backoff: exponentialJitter({ base: 200, max: 10_000 }),
});
```

## 7. Fail loud or degrade: deciding

Neither is always right. The question is what the user and the business
lose in each case.

**Fail loud (propagate, 5xx, crash the job) when:** correctness depends
on this operation (payment, auth, data write); continuing would persist
wrong data; the failure is a bug that should page someone; the caller has
a retry mechanism that will handle it better than you can here.

**Degrade (fallback, cached value, feature off, empty section) when:** the
feature is optional (recommendations, avatars, analytics); a stale or
partial answer is better than none for this user; the fallback is
explicitly designed and tested, not an accident of a swallowed error; the
degradation is visible to operators (metric, warn log) so it is not
permanent by neglect.

Review check: every fallback has a metric or log at warn, a test of the
fallback path, and a comment stating that degradation is intended. A
fallback with none of those is a swallowed error with better PR.

```go
// degrade deliberately: recommendations are optional, and we can see it happen
recs, err := recoClient.For(ctx, userID)
if err != nil {
    metrics.Inc("reco.fallback", "reason", errKind(err))
    log.Warn("recommendations unavailable, serving none", "user", userID, "err", err)
    recs = nil
}
```

## 8. Resource cleanup constructs

Every acquire has a release that runs on the exception path. The
language gives you a construct; the review checks it is used and that
the cleanup itself cannot mask the original error.

| Language | Construct | Pitfalls |
|---|---|---|
| Python | `with` / `async with`; `contextlib.ExitStack` for dynamic sets; `try/finally` | `finally` that raises hides the original; `return` in `finally` swallows exceptions |
| JS/TS | `try/finally`; `using` / `await using` (explicit resource management, TS 5.2+); `finally` on promises | `finally` block that throws; streams need `destroy` not just `end` |
| Go | `defer`; `defer func() { if cerr := f.Close(); err == nil { err = cerr } }()` for writers | `defer` in a loop runs at function end; `defer` evaluates args immediately |
| Java | try-with-resources (`AutoCloseable`); `finally` | Suppressed exceptions from close are attached, check `getSuppressed()`; `finally` with `return` |
| Kotlin | `use {}`; `try/finally`; `runCatching` caveats | `use` on non-`Closeable` |
| Rust | RAII / `Drop`; scoped guards | `Drop` cannot return errors; explicit `close()?` for fallible flush; `mem::forget` |
| C# | `using` / `await using` (`IDisposable`/`IAsyncDisposable`); `finally` | Disposing something still referenced; `Dispose` throwing |
| Ruby | block-form APIs (`File.open {}`); `ensure` | `return` in `ensure`; `ensure` raising |
| PHP | `finally`; destructors (unreliable timing) | Destructors on fatal errors |
| Swift | `defer` | `defer` order (reverse); not for error-dependent cleanup |

Review check: for each acquire, point to the release; confirm it is in
the construct; confirm an error in the release does not hide an error in
the main operation (log it, attach it, or ignore it deliberately with a
comment).

## 9. Partial failure

Any operation over many items or many steps can half-succeed. The diff
should say what happens then; if it does not, ask.

**Batches** (process 1000 rows, send 50 emails, import a CSV):

- Fail fast (stop at first error, roll back what you can) or continue
  (process the rest, collect failures)? Either is fine; it must be
  deliberate and the caller must learn which items failed and why.
- Result shape: `{succeeded: [...], failed: [{id, error}]}`, not a
  boolean.
- Transactional or not? One transaction over 1000 rows holds locks and
  may time out; per-row transactions mean partial state is normal and
  must be re-runnable (idempotent).
- Progress and resumability for long batches: a cursor or checkpoint so a
  crash does not restart from zero.

**Multi-step operations** (charge card, then create order, then send
email):

- Which steps are reversible? Order the steps so the irreversible one
  (charge) is as late as possible and everything after it is retryable.
- What if step 2 fails after step 1 succeeded? Compensation (refund),
  retry (with idempotency), or a saga/outbox pattern (`backend/
  references/jobs-and-async.md`). "Nothing" is the wrong answer and the
  most common one.
- Is the state recorded between steps so a crash can resume or
  reconcile? A `status` column with `charged`, `created`, `notified`.

```python
# before: a failure in step 3 leaves a charged, unrecorded order
charge = stripe.charge(amount, idempotency_key=key)
order = Order.create(charge_id=charge.id)
mailer.send_confirmation(order)       # SMTP down -> exception -> order created, user never told, retry charges again? (no, key) but creates a second order

# after: record state; make downstream steps retryable and idempotent
order = Order.create(status="pending", idempotency_key=key)   # unique constraint on key
charge = stripe.charge(amount, idempotency_key=key)
order.mark_charged(charge.id)
enqueue(send_confirmation, order.id)  # job retries independently; order is already consistent
```

**Concurrent fan-out** (`Promise.all`, `asyncio.gather`, `errgroup`): one
failure cancels or does not cancel the rest, depending on the primitive.
`Promise.allSettled` and `gather(return_exceptions=True)` continue;
`Promise.all` and `errgroup.Go` short-circuit (and `errgroup` cancels the
context). Check the author chose on purpose and handles both outcomes.

## 10. Error handling in tests

- Every error path in the diff that matters has a test that triggers it
  (inject the failure: a fake that throws, a closed connection, an
  invalid input) and asserts the observable outcome (the right error
  type to the caller; the right state left behind; the log or metric if
  that is the contract).
- Tests that assert on error message strings couple to copy; assert on
  type or code unless the message is the contract.
- Cleanup tests: after a failure, the resource is released (the file
  handle count, the pool's active count, the lock is free).
- `reviewing-tests.md` for the general treatment.

## 11. Severity guide

| Finding | Severity |
|---|---|
| Error swallowed on a path that affects correctness or data | blocking |
| Error swallowed on a best-effort path with no log or metric | should-fix |
| Catch-all that hides programming errors and continues | should-fix; blocking if it also retries or writes |
| Cause/chain dropped on rethrow | should-fix |
| Resource not released on the exception path | should-fix; blocking for connections, locks, and in hot paths |
| Retry on non-transient errors | should-fix |
| Retry around a non-idempotent side effect | blocking |
| Multi-step operation with no handling for mid-sequence failure involving money or irreversible effects | blocking |
| Batch with no per-item failure reporting | should-fix |
| User sees internal details or stack traces | should-fix; blocking if it leaks secrets or enables enumeration |
| Log level wrong (error for expected, debug for failures) | nit; should-fix if it hides incidents |
| Unchecked error return (Go `_`, Rust `let _`, ignored `Result`) | should-fix unless commented |
| `catch Throwable` / `except BaseException` / `rescue Exception` | should-fix |
| Blocking `InterruptedException` or `CancellationException` swallowed | should-fix |
