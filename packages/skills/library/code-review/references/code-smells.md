# Code smells catalogue

A smell is a surface sign that a deeper problem may exist. It is a prompt
to look, not a verdict. Each entry here gives the symptoms, why it costs
something, examples in at least two languages, the refactoring that
usually resolves it, and the conditions under which the smell is fine and
should be left alone. Severity for review purposes: most smells are nits
or should-fix depending on how often the code will be touched; a smell
that is hiding a bug is whatever the bug is.

## Contents

1. Long method
2. Large class / god object
3. Feature envy
4. Data clumps
5. Primitive obsession
6. Shotgun surgery
7. Speculative generality
8. Boolean flag parameters
9. Deep nesting
10. Hidden side effects
11. Temporal coupling
12. Magic values
13. Inconsistent abstraction levels
14. Leaky abstractions
15. Comments that explain what instead of why
16. Duplicated code
17. Long parameter list
18. Dead code
19. Message chains and middle men
20. Mutable global state
21. Exceptions as control flow
22. Reviewing smells: severity and when to say nothing

## 1. Long method

**Symptoms.** Scrolls past a screen; has sections separated by blank lines
or comments ("// validate", "// persist"); more than one level of
abstraction; you need to re-read the top to understand the bottom.

**Why it hurts.** Every reader must hold the whole thing to change any
part. Tests have to set up the full context to exercise one branch. Bugs
hide in the middle section nobody reads.

**Example (Python, before):**

```python
def handle_upload(req):
    # validate
    if "file" not in req.files:
        raise BadRequest("missing file")
    f = req.files["file"]
    if f.content_length > 10 * 1024 * 1024:
        raise BadRequest("too large")
    ext = f.filename.rsplit(".", 1)[-1].lower()
    if ext not in {"png", "jpg", "jpeg"}:
        raise BadRequest("bad type")
    # store
    key = f"{uuid4()}.{ext}"
    s3.put_object(Bucket=BUCKET, Key=key, Body=f.stream)
    # record
    asset = Asset(key=key, owner_id=req.user.id, size=f.content_length)
    db.add(asset); db.commit()
    # notify
    queue.send({"type": "asset.created", "id": asset.id})
    return {"id": asset.id, "url": f"{CDN}/{key}"}
```

**After:** each comment becomes a function name, and the handler reads as
the sequence it already was.

```python
def handle_upload(req):
    upload = validate_image_upload(req)
    key = store_image(upload)
    asset = record_asset(key, upload, owner=req.user)
    publish_asset_created(asset)
    return asset_response(asset)
```

**Example (Go):** the same shape appears as a handler that decodes,
validates, calls three services and writes the response inline. Extract
`decodeAndValidate(r) (CreateReq, error)` and `(s *Service) Create(ctx,
req) (Asset, error)`; the handler keeps only HTTP concerns.

**Refactoring.** Extract function, named after the comment that preceded
the block. Replace temp with query where a local is computed once and read
many times. If the extracted functions share many locals, introduce a
parameter object or a small class (see Data clumps).

**When it is fine.** A long, flat sequence of simple statements with no
branching (a configuration builder, a test arranging a fixture) is
readable at 80 lines; splitting it would scatter it. Hot-loop numeric code
where extraction has a measured cost. A function whose length comes from
an exhaustive `switch` over a closed enum.

## 2. Large class / god object

**Symptoms.** Hundreds of lines; many unrelated fields; methods that use
disjoint subsets of the fields; named `Manager`, `Service`, `Util`,
`Helper`, `Context`, `App`; imported by everything; every PR touches it.

**Why it hurts.** It becomes the merge-conflict magnet and the place where
every shortcut goes because it already has access to everything. Testing
any method means constructing the world.

**Example (TypeScript, before):**

```ts
class UserService {
  constructor(private db: Db, private mailer: Mailer, private stripe: Stripe,
              private cache: Cache, private logger: Logger) {}
  createUser(...) {}
  resetPassword(...) {}
  chargeSubscription(...) {}
  sendWeeklyDigest(...) {}
  exportGdprData(...) {}
  mergeDuplicateAccounts(...) {}
  // 40 more
}
```

**After:** cluster methods by the fields they use. `chargeSubscription`
uses `stripe` and `db`; `sendWeeklyDigest` uses `mailer` and `db`;
`exportGdprData` uses only `db`. Those are three classes
(`BillingService`, `DigestMailer`, `GdprExporter`) with narrow
constructors.

**Example (Java):** a `OrderManager` with `calculateTax`, `applyDiscount`,
`reserveInventory`, `sendConfirmation`, `generateInvoicePdf`. Each verb
on a different noun is a different class.

**Refactoring.** Extract class along the lines of field usage (draw the
method-to-field matrix; clusters are classes). Move method to where its
data is. Introduce a facade only if callers truly need one entry point.

**When it is fine.** A class that is large because it is an exhaustive
adapter over a large external API (a thin client with 60 one-line
methods). A deliberately central module in a small program where the
alternative is ceremony.

## 3. Feature envy

**Symptoms.** A method reads three or more fields of another object to
compute something, and does little with its own.

**Why it hurts.** The logic lives far from the data it depends on, so when
the data changes, the logic breaks in a different file. It is also a sign
the other class is missing a method.

**Example (Ruby, before):**

```ruby
class InvoicePresenter
  def total_label(invoice)
    subtotal = invoice.line_items.sum { |li| li.unit_price * li.quantity }
    tax = subtotal * invoice.tax_rate
    discount = invoice.coupon ? subtotal * invoice.coupon.pct : 0
    format_money(subtotal + tax - discount, invoice.currency)
  end
end
```

**After:** `Invoice#total` owns the arithmetic; the presenter formats.

```ruby
class Invoice
  def subtotal = line_items.sum { |li| li.unit_price * li.quantity }
  def total    = subtotal + subtotal * tax_rate - discount_amount
end

class InvoicePresenter
  def total_label(invoice) = format_money(invoice.total, invoice.currency)
end
```

**Example (Kotlin):** a `ReportBuilder` that computes `employee.salary *
employee.bonusRate + employee.allowance` in four places; `Employee.
totalCompensation()` belongs on `Employee`.

**Refactoring.** Move method (or extract then move). If the envied object
is a DTO you do not control, consider an extension function (Kotlin,
Swift, C#) or a small wrapper type.

**When it is fine.** Strategy and visitor patterns deliberately separate
behavior from data. Presenters and serializers that read many fields but
only to format them are doing their job; the smell is computation, not
reading.

## 4. Data clumps

**Symptoms.** The same three or four values travel together: `(host, port,
useTls)`, `(startDate, endDate)`, `(lat, lng)`, `(page, pageSize,
sortKey, sortDir)`. They appear in parameter lists, return tuples, and
struct fields together.

**Why it hurts.** Every function that takes them has a long signature;
validation of the relationship between them (start before end) is
duplicated or missing; one of them gets forgotten.

**Example (Go, before):**

```go
func Query(db *sql.DB, start, end time.Time, page, pageSize int, sortKey, sortDir string) ...
func Export(w io.Writer, start, end time.Time, page, pageSize int, sortKey, sortDir string) ...
```

**After:**

```go
type DateRange struct{ Start, End time.Time }
func NewDateRange(start, end time.Time) (DateRange, error) { /* validates order */ }
type Paging struct{ Page, Size int; SortKey string; Desc bool }

func Query(db *sql.DB, r DateRange, p Paging) ...
func Export(w io.Writer, r DateRange, p Paging) ...
```

**Example (Python):** `def book(flight_from, flight_to, depart, ret,
adults, children, infants)`: `Itinerary` and `PartySize` dataclasses.

**Refactoring.** Introduce parameter object / extract class. Then look
for methods that only use the clump and move them onto the new type
(`DateRange.contains`, `Paging.offset()`).

**When it is fine.** Two values in a single private function. Values that
happen to co-occur once.

## 5. Primitive obsession

**Symptoms.** Domain concepts represented as `string`, `int`, `float`,
`dict`: money as float, email as string, user id as int interchangeable
with order id as int, status as string compared with literals, duration
as a bare number with unknown units.

**Why it hurts.** The type system cannot catch `transfer(fromAccountId,
toAccountId)` called with arguments swapped. Validation happens at every
use or at none. Units are ambiguous. Money as float loses cents.

**Example (TypeScript, before):**

```ts
function transfer(from: number, to: number, amount: number, currency: string) {}
transfer(orderId, userId, 10.1, "usd"); // compiles
```

**After:** branded types and a Money value.

```ts
type AccountId = number & { readonly __brand: "AccountId" };
type Money = { readonly minor: bigint; readonly currency: Currency };
function transfer(from: AccountId, to: AccountId, amount: Money) {}
```

**Example (Rust):** newtypes are the idiom. `struct UserId(u64); struct
OrderId(u64);` and `Duration` instead of `u64` seconds.

**Example (Java):** `record Email(String value) { Email { if
(!VALID.matcher(value).matches()) throw ...; } }` so an `Email` is valid by
construction.

**Refactoring.** Replace primitive with value object; replace type code
with enum (or sealed class); for units, a type per unit or a library
(`java.time.Duration`, Python `timedelta`, Go `time.Duration`).

The stringly-typed variant (`if (type === "premium")`, event names as
strings in a `switch`, `Map<string, any>`, a dict-of-dicts standing in for
a domain object) has the same fix: an enum or union, typed event classes,
a record instead of a dict, converted once where the string enters.

**When it is fine.** At system edges (parsing, serialization) primitives
are unavoidable; convert once at the boundary. Scripts and one-off tools.
Languages where wrapper types have real overhead in a hot path and the
code is local.

## 6. Shotgun surgery

**Symptoms.** One conceptual change (add a status, add a currency, add a
field) requires edits in many files. The PR for "add CANCELLED status"
touches 14 files.

**Why it hurts.** Every change is expensive and some site gets missed.
The missed site is a bug discovered in production.

**Example (any language):** an enum rendered in a `switch` in the UI, a
`switch` in the serializer, a `switch` in the validator, a `switch` in
the email template chooser, and a hard-coded list in a test fixture.

**Refactoring.** Move the knowledge to one place: a table or map
(`STATUS_META = { CANCELLED: { label, color, canTransitionTo } }`), or
polymorphism (each status a class with `label()`, `transitions()`). Make
the compiler enforce exhaustiveness where it can (`assertNever` in TS,
sealed classes in Kotlin/Java 17+, `match` in Rust, `-Wswitch` in C).

**When it is fine.** Genuinely cross-cutting changes (adding a tenant id
everywhere) are shotgun by nature; the fix is to do them once and well,
with a codemod (`refactoring.md`).

**The mirror image: divergent change.** One module that changes for many
unrelated reasons (the `ReportGenerator` changes when the PDF library
updates, when a tax rule changes, and when the email provider changes).
Extract along the axes of change so each module has one reason to
change. Fine in tiny programs and in the composition root (`main`,
`app.ts`), which is supposed to change when anything is wired differently.

## 7. Speculative generality

**Symptoms.** Interfaces with one implementation; abstract base classes
with one subclass; parameters nobody passes; "plugin" systems with one
plugin; `options` objects with a single key; generic type parameters
always instantiated the same way; a `Strategy` chosen by a constant.

**Why it hurts.** Indirection without payoff. Every reader pays the cost
of following the abstraction to find that there is nothing behind it.
Changes need to be made in two places (the interface and the
implementation).

**Example (Java, before):**

```java
public interface NotificationSender { void send(Notification n); }
public class EmailNotificationSender implements NotificationSender { ... }
// Only implementation; injected everywhere as NotificationSender
```

**After:** `EmailSender` as a concrete class until a second sender exists.
When one does, extracting the interface is a thirty-second IDE refactor.

**Example (Python):**

```python
class BaseProcessor(ABC):
    @abstractmethod
    def process(self, item): ...

class Processor(BaseProcessor):
    def process(self, item): ...
```

Delete `BaseProcessor`.

**Refactoring.** Collapse hierarchy; inline class; remove parameter;
remove the unused generic.

**When it is fine.** The interface is the seam you test through (a real
fake exists in tests, so there are two implementations). The abstraction
is a published extension point for third parties. The language needs the
interface for mocking (Go interfaces at consumer side are idiomatic even
with one production implementation; keep them small and defined where
they are consumed).

## 8. Boolean flag parameters

**Symptoms.** `render(doc, true, false)`; `save(user, validate=False)`;
a function whose body is `if (flag) { A } else { B }` with little shared.

**Why it hurts.** The call site is unreadable without the signature.
The function has two behaviors with one name. Adding a third mode means a
second flag and four combinations, some meaningless.

**Example (JavaScript, before):**

```js
export function formatDate(d, includeTime, utc) { ... }
formatDate(order.createdAt, true, false);
```

**After:** either two functions or an options object with named fields.

```js
export function formatDate(d, { time = false, zone = "local" } = {}) {}
formatDate(order.createdAt, { time: true });
// or
export const formatDateTime = (d) => ...; export const formatDateOnly = (d) => ...;
```

**Example (Swift):** `func fetch(force: Bool)` becomes `func fetch(policy:
CachePolicy)` with `.cached`, `.refresh`; the enum can grow.

**Refactoring.** Split function (when the branches are mostly different);
replace flag with enum (when there will be more than two modes); use
named arguments if the language has them and the flag is rare.

**When it is fine.** A single boolean with a named argument in a language
that enforces naming at the call site (Swift, Kotlin, Python keyword-only).
Internal helpers with one call site.

## 9. Deep nesting

**Symptoms.** Four or more levels of indentation; `if` inside `for` inside
`if` inside `try`; the happy path is at the deepest level; `else` branches
far from their `if`.

**Why it hurts.** The reader tracks a stack of conditions to understand
any line. Error handling and the main logic interleave.

**Example (C#, before):**

```csharp
public Result Process(Order o) {
    if (o != null) {
        if (o.Items.Any()) {
            if (o.Customer.IsActive) {
                foreach (var item in o.Items) {
                    if (item.Stock > 0) {
                        // 20 lines of real work
                    } else { return Result.Fail("out of stock"); }
                }
                return Result.Ok();
            } else { return Result.Fail("inactive"); }
        } else { return Result.Fail("empty"); }
    } else { return Result.Fail("null"); }
}
```

**After:** guard clauses, then the work at indentation level one.

```csharp
public Result Process(Order o) {
    if (o is null) return Result.Fail("null");
    if (!o.Items.Any()) return Result.Fail("empty");
    if (!o.Customer.IsActive) return Result.Fail("inactive");
    var outOfStock = o.Items.FirstOrDefault(i => i.Stock <= 0);
    if (outOfStock is not null) return Result.Fail("out of stock");

    foreach (var item in o.Items) ProcessItem(item);
    return Result.Ok();
}
```

**Example (Python):** the same with early `return`/`raise` and `continue`
inside loops to skip rather than wrap.

**Refactoring.** Replace nested conditional with guard clauses; extract
the loop body; invert conditions to return early; decompose conditional
(name the condition with a predicate function).

**When it is fine.** Two levels is normal. Languages or codebases with a
"single exit point" convention (some embedded C) will prefer a flag; match
the house style and keep the nesting shallow another way.

## 10. Hidden side effects

**Symptoms.** A function named like a query (`getUser`, `isValid`,
`calculateTotal`) that writes: caches, logs at warn, mutates its
argument, sends a metric, changes global state. A getter that lazily
creates. A `validate` that normalizes in place.

**Why it hurts.** Callers cannot reason about the function from its name.
Calling it twice does something different from calling it once. Tests
have invisible dependencies on order.

**Example (Python, before):**

```python
def get_settings(user):
    s = Settings.query.filter_by(user_id=user.id).first()
    if s is None:
        s = Settings(user_id=user.id); db.add(s); db.commit()  # surprise write
    return s
```

**After:** `get_settings` returns `Optional[Settings]`; a separate
`ensure_settings(user)` creates; or rename to `get_or_create_settings` so
the write is in the name.

**Example (JavaScript):**

```js
function isValidEmail(input) {
  input.value = input.value.trim().toLowerCase();  // mutates the DOM element
  return RE.test(input.value);
}
```

Split into `normalizeEmail(str) -> str` and `isValidEmail(str) -> bool`.

**Refactoring.** Separate query from modifier (command-query separation);
rename to reveal the effect if the effect must stay; return the new value
instead of mutating the argument.

**When it is fine.** Memoization that is semantically invisible (same
result, cached). Logging at debug level. Documented and named
`getOrCreate` patterns.

## 11. Temporal coupling

**Symptoms.** Methods that must be called in an order the types do not
enforce: `conn.open(); conn.setTimeout(); conn.query()`; `builder.
setX(); builder.build()` where `build` throws if `setX` was skipped;
`init()` that must precede everything; a `Parser` whose `parse()` must
precede `errors()`.

**Why it hurts.** The correct order is folklore. The compiler cannot help.
The failure mode is a runtime error far from the cause, or silent wrong
results.

**Example (TypeScript, before):**

```ts
const client = new ApiClient();
client.setBaseUrl(url);   // forget this and every call 404s
client.setToken(token);
await client.get("/me");
```

**After:** constructor takes what is required; or a builder whose `build`
returns the usable object; or make the dependent method take the
prerequisite as an argument.

```ts
const client = new ApiClient({ baseUrl: url, token });
await client.get("/me");
```

**Example (Rust):** the typestate pattern makes order a compile error:
`Connection<Closed>::open() -> Connection<Open>`, and `query` exists only
on `Connection<Open>`.

**Example (Java):** `Parser p = new Parser(); p.parse(src); p.getErrors()`
becomes `ParseResult r = Parser.parse(src); r.errors()`.

**Refactoring.** Pass prerequisites as parameters; return the next-stage
object from the previous stage; make the constructor do the required
setup; typestate where the language supports it.

**When it is fine.** Lifecycle hooks mandated by a framework
(`componentDidMount`, `viewDidLoad`); the framework guarantees the order.
Resource handles whose language has a scoped construct (`with`, `using`,
`defer`) that encodes the pairing.

## 12. Magic values

**Symptoms.** Literals with meaning: `if (status == 3)`, `sleep(86400)`,
`retries < 5`, `"admin"`, `0.0825`, `x * 1.5`; the same literal in
several places; a literal whose unit is unclear.

**Why it hurts.** The meaning is in the author's head. Changing it means
finding every copy. `86400` vs `86000` is invisible.

**Example (Go, before):**

```go
if time.Since(u.LastLogin) > 30*24*time.Hour && u.Role != "admin" { ... }
```

**After:**

```go
const inactiveAfter = 30 * 24 * time.Hour
if time.Since(u.LastLogin) > inactiveAfter && u.Role != RoleAdmin { ... }
```

**Example (PHP):** `if ($order->status === 3)` becomes an enum `OrderStatus::
Shipped` (PHP 8.1+) or a class constant.

**Refactoring.** Replace magic number with symbolic constant; replace
string literal with enum; put the unit in the name (`timeoutMs`,
`maxRetries`) or the type (`Duration`).

**When it is fine.** `0`, `1`, `-1` in obvious arithmetic; `2` in
"divide by two"; array indices in a format with a comment; test
fixtures where the literal is the point.

## 13. Inconsistent abstraction levels

**Symptoms.** In one function: a high-level call (`chargeCustomer(order)`)
followed by low-level detail (`buf.write(b'\x00' * padding)`). Business
logic next to byte manipulation; a domain method that formats JSON.

**Why it hurts.** The reader has to switch mental gears mid-function. The
low-level detail obscures the high-level flow and the high-level flow
hides the low-level detail from the tests that need to pin it.

**Example (Python, before):**

```python
def complete_checkout(cart, user):
    total = cart.total()
    payment = charge(user.payment_method, total)
    # low-level: build the receipt bytes inline
    lines = [f"{i.name:<30}{i.price:>10.2f}" for i in cart.items]
    body = "\n".join(lines).encode("utf-8")
    pdf = b"%PDF-1.4\n" + body + b"\n%%EOF"
    email(user.email, "Your receipt", attachment=pdf)
    return payment.id
```

**After:** `receipt_pdf(cart) -> bytes` extracted; `complete_checkout` is
three high-level calls.

**Refactoring.** Extract function at the lower level until every statement
in the function is at the same altitude. Reading the function should feel
like reading a table of contents or like reading a paragraph, not both.

**When it is fine.** Short glue code at a boundary (a handler that
unpacks a request and calls a service) is by nature two levels; keep the
low-level part small.

## 14. Leaky abstractions

**Symptoms.** An interface that exposes the implementation: a `Repository`
whose methods take SQL fragments; a `Cache` interface with `getRedisClient()`;
a `Storage` abstraction whose error type is `S3Exception`; callers that
import the concrete library through the abstraction.

**Why it hurts.** The abstraction promises substitutability and cannot
deliver it. Callers couple to the implementation while believing they are
decoupled. Switching the implementation becomes a rewrite.

**Example (TypeScript, before):**

```ts
interface UserRepo {
  find(where: string): Promise<User[]>;   // callers write SQL fragments
}
await repo.find(`email = '${email}'`);     // and now there is injection too
```

**After:** the interface speaks the domain.

```ts
interface UserRepo {
  findByEmail(email: string): Promise<User | null>;
  findActiveSince(d: Date): Promise<User[]>;
}
```

**Example (Java):** a service method declared `throws SQLException` leaks
the persistence choice to every caller; wrap into a domain exception at
the repository boundary (`error-handling-review.md`).

**Refactoring.** Narrow the interface to what callers need in domain
terms; translate errors at the boundary; hide the client object.

**When it is fine.** When there is one implementation and no intent to
swap it, do not have the abstraction at all (Speculative generality); a
leaky interface is worse than no interface. Escape hatches
(`rawQuery()`) are acceptable if clearly named and rarely used.

## 15. Comments that explain what instead of why

**Symptoms.** `i++ // increment i`; `// loop over users` above `for user
in users`; comments that restate the next line; comments that are out of
date because the code moved on; commented-out code.

**Why it hurts.** Noise that trains readers to skip comments, so they skip
the one that matters. Stale comments are actively wrong.

**Example (before):**

```js
// check if user is admin
if (user.role === "admin") {
  // set the flag to true
  canDelete = true;
}
```

**After:** no comment, or the comment that was missing:

```js
// Admins bypass ownership: support needs to remove abusive content
// on accounts they do not own (see INC-412).
if (user.role === "admin") canDelete = true;
```

**Refactoring.** Delete restating comments; rename so the code says what
the comment said; keep comments that record why, constraints, references,
and non-obvious consequences. Delete commented-out code; git has it.

**When it is fine.** Doc comments on public APIs that describe contract
(what it returns, when it throws) are "what" comments and are correct.
Section headers in long declarative files. `readability-and-naming.md`
has the full treatment.

## 16. Duplicated code

**Symptoms.** The same ten lines in three places with different variable
names; copy-pasted functions that have since diverged by one line each;
the same validation in the handler and in the job.

**Why it hurts.** A fix applied to two of three copies. Divergence that
nobody intended. Tests that cover one copy.

**Refactoring.** Extract function; pull up method; form template method
when the variation is in the middle; replace with a library call when the
duplication is of something standard (date math, chunking, retry).

**When it is fine.** Two similar lines are not duplication. Code that
looks alike but will change for different reasons (two domain rules that
happen to have the same shape today) should stay separate; merging it
creates coupling. Test code tolerates more repetition in exchange for
each test being readable alone. The rule of three: wait for the third
copy before abstracting, and when you do, abstract what is actually
common, not what looks common.

## 17. Long parameter list

**Symptoms.** More than four or five parameters; several of the same type
adjacent (`(string, string, string)`); callers passing `null` or defaults
for most of them.

**Why it hurts.** Call sites are unreadable and arguments get swapped.
Often a Data clump or a missing object.

**Example (Kotlin, before):**

```kotlin
fun createUser(name: String, email: String, phone: String?, locale: String,
               timezone: String, marketingOptIn: Boolean, referrer: String?) {}
```

**After:** `fun createUser(profile: Profile, prefs: Preferences, referrer:
Referrer?)` or a request data class. Kotlin's named arguments make the
original tolerable at call sites, which is why this is a nit there and a
should-fix in Java.

**Refactoring.** Introduce parameter object; preserve whole object (pass
the `Order` instead of five of its fields); replace parameter with method
call when the callee can compute it.

**When it is fine.** Constructors in languages with named arguments and
defaults (Python dataclasses, Kotlin, Swift). Mathematical functions
whose parameters are genuinely independent.

## 18. Dead code

**Symptoms.** Unreferenced functions, unused parameters, unreachable
branches (`if (false)`, code after `return`), feature flags that are
always on, commented-out blocks, exports nobody imports, `TODO: remove
after migration` from two years ago.

**Why it hurts.** Readers assume it matters and try to understand it.
It still has to compile, lint and be maintained through refactors. Dead
feature-flag branches are a security surface.

**Refactoring.** Delete. Use the tooling to find it: `knip`/`ts-prune`
(TS), `vulture` (Python), `deadcode`/`staticcheck -checks U1000` (Go),
`cargo udeps` and compiler warnings (Rust), IDE inspections (Java,
Kotlin, C#), `debride` (Ruby). Confirm with grep across the repo and any
known consumers before deleting a public symbol.

**When it is fine.** Public library API kept for compatibility (mark
deprecated with a removal version). Code behind a flag that is
scheduled to flip. Never: "we might need it later". Git has it.

## 19. Message chains and middle men

**Symptoms.** `order.getCustomer().getAddress().getCountry().getCode()`;
a class where every method forwards to another object with no added
behavior.

**Why it hurts.** Chains couple the caller to the whole path; a change in
the middle breaks it. Middle men add indirection without adding anything.

**Refactoring.** Hide delegate (`order.countryCode()`); remove middle man
(call the delegate directly) when the wrapper adds nothing; keep the
wrapper when it is a deliberate boundary.

**When it is fine.** Fluent builders and stream/collection pipelines are
chains by design. Facades over a complex subsystem are middle men by
design.

## 20. Mutable global state

**Symptoms.** Module-level mutable variables; singletons with setters;
`static` mutable fields; a `config` object mutated at runtime; a
module-level `cache = {}`.

**Why it hurts.** Any function can change it; tests interfere with each
other; concurrency bugs; initialization order dependencies.

**Example (Python, before):**

```python
_current_tenant = None
def set_tenant(t): global _current_tenant; _current_tenant = t
def query(): return db.filter(tenant=_current_tenant)
```

**After:** pass the tenant explicitly, or use a context-scoped mechanism
(`contextvars.ContextVar` in Python, request context in web frameworks,
`AsyncLocalStorage` in Node, `context.Context` values in Go).

**Refactoring.** Pass as parameter; encapsulate in an object with a
narrow interface; use context-local storage for request-scoped values;
make truly global constants immutable.

**When it is fine.** Immutable constants. A process-wide logger or metrics
registry (write-only, append semantics). Dependency injection containers
built at startup and frozen.

## 21. Exceptions as control flow

**Symptoms.** `try { parseInt } catch { default }` for expected input;
raising to exit a loop; `catch (NotFound) { create }` as the normal path;
Python `except KeyError` to test membership when `in` exists.

**Why it hurts.** Expensive in most runtimes, obscures the normal path,
and catches more than intended.

**Refactoring.** A query that returns a result (`tryParse`, `dict.get`,
`Optional`, `Result`), or a check before the operation when it is cheap
and race-free. Python's EAFP idiom for a single operation that would race
if checked first (`try: os.remove(path) except FileNotFoundError: pass`)
is the legitimate exception. The full treatment of catch-alls, swallowed
errors and error types is in `error-handling-review.md`.

## 22. Reviewing smells: severity and when to say nothing

A smell is a nit unless:

- It hides or causes a bug you can name (then it is the bug's severity).
- It is in code that changes often (`git log --oneline -- path | wc -l`);
  the cost of a smell is proportional to how many future readers pay it.
- It is in the public surface of a module or library, where fixing later
  means a breaking change.
- The author introduced the smell into previously clean code (regression
  in maintainability is a should-fix; pre-existing smell the diff merely
  touches is at most a side note).

Say nothing when: the smell is pre-existing and the diff does not make it
worse; the fix would be scope creep for this PR (note it for a follow-up
if it matters); you would be arguing taste; the code is a throwaway
script or a test fixture where the smell has no cost.

When you do raise a smell, name it, say why it costs something here, and
give the refactoring by name with a sketch. "This is feature envy; the
three fields it reads from `Invoice` suggest `Invoice#total` is missing.
Move method?" is actionable. "Could be cleaner" is not.
