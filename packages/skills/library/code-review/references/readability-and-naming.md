# Readability and naming

What makes code easy to read for the person who did not write it, and how
to comment on it without bikeshedding. Covers naming principles with
before/after, function size and shape, nesting and early returns,
comments that earn their place, formatting as a tool's job, and heuristics
for cognitive load. Formatting and most naming conventions should be
enforced by linters; this file is for the judgment that remains.

## Contents

1. What readability is for
2. Naming principles
3. Function size and shape
4. Nesting, early returns, and the happy path
5. Comments: why, not what
6. Formatting is a tool's job
7. Cognitive load heuristics
8. Consistency with the codebase
9. Reviewing readability without bikeshedding

## 1. What readability is for

Code is read far more often than it is written, by people (and agents)
who have less context than the author had. Readability is the property of
answering the reader's questions in the order they ask them: what does
this do, what does it need, what can go wrong, where is the thing I am
looking for. It is not about line count or cleverness. The measure is how
long a competent stranger takes to make a correct change.

Every principle below is a way of lowering the number of things a reader
must hold in their head at once.

## 2. Naming principles

### Intent-revealing: say what it is for, not what it is

| Before | After | Why |
|---|---|---|
| `data`, `info`, `obj`, `item`, `value`, `result`, `temp` | `unpaidInvoices`, `retryBudget`, `parsedHeader` | Generic nouns force the reader to find the assignment to learn the meaning |
| `list1`, `arr2`, `map` | `activeUsers`, `ordersByCustomerId` | The type is in the declaration; the name should carry the meaning |
| `handle()`, `process()`, `doIt()`, `manage()` | `applyDiscount()`, `archiveStaleSessions()` | A verb with no object says nothing |
| `flag`, `check`, `status` (as boolean) | `isExpired`, `hasPendingWrites`, `canRetry` | Booleans read as predicates at the call site |
| `getUser()` (that hits the network and caches) | `fetchUser()` or `loadUser()` | `get` implies cheap and pure in most codebases; match the local convention |
| `UserManager`, `DataHelper`, `Utils` | `UserDirectory`, `MoneyFormatter`, or split by what each does | Suffixes like Manager/Helper/Util mean "I could not name this" |

### Consistent vocabulary: one word per concept

Pick one of `fetch`/`get`/`load`/`retrieve` for "read from a remote
source" and use it everywhere. One of `remove`/`delete`/`destroy`. One of
`customer`/`client`/`account`/`user` for the same entity. The codebase
decides; grep to find the dominant term before introducing a synonym.

```ts
// before: three words for one thing across the module
fetchOrders(); loadCustomer(); retrieveInvoices();
// after
fetchOrders(); fetchCustomer(); fetchInvoices();
```

The reverse also holds: one concept per word. If `account` means a login
in the auth module and a ledger in billing, every conversation about
"accounts" is ambiguous. Rename one.

### Scope-length rule

Name length should grow with the distance between declaration and use.

```go
for i, u := range users { total += u.Balance }          // fine: i and u live two lines
var activeSubscriptionCountByRegion map[string]int      // fine: package-level, read far from here
func (s *svc) r(c ctx, id string) (*U, error)           // not fine: public-ish method with cryptic names
```

In Go, Rust, and functional code, short names in short scopes are
idiomatic; in Java and C#, longer names everywhere are idiomatic. Match
the language, then the codebase.

### Avoid encodings and noise

Hungarian notation (`strName`, `iCount`), type suffixes (`userList`,
`nameString`), and scope prefixes (`m_`, `g_`) duplicate what the type
system or IDE shows. Exceptions: codebases that already use them
(consistency wins), and the `_` prefix for intentionally unused (`_ctx`)
or private-by-convention (Python `_internal`) where the language has no
better mechanism.

Noise words: `the`, `a`, `Object`, `Data`, `Info` add length without
meaning. `theUser` vs `user`; `userData` vs `user`; `OrderInfo` vs
`Order`.

### Units and types in the name when the type system cannot carry them

`timeoutMs`, `maxRetries`, `sizeBytes`, `priceCents`, `createdAtUtc`.
Better still, use a type (`Duration`, `Money`) and then the unit is in the
type. When the language gives you only a number, put the unit in the
name, every time.

### Positive booleans, predicates as questions

`isEnabled` not `isNotDisabled`; `if (user.isActive)` not `if
(!user.isInactive)`. Double negatives cost a beat per read. Functions that
return booleans read as questions: `canRetry()`, `hasExpired()`,
`shouldArchive()`, `exists()`.

### Pairs should be symmetric

`open/close`, `start/stop`, `begin/end`, `add/remove`, `create/destroy`,
`acquire/release`, `show/hide`, `enable/disable`. Mixing pairs
(`open/stop`, `add/delete`) makes the reader check whether they are
really partners.

### Name the thing you compare against

```python
# before
if len(password) < 12 or time.time() - created > 2592000:
# after
MIN_PASSWORD_LENGTH = 12
PASSWORD_MAX_AGE = timedelta(days=30)
if len(password) < MIN_PASSWORD_LENGTH or now - created > PASSWORD_MAX_AGE:
```

### Renaming examples across languages

```rust
// before
fn proc(d: &Vec<T>, f: bool) -> Vec<T>
// after
fn filter_expired(entries: &[Entry], include_grace_period: bool) -> Vec<Entry>
// better: the boolean becomes an enum
fn filter_expired(entries: &[Entry], grace: GracePolicy) -> Vec<Entry>
```

```java
// before
public List<Map<String, Object>> getData(int t, String s)
// after
public List<OrderSummary> findOrdersForTenant(TenantId tenant, OrderStatus status)
```

```ruby
# before
def calc(a, b, c) = a * b * (1 - c)
# after
def net_price(unit_price, quantity, discount_rate) = unit_price * quantity * (1 - discount_rate)
```

## 3. Function size and shape

There is no right line count. The useful tests:

- **One level of abstraction.** Every statement in the function is at
  the same altitude. A function that calls `chargeCustomer()` should not
  also be concatenating bytes (`code-smells.md` section 13).
- **Fits the reader's working memory.** Roughly: can the reader hold
  every local variable's meaning at once? Past five or six live locals,
  something wants extracting.
- **Named after what it does, completely.** If the honest name is
  `validateAndSaveAndNotify`, it is three functions, or one function
  that calls three.
- **Shape matches the task.** A pipeline reads top to bottom with no
  branches. A dispatcher is one `switch`. A validator is a list of
  guards. A function that is all three is hard to read because its shape
  keeps changing.

Function length is a nit unless it hides a bug or the function is in
a hot-change area. Say "three phases, each could be a function named after
its comment" rather than "too long".

Parameters: past four, look for a data clump or an object that should be
passed whole. Output parameters (mutating an argument to return a result)
are a readability cost in any language that can return tuples or records.

## 4. Nesting, early returns, and the happy path

The happy path should be at the lowest indentation, read top to bottom,
and the failure paths should exit early and be visible.

```js
// before: happy path buried at depth 3
function ship(order) {
  if (order) {
    if (order.isPaid) {
      if (order.items.length > 0) {
        return carrier.dispatch(order);
      } else {
        throw new Error("empty");
      }
    } else {
      throw new Error("unpaid");
    }
  } else {
    throw new Error("no order");
  }
}

// after: guards, then the work
function ship(order) {
  if (!order) throw new Error("no order");
  if (!order.isPaid) throw new Error("unpaid");
  if (order.items.length === 0) throw new Error("empty");
  return carrier.dispatch(order);
}
```

Other nesting reducers:

- `continue` in loops instead of wrapping the body in an `if`.
- Extract the loop body into a function when it has its own branches.
- Invert the condition: `if (!valid) return; doWork()` rather than `if
  (valid) { doWork() }`.
- Combine guards that produce the same outcome, but only when the
  combined condition still reads clearly; otherwise name it as a
  predicate function.
- Replace `if/else if/else if` chains over a value with a lookup table
  or `switch`/`match`.

Early returns are controversial in a few codebases (single-exit
conventions in some C and in some style guides). Match the house style;
if the house style is single-exit, reduce nesting by extraction instead.

## 5. Comments: why, not what

The code says what. A comment earns its place when it says something the
code cannot:

| Worth a comment | Example |
|---|---|
| Why this approach, especially when a simpler one looks correct | `// Sorted insert instead of sort-at-end: callers read mid-build and expect order.` |
| A constraint from outside the code | `// Stripe rejects amounts over 999,999.99 per call; split above that.` |
| A non-obvious consequence | `// Must run before migrations: the index drop below is unsafe if rows exist.` |
| A reference | `// See RFC 7231 section 6.5.4 for why 404 and not 410 here.` |
| An intentional oddity | `// Yes, 1-indexed: the upstream CSV counts from 1 and the docs match it.` |
| A known limitation | `// Does not handle leap seconds; acceptable per TICKET-123.` |
| A warning | `// Not thread-safe; callers hold writeLock.` |

Not worth a comment: anything a rename fixes; anything the next line says;
a change log (git has it); the author's name (git has it); commented-out
code (git has it).

```python
# before
# increment the counter
count += 1
# loop through the users
for user in users:
    # check if active
    if user.active:
        ...

# after: no comments needed; the one that was missing:
for user in users:
    if user.active:
        # Inactive users keep their quota for 30 days so a reactivation
        # does not reset it (support request, see TICKET-88).
        ...
```

### TODO hygiene

A TODO is a debt record. It needs an owner or ticket and, ideally, a
condition for removal: `// TODO(TICKET-412): remove after v3 clients are
gone (check metrics.client_version)`. A bare `// TODO: fix this` is a
should-fix in review: either do it, ticket it, or delete the comment.
Many linters can enforce the format (`eslint-plugin-unicorn/
expiring-todo-comments`, `ruff` `TD` rules, `godox`).

### Doc comments

Public functions, types and modules get a doc comment in the language's
convention (JSDoc/TSDoc, docstrings, godoc, rustdoc, Javadoc, KDoc,
XML docs, YARD). The doc comment states the contract: what it does, what
it needs, what it returns, what it throws or when it errors, and anything
surprising. It does not restate the signature. Keep examples in doc
comments runnable where the toolchain supports it (rustdoc tests, Python
doctest, Go examples).

### Stale comments

A comment that no longer matches the code is worse than none. In review,
when the diff changes behavior near a comment, read the comment and check
it still holds. "nit: the comment on line 8 says 'returns null on miss'
but the function now throws."

## 6. Formatting is a tool's job

If the repository has a formatter (Prettier, Biome, Black, Ruff format,
gofmt, rustfmt, ktlint, SwiftFormat, dotnet format, php-cs-fixer,
RuboCop), formatting is not a review topic. If a diff contains formatting
changes the tool did not produce, the comment is "run the formatter". If
there is no formatter, propose adding one in a separate PR, and do not
comment on formatting in this one beyond asking for consistency with the
surrounding file.

Likewise for import order, quote style, trailing commas, line length,
semicolons: lint rules, not review comments. The review's job is what
tools cannot see.

## 7. Cognitive load heuristics

Ways to notice that code is harder to read than it needs to be:

- **How many things must the reader know before this line makes sense?**
  Each live variable, each implicit precondition, each piece of global
  state is one. Past about seven, restructure.
- **How far is the definition from the use?** A variable assigned 80
  lines above its use, a constant defined in another file with a generic
  name, a callback registered in one module and fired from another.
- **How many times does the reader change altitude?** Business logic,
  then byte-twiddling, then business logic again. Each switch costs.
- **How many negations are in the condition?** `!(a && !b) || !c` needs
  a truth table. Name the predicate.
- **How many ways can control leave this block?** Returns, throws,
  breaks, continues, callbacks. More than two or three and the reader
  loses track of what has run.
- **Is the surprising thing marked?** If a function does something
  unexpected (mutates its argument, is slow, must be called once), is
  that in the name or a comment at the call site?
- **Could this be a table?** Chains of `if/else` mapping inputs to
  outputs are usually clearer as a map literal or a `match`.
- **Is clever saving anything?** A one-liner with three nested ternaries,
  a regex that does five things, a reduce that builds an object with
  side effects. If it took you two reads, it will take the next person
  four.

```ts
// before: clever
const label = a ? b ? "both" : "a" : b ? "b" : "none";
// after: table
const label = { "true,true": "both", "true,false": "a", "false,true": "b", "false,false": "none" }[`${a},${b}`];
// or plainer still
let label = "none";
if (a && b) label = "both"; else if (a) label = "a"; else if (b) label = "b";
```

## 8. Consistency with the codebase

Local consistency beats global preference. Before commenting on a name or
a structure, check what the surrounding code does:

```sh
# What verb does this codebase use for remote reads?
grep -rhoE '\b(fetch|get|load|retrieve)[A-Z]\w+\(' src | sed -E 's/[A-Z].*//' | sort | uniq -c
# How are errors created?
grep -rn 'new Error\|throw \|raise \|errors.New\|fmt.Errorf' src | head
# How are tests named?
ls tests/ | head; grep -rhoE '^(test_|it\(|describe\(|func Test)' tests src | sort | uniq -c
# What does the lint config enforce already?
cat .eslintrc* biome.json ruff.toml .golangci.yml .rubocop.yml 2>/dev/null
```

If the codebase is consistent and the diff deviates: comment, cite the
convention with a file:line example. If the codebase is itself
inconsistent: do not pick a side in this PR; note it as a candidate for a
convention decision, separately. If the convention is bad: still follow
it in this PR, and open the convention change as its own proposal with
the lint rule that would enforce it.

## 9. Reviewing readability without bikeshedding

Readability comments are the most likely to be perceived as taste, so
hold them to a higher bar:

- **Cite the reader's cost**, not your preference. "A reader has to
  scroll to line 12 to learn what `data` is" is a cost. "I prefer longer
  names" is not.
- **Offer the name.** "`pendingInvoices`?" costs the author nothing to
  accept.
- **Batch.** One comment with all naming nits, not six.
- **Skip pre-existing issues** the diff merely touches, unless the author
  is already changing that line.
- **Never block** on readability alone unless the name is actively
  misleading (`isValid` returning the error message; `delete` that
  archives). Misleading is a should-fix because it causes bugs.
- **Defer on taste** after one exchange. If the author has heard the
  cost and prefers their name, approve.
