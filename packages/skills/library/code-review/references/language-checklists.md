# Language-specific review checklists

Concise, high-signal checks that are specific to each language: the
footguns a generalist reviewer misses and a linter often does not catch.
Use these in the final pass after the correctness, risk and design passes.
Each item is phrased as something to look for in the diff. Generic items
(naming, tests, error handling in the abstract) live in the other
references and are not repeated here. Items are roughly ordered by how
often they cause production bugs.

## Contents

1. TypeScript / JavaScript
2. Python
3. Go
4. Java / Kotlin
5. Rust
6. Ruby
7. PHP
8. Swift
9. C#
10. SQL

## 1. TypeScript / JavaScript

1. Floating promises: async call without `await`, `return`, `.then`, or an explicit `void` marker; errors become unhandled rejections.
2. `forEach(async ...)` or `map(async ...)` without `Promise.all`: nothing is awaited.
3. `any` introduced (explicit or via `as any`, untyped `catch (e)`, `JSON.parse` result used without validation); `unknown` plus a type guard or schema (`zod`, `valibot`, `io-ts`) instead.
4. Non-null assertions (`x!`) and `as` casts hiding a real nullable; each needs a reason the type system cannot see.
5. `==` instead of `===` (except deliberate `== null`); `NaN` comparisons; `typeof x === "object"` passing `null`.
6. Truthiness checks on values where `0`, `""`, or `false` are valid (`if (count)` when count can be 0; `value || default` when `??` is meant).
7. Mutating function arguments or shared objects (`arr.sort()` sorts in place; `Object.assign(target, ...)`; spreading only one level deep when nested state is mutated).
8. Array `sort()` without a comparator on numbers (lexicographic: `[10, 9, 1]` sorts to `[1, 10, 9]`).
9. `for...in` over arrays (iterates keys as strings, including inherited); `for...of` or array methods.
10. Date handling: `new Date(string)` parsing is implementation-defined for non-ISO strings; month is 0-indexed in the constructor; local vs UTC methods mixed; `Date.now() - 7 * 86400000` for "a week" ignores DST and calendars.
11. Number precision: money in floats; `parseInt` without radix; integers above `2^53`; `toFixed` returns a string and rounds oddly.
12. `JSON.stringify` drops `undefined`, functions and `BigInt` (throws); `Map`/`Set` become `{}`; `Date` becomes a string that does not round-trip.
13. Optional chaining that hides a bug (`user?.id` where `user` should never be undefined); the `?.` silences the symptom.
14. `Object.keys`/`entries` on class instances or objects with prototype chains; `hasOwnProperty` vs `in`.
15. Regex with user input and no anchors or with catastrophic backtracking (`(a+)+`); the `g` flag making `test()` stateful across calls.
16. `setTimeout`/`setInterval`/event listeners without cleanup in components or long-lived objects.
17. Node: sync fs/crypto in request handlers; `process.exit` in library code; unhandled `error` events on streams and `EventEmitter`s crash the process; `Buffer` from untrusted size.
18. Module boundaries: barrel files (`index.ts` re-exporting everything) creating cycles and killing tree-shaking; `import * as` where named imports are available.
19. `enum` in TS (runtime object, odd with `const enum` and isolatedModules); a string union is often the better choice in codebases that already use unions.
20. Exhaustiveness: a `switch` over a union without a `default: assertNever(x)` or `satisfies never`; adding a member later silently falls through.
21. `interface` vs `type` consistency with the codebase; declaration merging surprises with `interface`.
22. Exported types that leak internal types or `any`; `Pick`/`Omit` on a type that later gains fields.
23. `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` state affects what the compiler catches; a diff that loosens them is a finding.
24. `eslint-disable` or `@ts-ignore`/`@ts-expect-error` added; each needs a justification comment and `@ts-expect-error` is preferred (it errors when no longer needed).
25. `await` inside a loop when iterations are independent, or `Promise.all` on an unbounded list (connection exhaustion).
26. Error subclassing: `class MyError extends Error` without `this.name = ...` and, on older targets, without `Object.setPrototypeOf`; `instanceof` across module boundaries or bundles can fail.
27. Environment access scattered (`process.env.X` deep in modules) instead of validated once at startup; `NEXT_PUBLIC_`/`VITE_` prefix leaking server secrets to the client bundle.
28. Browser: `innerHTML`/`dangerouslySetInnerHTML` with non-sanitized input (`security/references/xss-and-output-encoding.md`); `localStorage` for tokens; `window.open` without `noopener`.
29. React specifics (`frontend/references/react.md`): effects for derived state; missing dependency array entries silenced with a lint disable; state updates after unmount; keys from array index.
30. Package: `dependencies` vs `devDependencies` correct; `"type": "module"` and ESM/CJS interop (`default` import of a CJS module); `exports` map covering types.

## 2. Python

1. Mutable default arguments (`def f(items=[])`, `=dict()`, `=set()`): shared across calls.
2. `except:` or `except Exception:` catching too much; `except BaseException` swallowing `KeyboardInterrupt`/`SystemExit`/`CancelledError`.
3. `raise X` inside `except` without `from e` (loses explicit chain) or with `from None` (hides it deliberately; needs a reason).
4. Blocking calls inside `async def` (`requests`, `time.sleep`, sync DB drivers, file I/O on large files, CPU-bound loops).
5. Coroutine called without `await`; `asyncio.create_task` result not stored (task can be GC'd); `gather` without exception handling.
6. Late-binding closures in loops (`lambda: i` captures the last `i`); use a default argument or `functools.partial`.
7. `is` for value comparison (`x is 1`, `s is "a"`) and `==` for `None`/singletons; `is None` is correct.
8. Type hints that lie: `Optional` missing where `None` is returned; `list` where a generator is returned; `Any` creeping in; `# type: ignore` without a code.
9. `dict`/`list` mutation during iteration; `for k in d: del d[k]`.
10. String formatting of user input into SQL, shell, or log format strings (`f"SELECT ... {x}"`, `os.system(f"...")`, `logger.info(f"{user_input}")` where `%s` args are safer and lazy).
11. `subprocess` with `shell=True` and interpolated input; missing `timeout`; `check=True` absent so failures are silent.
12. `open()` without `with` or without `encoding=` (platform-dependent default); binary vs text mode confusion.
13. Datetime: naive vs aware mixed; `datetime.now()` vs `datetime.now(timezone.utc)`; `utcnow()` (deprecated, naive); `strptime` without timezone; `date` vs `datetime` comparison.
14. Float for money; `round()` uses banker's rounding; `Decimal` constructed from a float.
15. `import *`; circular imports solved with imports inside functions (sometimes right; needs a comment); module-level side effects at import time (DB connections, reading env).
16. Class attributes used as instance defaults for mutable values (`class A: items = []`).
17. `@property` doing I/O or raising; `__eq__` without `__hash__` (makes instances unhashable); `__repr__` leaking secrets.
18. `dataclass` with mutable default without `field(default_factory=...)`; `frozen=True` where it should be; `__post_init__` validation missing.
19. `assert` used for runtime validation (stripped under `-O`).
20. Global state and `global` keyword; module-level caches that grow unbounded; `functools.lru_cache` on methods (holds `self`, leaks) or with unbounded `maxsize=None` on user input.
21. Comprehension vs loop with side effects; `map`/`filter` with lambdas where a comprehension is clearer; `list(...)` materializing a generator that is iterated once.
22. Equality on floats in tests without `pytest.approx`/`math.isclose`.
23. Pickle/`yaml.load` without `SafeLoader`/`eval`/`exec` on anything external (`security/references/ssrf-and-server-side.md`).
24. Path handling with string concatenation instead of `pathlib`; `os.path.join` with an absolute second argument discarding the first; path traversal from user input.
25. `requests` without `timeout=` (hangs forever); session reuse absent in loops; `verify=False`.
26. Logging: `logger.error(f"...")` formatting eagerly and without `exc_info`; `print` in library code; root logger configured in a library.
27. Django: `objects.get()` without catching `DoesNotExist`/`MultipleObjectsReturned`; querysets evaluated in loops (N+1, `select_related`/`prefetch_related`); `.save()` in a loop instead of `bulk_update`; `@transaction.atomic` scope; raw SQL with `%` formatting; `CharField` without `max_length` rationale; signals hiding behavior; `settings.DEBUG` branches.
28. FastAPI/pydantic: `def` vs `async def` endpoint mismatch with blocking calls (sync `def` runs in a threadpool; async with blocking code stalls the loop); response models missing so internals leak; `Depends` with per-request resources not closed (`yield` dependencies).
29. Packaging: version pins in `pyproject.toml`/`requirements.txt`; `requirements.txt` without a lock; `setup.py` executing code.
30. Tests: `unittest.mock.patch` target is where the name is looked up, not where it is defined; `patch` without `autospec=True` accepts any call; fixtures with module scope mutated by tests; `time.sleep` in tests.

## 3. Go

1. Unchecked errors: `_ = f()`, `f()` with a discarded return, `defer f.Close()` on a writer where the close error matters.
2. Error wrapping without `%w` (`fmt.Errorf("...: %v", err)` breaks `errors.Is/As`); wrapping with no added context; `errors.New` in a hot path allocating per call where a sentinel fits.
3. Goroutine leaks: `go func()` with no exit path (blocked channel op, no context); missing `WaitGroup`/`errgroup`; `Add` inside the goroutine.
4. Loop variable capture in closures and goroutines (fixed in Go 1.22; check `go.mod` `go` directive).
5. `context.Background()`/`TODO()` in request paths instead of the propagated `ctx`; `ctx` not passed to I/O calls; `WithTimeout` without `defer cancel()`.
6. Data races: maps and slices written from multiple goroutines; `-race` not run in CI; `sync.Mutex` copied by value (struct passed by value containing a mutex; `go vet` copylocks).
7. Nil handling: nil map write panics; nil slice vs empty slice in JSON (`null` vs `[]`); nil pointer receiver on a method that dereferences; nil interface vs interface holding a nil pointer (`!= nil` is true).
8. Slices: append aliasing (`b := a[:2]; b = append(b, x)` overwrites `a[2]`); three-index slicing or `slices.Clone` when needed; `copy` return value ignored.
9. `defer` inside a loop (runs at function exit, accumulates); `defer` argument evaluation at defer time; deferred `recover` only works in the same goroutine.
10. Shadowed `err` (`err := ` inside a block shadowing the outer `err`, so the outer check sees nil); `go vet -shadow` or `ineffassign`.
11. `time.Now()` used for durations (wall clock; use monotonic via `time.Since`); `time.After` in loops leaks timers; `time.Tick` never stops.
12. Integer conversions: `int(x)` from `int64` or `uint64` overflowing on 32-bit; `len()` is `int`; unsigned underflow (`i-1` when `i` is `uint` 0).
13. `http.Client` without `Timeout` or without context on the request; default `http.DefaultClient` in library code; response body not closed or not drained (connection not reused); `http.Get` directly.
14. `json`: unexported fields silently skipped; struct tags with typos (`json:"id,omitempty"` vs `json:"id, omitempty"`); `interface{}` decoding numbers as `float64`; `Decoder` on a stream without checking for trailing data when relevant; `DisallowUnknownFields` where strictness matters.
15. Interfaces: defined at the producer with many methods instead of at the consumer with few; returning an interface where a concrete type is clearer; `interface{}`/`any` parameters hiding types.
16. Package layout: `util`/`common`/`helpers` packages; `internal/` not used for private code; import cycles worked around with a shared mega-package; `init()` doing work.
17. `panic` for expected errors; `log.Fatal` in library code (exits the process, skips defers); `os.Exit` in anything but `main`.
18. String building with `+=` in loops; `[]byte`/`string` conversions in hot paths; `fmt.Sprintf` for simple concatenation in hot paths.
19. `select {}` with `default` making a busy loop; unbuffered channel sends with no receiver on error paths; closing a channel from the receiver or closing twice.
20. `sync.Pool` misuse (returning objects with references to request data); `atomic` on unaligned 64-bit fields on 32-bit platforms.
21. `database/sql`: `rows.Close()` missing; `rows.Err()` not checked after the loop; `QueryRow` in loops; transactions without `defer tx.Rollback()`; `sql.Null*` types for nullable columns.
22. Struct comparison with `==` on structs containing slices/maps/funcs (compile error) or with time values (`time.Time` has monotonic component; use `Equal`).
23. Exported identifiers without doc comments; exported fields that should be unexported; `Get` prefix on getters (un-idiomatic).
24. `go.mod`: `replace` directives left in; dependency on `master` pseudo-version; `go` directive bumped without reason; `toolchain` line.
25. Tests: `t.Parallel()` with shared state; `t.Fatal` from a non-test goroutine (must be `t.Error` + return); table tests without `t.Run` subtests (no names in failures); testing time with real sleeps; missing `t.Cleanup`; `testify` vs stdlib style mismatch with the repo.
26. Generics (1.18+): type parameters where an interface would do; constraints too loose (`any`) so the body cannot do anything; `comparable` for keys.
27. `os.Getenv` scattered instead of a config struct; `flag` parsing outside `main`.
28. `//nolint` directives without a linter name and reason; `//go:embed` paths that do not exist (silent at build only if the directive is wrong).

## 4. Java / Kotlin

1. `Optional.get()` without `isPresent`; `Optional` as a field, parameter, or in collections; `Optional.of(null)` (throws).
2. `equals` without `hashCode` (or vice versa); `==` on boxed types, `String`s or enums-from-deserialization; `compareTo` inconsistent with `equals` in sorted collections.
3. Mutable static state; `static` collections that grow; singletons with mutable fields in a servlet container.
4. `@Transactional` on a private method, on a method called from the same class (self-invocation bypasses the proxy), or on an interface default method; checked exceptions not rolling back by default; `readOnly` missing on reads; transaction spanning a remote call.
5. Spring: field injection (`@Autowired` on fields) instead of constructor injection; circular bean dependencies; `@Component` on something that should be a plain class; `@Scheduled` without a lock in a multi-instance deployment; `@Async` on self-invoked methods.
6. JPA/Hibernate: `FetchType.EAGER` on collections; `LazyInitializationException` risk outside a session; N+1 from lazy collections in loops (`JOIN FETCH`, `@EntityGraph`, `@BatchSize`); `open-in-view` left on; entity used as API DTO; `equals/hashCode` on entities using generated ids.
7. Thread pools: `Executors.newCachedThreadPool()` unbounded; `newFixedThreadPool` with an unbounded queue; `CompletableFuture` without an executor (common pool); futures whose exceptions are never observed; `ExecutorService` never shut down.
8. `synchronized` on `this` or on a `String`/boxed literal; double-checked locking without `volatile`; `ConcurrentHashMap` compound operations not atomic.
9. `InterruptedException` caught and swallowed without `Thread.currentThread().interrupt()`.
10. `catch (Exception e)` or `catch (Throwable t)`; exception message used for control flow; `e.printStackTrace()`; logging without the throwable argument (`log.error("x " + e)`).
11. Resources not in try-with-resources (`InputStream`, `Connection`, `PreparedStatement`, `ResultSet`, `ExecutorService` via a wrapper).
12. `String.format`/concatenation in SQL (`security/references/injection.md`); `PreparedStatement` parameters used.
13. Date/time: `java.util.Date`/`Calendar` in new code; `LocalDateTime` where an instant with zone is meant; `SimpleDateFormat` shared across threads (not thread-safe); `ZoneId.systemDefault()` on servers.
14. `BigDecimal` from `double` constructor (`new BigDecimal(0.1)`); `equals` vs `compareTo` on `BigDecimal` (scale); floating point for money.
15. Streams: side effects in `map`/`filter`; `forEach` with external mutation; `parallelStream` on I/O or small collections; `Collectors.toMap` without a merge function (throws on duplicate keys); streams not closed when backed by I/O (`Files.lines`).
16. `switch` without `default` on non-enum, or on an enum without exhaustive handling (sealed interfaces plus pattern matching in 17+/21 give exhaustiveness).
17. Java records vs classes consistency; records with mutable component types; `Serializable` on records.
18. Immutability: returning internal mutable collections (`Collections.unmodifiableList`, `List.copyOf`); arrays returned directly; `final` missing where the codebase uses it.
19. `Integer` caching gotcha (`==` works below 128); `Long` vs `long` null unboxing NPE.
20. Jackson: `@JsonIgnoreProperties(ignoreUnknown = true)` absent on inbound DTOs (strict by default breaks on new fields); `FAIL_ON_UNKNOWN_PROPERTIES` setting; polymorphic deserialization with `@JsonTypeInfo` and default typing (`security/references/ssrf-and-server-side.md`).
21. Logging: string concatenation inside `log.debug("..." + obj)` (eager); parameterized logging; MDC not cleared in thread pools.
22. Build: dependency versions unmanaged; `compileOnly` vs `implementation` vs `api` (Gradle) leaking transitive deps; `-parameters` compiler flag needed for some frameworks.
23. Tests: `@MockBean` everywhere (slow context reloads); Mockito `any()` matching nulls (`any(Class)` does not); `verify` as the only assertion; `@DirtiesContext`; `Thread.sleep` for async; `@SpringBootTest` where a slice test (`@WebMvcTest`, `@DataJpaTest`) fits.
24. **Kotlin:** `!!` without a reason; platform types from Java treated as non-null; `lateinit` accessed before init; `as` casts without `as?`.
25. **Kotlin:** `GlobalScope.launch`; `runBlocking` in production; `Dispatchers.Default` for blocking I/O; `CancellationException` caught by a generic `catch (e: Exception)` or `runCatching` and not rethrown; `async` exceptions deferred to `await` and never awaited.
26. **Kotlin:** `data class` with mutable `var` properties used as map keys; `copy()` on a data class with validation in `init` only (bypassed); `equals` on data classes with arrays (reference equality).
27. **Kotlin:** `when` over a sealed class or enum without `else` is exhaustive (good); `when` as a statement on a non-sealed type silently non-exhaustive; `sealed` where an enum suffices.
28. **Kotlin:** extension functions shadowing member functions; top-level functions in `Utils.kt` files; `object` singletons holding mutable state; `companion object` abuse; `lazy` with `LazyThreadSafetyMode` wrong for the context.
29. **Kotlin:** `Flow` collected without a lifecycle scope; `StateFlow` vs `SharedFlow` semantics; `collect` inside `collect`.
30. **Kotlin:** scope functions (`let`, `also`, `apply`, `run`) nested to the point of unreadability; `?.let { } ?: run { }` as an if/else that mis-handles a `null` result inside the `let`.

## 5. Rust

1. `unwrap()`/`expect()` on user input, I/O, or anything that can fail at runtime in non-test code; `expect` messages that explain why it cannot fail.
2. `clone()` to satisfy the borrow checker in hot paths; `Rc<RefCell<T>>`/`Arc<Mutex<T>>` where ownership could be restructured.
3. Holding a `std::sync::Mutex`/`RwLock` guard across `.await`; `tokio::sync::Mutex` used where `std` would do (slower) or vice versa.
4. Blocking in async: `std::thread::sleep`, `std::fs`, blocking `reqwest`, heavy CPU in a Tokio task; `spawn_blocking` or async equivalents.
5. Spawned task `JoinHandle` dropped (panics silent); `JoinSet` or awaited handles; `tokio::select!` cancelling a non-cancel-safe future.
6. `unsafe` blocks without a `// SAFETY:` comment stating the invariant; `unsafe` that could be safe with a std API; `transmute`.
7. Integer overflow: arithmetic that can overflow in release (wraps silently unless `overflow-checks`); `checked_*`/`saturating_*`/`wrapping_*` chosen deliberately; `as` casts truncating (`u64 as u32`, `i64 as usize`); `usize` subtraction underflow.
8. Indexing (`v[i]`, `s[a..b]`) on untrusted indices (panics); `get()`; byte slicing of `&str` on non-char boundary panics.
9. `Box<dyn Error>` in library public API (callers cannot match); `thiserror` enum instead; `anyhow` leaking out of application boundaries into a library crate.
10. `map_err(|_| MyError::Other)` dropping the source; `#[from]`/`#[source]` so `source()` chains.
11. `let _ = fallible();` ignoring a `Result`; `#[must_use]` warnings suppressed with `#![allow(unused_must_use)]`.
12. `String` where `&str` suffices in parameters; `&String`/`&Vec<T>` parameters (use `&str`/`&[T]`); `impl AsRef<str>`/`Into<String>` where ergonomics matter.
13. Lifetimes elided in a way that ties an output to the wrong input; `'static` bounds added to satisfy the compiler without need.
14. `#[derive(Clone, Copy)]` on types with heap data or large structs; `Copy` on types that may later gain non-Copy fields (semver); missing `Debug`/`Clone`/`PartialEq` on public types.
15. `PartialEq` derived on floats and used for exact comparison; `Eq`/`Hash` derived on types containing floats (compile error) or NaN semantics.
16. `pub` on items that should be `pub(crate)`; public enum without `#[non_exhaustive]` when variants may be added (semver); public struct fields that lock in layout.
17. `Default` derived with meaningless zero defaults for domain types; `new()` without `Default` or vice versa.
18. Iterator chains with `collect()` between adaptors; `collect::<Vec<_>>().len()` where `count()` fits; `.iter().cloned().collect()` where `to_vec()` is clearer.
19. `match` with a catch-all `_ =>` on an enum you own (new variants silently handled wrong); `if let ... else { unreachable!() }`.
20. `Option<Option<T>>`, `Result<Option<T>, E>` vs `Option<Result<T, E>>` chosen without thought; `transpose()`.
21. Serde: `#[serde(deny_unknown_fields)]` on inbound types that must be lenient; `#[serde(default)]` missing for optional fields; `rename_all` consistent with the wire format; `untagged` enums with ambiguous variants (first match wins).
22. `Cargo.toml`: `*` or overly loose version requirements; features enabling heavy deps by default; `[patch]` left in; `edition` consistent; `Cargo.lock` committed for binaries.
23. `clippy` warnings suppressed (`#[allow(clippy::...)]`) without a reason; `clippy::pedantic` items that matter (`needless_pass_by_value`, `cast_possible_truncation`).
24. `std::process::exit` inside library code (skips destructors); `panic!` in `Drop`.
25. `static mut`; `lazy_static`/`once_cell`/`OnceLock` for globals; global mutable state behind `Mutex` when a parameter would do.
26. Tests: `#[should_panic]` without `expected`; `assert!(a == b)` instead of `assert_eq!` (worse messages); tests touching the filesystem without `tempfile`; `#[ignore]` without a reason.
27. Doc comments on public items; `# Examples` that compile as doctests; `# Panics`/`# Errors`/`# Safety` sections where applicable.

## 6. Ruby

1. `rescue Exception` (catches `SystemExit`, `Interrupt`); `rescue => e` is `StandardError` and is right; bare `rescue nil` swallowing.
2. `retry` inside `rescue` without a counter; `ensure` with `return`.
3. Rails N+1: association access in a loop or view without `includes`/`preload`/`eager_load`; `count` vs `size` vs `length` (`count` always queries); `exists?` vs `present?` (`present?` loads the whole relation).
4. `find_by` returning `nil` used without a check; `find` raising `RecordNotFound` where `nil` was expected (or the reverse).
5. Callbacks (`before_save`, `after_commit`) hiding behavior and side effects; `after_save` sending email (not transactional; `after_commit`); callbacks skipped by `update_column`/`update_all`/`insert_all` (also skip validations).
6. `update_attribute`, `update_column`, `save(validate: false)` bypassing validations; `toggle!`.
7. Mass assignment: strong parameters missing or `permit!`; `params.permit(...)` not matching the form.
8. Raw SQL with interpolation (`where("name = '#{name}'")`); `where("name = ?", name)` or hash conditions; `order(params[:sort])` injection; `sanitize_sql_like` for `LIKE`.
9. Transactions: `transaction do ... end` around a block that calls external services; nested `transaction` without `requires_new`; `rollback` on non-`ActiveRecord::Rollback` exceptions; `after_commit` inside a nested transaction.
10. `default_scope` (haunts every query); `unscoped` sprinkled to escape it.
11. Mutable constants (`FOO = []` then `FOO << x`); `freeze` on constants; `# frozen_string_literal: true` consistency.
12. `==` vs `eql?` vs `equal?`; `Hash` keys symbol vs string mismatch (`params` is `HashWithIndifferentAccess`, plain hashes are not); `fetch` vs `[]` on hashes (nil vs KeyError).
13. `Time.now` vs `Time.current`/`Time.zone.now` (time zone aware in Rails); `Date.today` vs `Date.current`; `DateTime` in new code.
14. `method_missing`/`define_method`/`send` on user input (`public_send` at minimum); `instance_variable_get` with input; `eval`/`constantize` on input.
15. Thread safety under Puma: class-level `@@vars` or `@ivars` on classes/modules; memoization with `||=` on shared objects; `Thread.current` as a global.
16. Sidekiq/ActiveJob: non-idempotent jobs (retries are default); passing AR objects instead of ids (serialization, staleness; GlobalID handles it but check); jobs enqueued inside a transaction before commit (`after_commit` or transactional enqueue in Rails 7.2+).
17. `Struct.new` with `keyword_init` consistency; `OpenStruct` (slow, surprising); `Data.define` in 3.2+.
18. `rescue_from` ordering in controllers (first match wins, subclass before superclass); `render` and `redirect_to` both called (`DoubleRenderError`).
19. Migrations: `add_index` without `algorithm: :concurrently` and `disable_ddl_transaction!` on Postgres large tables; `add_column` with default on large tables (fine on PG 11+, still check); data changes inside schema migrations; irreversible `change` without `up`/`down`; `strong_migrations` gem if present, and its warnings.
20. `Gemfile`: unpinned gems without `Gemfile.lock` changes; `require: false` misuse; gems in the wrong group.
21. Monkey patches in `config/initializers` or `lib/core_ext` without `Module#prepend` and a reason; refinements as the alternative.
22. `puts`/`p`/`binding.pry`/`byebug`/`debugger` left in.
23. `String#to_sym` on user input (symbols are GC'd since 2.2, but still a smell); `to_i` on invalid input returning 0 silently (`Integer(x)` raises).
24. `each` with index via a counter instead of `each_with_index`; `map` with side effects; `select`/`reject` chains that `detect` would short-circuit.
25. RSpec: `let!` vs `let` ordering surprises; `before(:all)` with DB state; `allow_any_instance_of`; `expect(...).to receive` as the only assertion; `sleep` in specs; `Timecop`/`travel_to` without a block (leaks).
26. RuboCop disables inline without a reason; `.rubocop_todo.yml` growing instead of shrinking.

## 7. PHP

1. `==` loose comparison (`"abc" == 0`, `"1e3" == "1000"`, `null == false`); `===`; `in_array`/`array_search` without `strict: true`; `switch` uses loose comparison (`match` is strict).
2. SQL built by concatenation or interpolation; PDO prepared statements with bound parameters; `mysqli_real_escape_string` as the only defense; `$wpdb->prepare` in WordPress.
3. Output without escaping (`echo $userInput`; `htmlspecialchars($x, ENT_QUOTES, 'UTF-8')`; Blade `{!! !!}` vs `{{ }}`; Twig `|raw`).
4. `extract()`, `$$var`, `eval`, `unserialize` on untrusted input; `include`/`require` with a user-controlled path; `preg_replace` with `/e` (removed, but `preg_replace_callback` misuse).
5. `@` error suppression; `error_reporting` lowered; `display_errors` on in production config.
6. `catch (\Throwable $t)`/`catch (\Exception $e)` swallowing; `$previous` not passed when rethrowing; exceptions caught and `return false`.
7. Mixed return types (`int|false`, `array|null`) without declared union types; `declare(strict_types=1)` missing (coercion surprises); return type declarations absent in new code.
8. Null handling: `isset()` vs `array_key_exists()` (isset is false for null values); `empty()` treating `"0"` as empty; `??` vs `?:` (falsy vs null).
9. Arrays as everything: associative arrays passed around where a DTO/readonly class would do; array shape not documented (`@param array{id: int, name: string}` PHPStan syntax at minimum); `list()`/destructuring on possibly-short arrays.
10. Floats for money; `round()` and `number_format` for display only; `bcmath`/`brick/money`.
11. Date/time: `date()`/`strtotime()`/`mktime` in new code (`DateTimeImmutable`); `DateTime` (mutable) passed around and modified; timezone from `date_default_timezone_get()` implicit.
12. Static state and singletons under long-running runtimes (Octane, Swoole, RoadRunner, FrankenPHP): request data in static properties leaks across requests.
13. Laravel: Eloquent N+1 (`with()`, `load()`; `Model::preventLazyLoading()` in dev); `Model::all()`/`get()` on unbounded tables; mass assignment (`$fillable`/`$guarded`); `DB::raw` with input; `->where('x', $input)` fine but `->whereRaw` with input is not; `orderBy($request->input('sort'))` injection.
14. Laravel: validation in controllers instead of FormRequests (or at all); authorization missing (policies, `authorize()`, `can` middleware); `Auth::user()` nullable used without a check; queued jobs that are not idempotent; `dispatch` before transaction commit (`afterCommit`); `env()` called outside config files (returns null when config is cached).
15. Laravel: facades vs injection consistency; service container bindings with `singleton` holding request state; `Cache::remember` key without tenant/user scope; events with listeners that throw.
16. Symfony: services not autowired or wired with wrong scope; `#[Route]` methods without security attributes where neighbors have them; Doctrine `flush()` in loops; `getRepository()->findAll()`; lazy proxies and `__toString` on uninitialized entities; Messenger handlers not idempotent.
17. Composer: `composer.lock` committed and in sync; version constraints (`*`, `dev-master`); `platform.php` pinned; `autoload` PSR-4 mapping matches directory case.
18. PSR compliance with the repo's chosen standard (PSR-12, per `php-cs-fixer`/`phpcs` config); PHPStan/Psalm level not lowered in the diff; `@phpstan-ignore` without a reason.
19. `header()` after output; `exit`/`die` in library code; `global` keyword; `$_GET`/`$_POST`/`$_SERVER` accessed directly in framework code instead of the request object.
20. File uploads: trusting `$_FILES['type']`; `move_uploaded_file` to a web-accessible path; extension-only validation (`security/references/ssrf-and-server-side.md`).
21. Session: `session_start` placement; session fixation on login (`session_regenerate_id(true)`); sensitive data in session serialized to disk.
22. `password_hash`/`password_verify` instead of `md5`/`sha1`; `random_int`/`random_bytes` instead of `rand`/`mt_rand` for security; `hash_equals` for comparisons (`security/references/cryptography.md`).
23. Tests: PHPUnit data providers for table cases; `@runInSeparateProcess` hiding global state problems; mocking the container; database tests without transactions (`RefreshDatabase`/`DatabaseTransactions` in Laravel).

## 8. Swift

1. Force unwraps (`!`) and force casts (`as!`) on anything not provably non-nil; `try!`; `IBOutlet` implicitly unwrapped is the accepted exception.
2. `try?` discarding errors silently; each needs a reason comment.
3. Retain cycles: closures capturing `self` strongly in stored closures, `Timer`, `NotificationCenter` blocks, Combine `sink` without `[weak self]`; `delegate` properties not `weak`.
4. Main thread: UI updates off the main actor; `@MainActor` missing on view models that publish to UI; blocking the main thread with sync network or heavy decode.
5. Swift concurrency: unstructured `Task { }` without cancellation handling or ownership; `Task.detached` where structured would do; `.task {}` in SwiftUI for lifecycle; checking `Task.isCancelled` in long loops; `withCheckedContinuation` resumed zero or two times (crash/leak).
6. Strict concurrency: non-`Sendable` types crossing actor boundaries; `@unchecked Sendable` without justification; global mutable `var`s (errors in Swift 6 language mode; check the build setting).
7. Value vs reference semantics: structs with reference-type properties (shallow copy); classes where a struct fits; `mutating` methods on structs stored in `let`.
8. Optionals: `if let x = x` chains that could be `guard let`; `??` with a side-effecting default (evaluated lazily, fine, but surprising); `Optional<Optional<T>>` from dictionary lookups of optionals; comparing optionals with `==` to literals.
9. `Codable`: `CodingKeys` mismatch with the wire format; `decodeIfPresent` for optional fields; custom `init(from:)` dropping fields; `Date` decoding strategy not set (defaults to seconds since reference date); `Int` for ids that overflow or are strings on the wire.
10. Enums: `switch` with `default` on enums you own (hides new cases); `@unknown default` for enums from frameworks; associated values vs separate properties; `RawRepresentable` with `rawValue` collisions.
11. Error handling: `Error` protocol conformance with no cases; `NSError` bridging losing info; `LocalizedError` for user-facing messages; typed throws (6.0) consistent with the module.
12. String handling: `count` is grapheme clusters (O(n)); indexing with `Int` (not allowed, and workarounds are slow); `NSString` bridging length mismatches; locale-sensitive comparison (`compare(options:)`, `localizedStandardCompare`).
13. Numeric: `Int` is platform width; `Double` for money; `Decimal` for currency; integer overflow traps at runtime (`&+` for wrapping deliberately).
14. Access control: `public` where `internal` suffices; `private` vs `fileprivate`; `open` on classes not designed for subclassing; `@testable import` leaking the need for internal access.
15. SwiftUI: `@State` for reference types (use `@StateObject`/`@Observable`); `@ObservedObject` created in the view body (recreated every render); heavy work in `body`; `onAppear` for data loading instead of `.task`; `ForEach` with non-stable ids; `GeometryReader` everywhere.
16. UIKit: `viewDidLoad` vs `viewWillAppear` work placement; cell reuse without reset; `dequeueReusableCell` force cast; constraint churn in `layoutSubviews`.
17. Keychain for secrets (not `UserDefaults`); App Transport Security exceptions; certificate pinning (`security/references/mobile-security.md`).
18. Date/time: `Date()` for durations (use `ContinuousClock`/`DispatchTime`); `Calendar.current` vs explicit calendar; `DateFormatter` creation in loops (expensive) and without `locale` set to `en_US_POSIX` for fixed formats.
19. Package.swift: version ranges (`from:` vs `exact:`), `Package.resolved` committed; platform minimums matching the deployment target.
20. `print` in release; `os.Logger` with privacy annotations (`\(x, privacy: .private)`); `assert` vs `precondition` (assert is stripped in release).
21. Tests: `XCTestExpectation` without `wait`; `waitForExpectations` timeouts too short/long; async tests using `async throws` and `await` rather than expectations; `XCTAssertEqual` on floats without `accuracy`; UI tests with `sleep`.

## 9. C#

1. `async void` outside event handlers; `.Result`/`.Wait()`/`GetAwaiter().GetResult()` on tasks in ASP.NET or UI code (deadlock, thread starvation); `Task.Run` wrapping async I/O.
2. Missing `CancellationToken` parameters on async methods and not passing it through to I/O calls; `OperationCanceledException` logged as an error.
3. `ConfigureAwait(false)` policy consistent with the project type (libraries yes, ASP.NET Core unnecessary, WPF/WinForms careful).
4. `HttpClient` instantiated per call (socket exhaustion); `IHttpClientFactory` or a long-lived instance; timeouts set.
5. `IDisposable` not disposed (`using`/`await using`); `IAsyncDisposable` disposed synchronously; disposing injected dependencies you do not own; `Dispose` pattern with finalizer where unnecessary.
6. Exceptions: `catch (Exception)` swallowing; `throw ex;` (resets stack) vs `throw;`; custom exceptions without the standard constructors; exceptions for control flow in hot paths (`TryParse` patterns); `when` filters unused.
7. Null handling: nullable reference types disabled in the project or `#nullable disable` in the diff; `!` null-forgiving operator without reason; `?.` chains hiding bugs; `string.IsNullOrEmpty` vs `IsNullOrWhiteSpace`; `default` for structs vs null for classes.
8. LINQ: multiple enumeration of an `IEnumerable` (database queries executed twice; `ToList()` once); `Count()` vs `Any()`; `First()` where `FirstOrDefault()` with a null check is meant (or `Single()` semantics); deferred execution captured after the DbContext is disposed; `Where` after `ToList` on EF queries (filters in memory).
9. Entity Framework: N+1 from lazy loading or loops (`Include`/`ThenInclude`, projections with `Select`); tracking queries where `AsNoTracking()` fits; `SaveChanges` in loops; `DbContext` shared across threads or registered as singleton; migrations auto-applied at startup in production; raw SQL with interpolation (`FromSqlRaw` with `$"..."` is injection; `FromSqlInterpolated`/`FromSql` parameterizes).
10. Dependency injection: captive dependencies (scoped service injected into singleton); service locator pattern (`IServiceProvider` passed around); `BuildServiceProvider` called in `ConfigureServices`.
11. Threading: `lock` on `this`, on a `Type`, or on a string; `static` mutable fields; `Dictionary` accessed concurrently (`ConcurrentDictionary`; `GetOrAdd` value factory may run multiple times); `Interlocked` for counters; `volatile` misunderstanding.
12. Structs: large structs passed by value; mutable structs (`readonly struct`); `==` on structs without overload (reflection-based, slow); boxing via interface calls.
13. Strings: `==` is culture-invariant ordinal (fine), but `Compare`/`StartsWith`/`IndexOf` default to current culture (use `StringComparison.Ordinal`); `ToLower()` for comparisons (use `Equals(x, OrdinalIgnoreCase)`); string concatenation in loops (`StringBuilder`); interpolated strings in logging (use structured templates `_logger.LogInformation("User {UserId}", id)`).
14. Date/time: `DateTime.Now` on servers (`UtcNow` or `DateTimeOffset`); `DateTime.Kind` unspecified round-tripping through JSON/DB; `TimeProvider` (.NET 8) or an injected clock for testability.
15. `decimal` for money; `double` comparisons with `==`; `Math.Round` default banker's rounding (`MidpointRounding`).
16. JSON: `System.Text.Json` vs `Newtonsoft` mixed; case sensitivity defaults differ; `JsonSerializerOptions` created per call (cache it); polymorphic deserialization with `TypeNameHandling.All` (Newtonsoft) is RCE (`security/references/ssrf-and-server-side.md`).
17. ASP.NET Core: `[Authorize]` missing on new controllers/endpoints where neighbors have it; `[FromBody]`/`[FromQuery]` binding surprises; model validation not checked (`ModelState.IsValid`, or `[ApiController]`); returning entities directly (over-posting, leaking); `IActionResult` vs typed results consistency; middleware order (auth before endpoints, exception handler first).
18. Configuration: `IOptions<T>` vs `IOptionsSnapshot`/`IOptionsMonitor` for reloadable settings; secrets in `appsettings.json` committed (`security/references/secrets.md`); `GetValue` with wrong key silently defaulting.
19. `event` handlers never unsubscribed (leaks); `WeakReference` where appropriate; `IObservable` subscriptions not disposed.
20. `Span<T>`/`Memory<T>`/`stackalloc` misuse (stackalloc in loops, spans escaping scope); `ArrayPool` rented arrays not returned.
21. Records vs classes consistency; `record` with mutable properties; `with` expressions on records containing mutable collections (shallow).
22. Pattern matching: `switch` expressions without a discard arm where not exhaustive (compiler warns); `is not null` vs `!= null` (operator overloads).
23. Analyzers: `#pragma warning disable` without a reason; `<Nullable>enable</Nullable>` and `<TreatWarningsAsErrors>` changes; `.editorconfig` severity lowered.
24. Tests: `[Fact]` with async void; `Assert.True(x == y)` instead of `Assert.Equal`; `Moq` `Verify` as the only assertion; `Setup` returning the asserted value; `Thread.Sleep` for async; shared static test state across parallel test classes (xUnit runs classes in parallel); `WebApplicationFactory` per test (slow) vs shared fixture.

## 10. SQL

1. Injection: any query built with string concatenation or interpolation of input, in any host language; parameterized queries or the ORM's safe API; dynamic identifiers (table/column names from input) allow-listed, not quoted by hand (`security/references/injection.md`).
2. `SELECT *` in application queries (schema changes break column positions; fetches more than needed; breaks covering indexes).
3. Missing `WHERE` on `UPDATE`/`DELETE`; `WHERE` on an unindexed column for a large table; predicates wrapped in functions (`WHERE lower(email) = ...`, `WHERE date(created_at) = ...`) defeating indexes unless an expression index exists.
4. `NULL` semantics: `= NULL` (always unknown; `IS NULL`); `NOT IN (subquery)` returning nothing if the subquery yields a NULL (`NOT EXISTS`); `COUNT(col)` vs `COUNT(*)`; `NULL` in `UNIQUE` constraints (multiple NULLs allowed in most engines; `NULLS NOT DISTINCT` in PG 15+); concatenation with NULL yielding NULL.
5. Implicit type conversion in predicates (`WHERE id = '123'` on an integer column, or the reverse on a varchar column, scanning the table); comparing strings to numbers; collation mismatches on joins.
6. Joins: Cartesian products from missing join conditions; `LEFT JOIN` with a `WHERE` on the right table that turns it into an inner join; fan-out from one-to-many joins inflating aggregates (`COUNT`, `SUM`) and needing `DISTINCT` as a band-aid.
7. `DISTINCT` or `GROUP BY` added to hide duplicate rows from a wrong join.
8. `ORDER BY` without `LIMIT` on a large result; `LIMIT` without `ORDER BY` (nondeterministic); `OFFSET` pagination on large offsets (keyset/cursor instead); `ORDER BY` on an unindexed column forcing a sort.
9. Transactions: isolation level assumptions (read committed by default in PG/SQL Server; repeatable read in MySQL InnoDB); check-then-act across statements without `SELECT ... FOR UPDATE`, a unique constraint, or an atomic `UPDATE ... RETURNING`; long transactions holding locks across application calls; missing `ROLLBACK` on error in procedural code.
10. Lost updates: `UPDATE t SET n = :computed_in_app` instead of `SET n = n + 1`; optimistic locking (`version` column) absent where concurrent edits are possible.
11. Upserts: `INSERT ... ON CONFLICT DO NOTHING` silently dropping; `ON CONFLICT (cols)` not matching a unique constraint; MySQL `INSERT ... ON DUPLICATE KEY UPDATE` with multiple unique keys; `MERGE` concurrency issues on SQL Server.
12. Migrations (details in the `database` skill): `CREATE INDEX` without `CONCURRENTLY` (PG) or `ONLINE` (MySQL/Oracle) on live tables; `ALTER TABLE ... ADD COLUMN ... NOT NULL` without default or with a volatile default on large tables; column type changes rewriting the table; `ADD CONSTRAINT ... FOREIGN KEY` without `NOT VALID` then `VALIDATE`; dropping columns still read by running code; renaming anything in use.
13. Data types: `FLOAT`/`DOUBLE` for money (`NUMERIC(p,s)`/`DECIMAL`); `VARCHAR(255)` cargo cult vs `TEXT` with a `CHECK`; `TIMESTAMP` without time zone (`TIMESTAMPTZ` in PG); `INT` for ids approaching 2^31; `CHAR` padding; booleans as `CHAR(1)` or `TINYINT` in engines with a real boolean; JSON columns for data that is queried relationally.
14. Keys and constraints: no primary key; natural keys that change (email as PK); missing foreign keys "for performance" without a reason; missing `NOT NULL` where the domain requires a value; missing `CHECK` constraints for enums/ranges; missing unique constraints relied upon by application-level checks.
15. Indexes: no index for the new query's predicate or join column; redundant indexes (prefix of another); index on a low-cardinality boolean alone; composite index column order not matching equality-then-range usage; indexes on write-heavy tables without need; partial indexes where the query always filters a constant (`WHERE deleted_at IS NULL`).
16. `LIKE '%term%'` on large tables (no index use; trigram/full-text index); `LIKE` with user input not escaping `%`/`_`.
17. Functions and procedures: `EXCEPTION WHEN OTHERS THEN NULL`; cursors and row-by-row loops where a set-based statement exists; dynamic SQL inside procedures with concatenation (`EXECUTE format(... %I ...)`/`quote_ident` in PG; `sp_executesql` with parameters in SQL Server).
18. Triggers adding hidden behavior (audit triggers are fine; business logic in triggers is a finding); recursive trigger risk.
19. Views: `SELECT *` inside a view (column list frozen at creation in PG); non-materialized views over heavy joins used in hot paths; materialized views without a refresh strategy.
20. Date/time: `BETWEEN` on timestamps including the upper boundary (`>= start AND < end`); `NOW()` vs `CURRENT_DATE` semantics; `DATE_TRUNC`/`EXTRACT` on unindexed expressions; time zone of the session vs the data.
21. Aggregates: `GROUP BY` columns not matching non-aggregated select columns (MySQL `ONLY_FULL_GROUP_BY` off hides this); `HAVING` used where `WHERE` filters before grouping more cheaply; window functions vs self-joins.
22. `EXPLAIN`/`EXPLAIN ANALYZE` output in the PR for any new query on a large table; sequential scans on large tables; estimated vs actual row counts far apart (stale statistics); the `database` skill's EXPLAIN notes for interpretation.
23. Engine-specific: MySQL `utf8` (3-byte) vs `utf8mb4`; MySQL implicit commit on DDL; SQLite type affinity and `INTEGER PRIMARY KEY` vs `rowid`; PG `SERIAL` vs `IDENTITY`; PG `text` search without `GIN`; SQL Server `NOLOCK` hints hiding concurrency problems; Oracle `VARCHAR2` byte vs char semantics.
24. Permissions: application role with `SUPERUSER`/`DROP`/`GRANT`; migrations run as the application user; row-level security policies bypassed by `BYPASSRLS` roles (`security/references/cloud-and-infra.md` and the `database` skill).
25. Seeds and fixtures with real-looking PII; `TRUNCATE` in scripts that could run against production.
