# Refactoring safely

How to change the shape of code without changing what it does, and how to
prove it. Covers the safe workflow, characterization tests, the catalog of
named refactorings with before/after, the strangler fig for big
replacements, splitting modules and giant changes, breaking dependency
cycles, dependency inversion without ceremony, the refactor-vs-rewrite
decision, incremental pattern migration with codemods and lint ratchets,
and measuring that behavior is preserved.

## Contents

1. The definition and why it matters
2. The safe workflow
3. Characterization tests
4. Catalog of named refactorings
5. Dependency direction and breaking cycles
6. Dependency inversion done simply
7. Strangler fig for big replacements
8. Splitting a module
9. Splitting a giant change into reviewable PRs
10. Refactor vs rewrite: the decision matrix
11. Migrating a pattern incrementally: codemods and ratchets
12. Measuring that behavior is preserved
13. Failure modes

## 1. The definition and why it matters

A refactoring is a change to the structure of code that preserves its
observable behavior. Observable means: same outputs for the same inputs,
same side effects, same errors for the same bad inputs, same performance
within the tolerance that matters. If any of those change, it is not a
refactoring; it is a behavior change, and it needs its own commit, its
own tests and its own sentence in the description.

The reason to be strict about this is reviewability. A reviewer can
verify "behavior is unchanged" cheaply if they can trust the claim: they
check that tests did not change and are green. They cannot verify a diff
that mixes a rename, an extraction, a bug fix and a tightened null check,
so they either rubber-stamp it or reject it. Keeping refactoring pure is
what makes large structural changes mergeable.

## 2. The safe workflow

1. **Agree the target.** Write one sentence: "After this, X is true"
   (the module has no cycle with Y; `process` is under 40 lines and each
   phase is testable; `Order` no longer knows about HTTP). Write the
   boundary: which files are in scope. Say both back to the user.
2. **Run the suite and record the result.** Including what is already red
   or skipped. You need to know what "unchanged" means.
3. **Check coverage of the target.** If the code you are about to
   restructure has no tests exercising its branches, stop and write
   characterization tests (section 3) before touching it.
4. **One named transformation.** Extract function. Run tests. Commit with
   the transformation in the message (`refactor: extract validateUpload
   from handle_upload`). Next transformation.
5. **Keep a parking lot.** Bugs, smells and ideas you notice go in a
   note, not in the diff. Raise them at the end.
6. **Verify preservation** (section 12). Suite green, behavior diff empty,
   lint clean, `git diff --stat` shows only the boundary.
7. **Present.** Commits in order; description lists each transformation
   and how preservation was verified; parking lot as a separate list.

Use the IDE's automated refactorings where they exist (rename, extract,
move, inline, change signature). They are correct in cases a human
forgets (reflection-free languages: nearly always; dynamic languages:
check string references and templates by grep afterwards).

## 3. Characterization tests

A characterization test pins what the code does now, including behavior
that looks wrong. It is not a spec; it is a tripwire.

How to write them quickly:

1. Identify the inputs that reach the code: call sites, request shapes,
   fixtures. Collect a representative set, including edge cases found by
   reading the branches (each `if` suggests two inputs).
2. Call the code and record the output. Do not reason about what it
   should be; capture what it is.
3. Assert on the recording. For complex outputs, a golden file is fine
   here (this is the one place snapshot tests are the right tool).
4. If you see behavior that is clearly a bug, keep the test pinning the
   bug, and add a comment: `# characterization: current behavior returns
   0 for negative input, probably a bug, see TICKET`. Fix it in a later,
   separate commit, updating the test deliberately.

Example (Python, pinning a legacy pricing function before restructuring):

```python
import pytest
from legacy.pricing import compute_price

CASES = [
    # (qty, unit, coupon, region) -> observed output on main @ a1b2c3d
    ((1, 10.0, None, "US"), 10.0),
    ((3, 10.0, None, "US"), 30.0),
    ((3, 10.0, "TEN", "US"), 27.0),
    ((0, 10.0, None, "US"), 0.0),
    ((-1, 10.0, None, "US"), 0.0),       # characterization: negative clamps to 0
    ((3, 10.0, "TEN", "EU"), 32.13),     # characterization: VAT applied after coupon
    ((3, 10.0, "BOGUS", "US"), 30.0),    # characterization: unknown coupon ignored silently
]

@pytest.mark.parametrize("args,expected", CASES)
def test_compute_price_characterization(args, expected):
    assert compute_price(*args) == pytest.approx(expected)
```

Example (TypeScript, golden output for a report renderer):

```ts
import { renderReport } from "../legacy/report";
import fixtures from "./fixtures/reports.json";

test.each(fixtures)("renderReport($name) matches recorded output", (f) => {
  expect(renderReport(f.input)).toMatchSnapshot();
});
// Commit the snapshots on the unchanged code first; the refactor must not touch them.
```

For code with I/O, record the I/O at the boundary (VCR-style HTTP
recording: `vcrpy`, `nock`, `WireMock`, `go-vcr`) rather than mocking
internals; mocks of internals break under refactoring by definition.

How much is enough: every branch of the code you intend to move gets at
least one input. Use a coverage tool on the characterization suite alone
to confirm (`pytest --cov=legacy.pricing`, `jest --coverage
--collectCoverageFrom=src/legacy/report.ts`, `go test -coverprofile`).

## 4. Catalog of named refactorings

Each entry: when, mechanics, and a before/after. The names are Fowler's
where they exist, so you can cite them in commit messages and reviews.

### Extract function

When: a block has a name waiting for it (often a comment), or is
duplicated, or is at a lower level of abstraction than its neighbors.

Mechanics: copy block to a new function named by intent; pass in the
locals it reads; return the locals it writes (if more than one, that is a
data clump: return a small object); replace the block with a call; run
tests.

```go
// before
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    var req CreateReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "bad json", 400); return }
    if req.Name == "" { http.Error(w, "name required", 400); return }
    if len(req.Tags) > 10 { http.Error(w, "too many tags", 400); return }
    // ... 40 more lines
}

// after
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    req, err := decodeCreateReq(r)
    if err != nil { http.Error(w, err.Error(), 400); return }
    // ...
}

func decodeCreateReq(r *http.Request) (CreateReq, error) {
    var req CreateReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil { return req, errors.New("bad json") }
    if req.Name == "" { return req, errors.New("name required") }
    if len(req.Tags) > 10 { return req, errors.New("too many tags") }
    return req, nil
}
```

### Inline function

When: the function body is as clear as its name, or it is a middle man,
or you are about to re-extract along different lines.

```js
// before
const isAdult = (u) => u.age >= 18;
if (isAdult(user)) ...
// after (only if "age >= 18" is as clear in context; often it is not and you keep the function)
if (user.age >= 18) ...
```

### Rename

When: the name lies, is vague, or uses vocabulary different from the rest
of the codebase. The most valuable refactoring per minute spent.

Mechanics: IDE rename; then grep for the old name in strings, templates,
docs, config, serialized formats, database columns and API fields (those
last ones are not renames, they are compatibility changes; see
`api-and-compat-review.md`).

### Move function / move field

When: a function uses another module's data more than its own (feature
envy), or a module has grown two responsibilities.

Mechanics: copy to destination; make the original delegate; move callers
one at a time (tests between batches if many); delete the original.

### Extract class / extract module

When: a class has clusters of fields used by disjoint method groups; a
file has two reasons to change.

Mechanics: create the new class with the cluster's fields; move methods
one at a time (each is a Move function); replace the old fields with a
reference to the new object; consider whether the old class should hold
the new one or callers should get it directly.

### Introduce parameter object

When: the same group of parameters appears in several signatures.

```kotlin
// before
fun search(q: String, page: Int, size: Int, sort: String, desc: Boolean): Page<Doc>
fun export(q: String, page: Int, size: Int, sort: String, desc: Boolean): ByteArray
// after
data class Paging(val page: Int, val size: Int, val sort: String, val desc: Boolean = false) {
    init { require(page >= 0); require(size in 1..500) }
    val offset get() = page * size
}
fun search(q: String, paging: Paging): Page<Doc>
fun export(q: String, paging: Paging): ByteArray
```

### Replace conditional with polymorphism

When: a `switch` on a type code appears in several places, each doing
type-specific work.

```ts
// before: switch repeated in price(), label(), icon()
function price(item: Item) {
  switch (item.kind) {
    case "book": return item.pages * 0.1;
    case "video": return item.minutes * 0.5;
  }
}
// after
interface Item { price(): number; label(): string }
class Book implements Item { constructor(private pages: number) {} price() { return this.pages * 0.1 } ... }
class Video implements Item { ... }
```

Only when the switch is repeated. A single switch over a closed enum is
clearer than a class hierarchy; add an exhaustiveness check instead.

### Replace conditional with guard clauses / decompose conditional

When: nesting is deep, or a condition is long and unnamed.

```python
# before
if user and user.is_active and not user.is_locked and (user.plan == "pro" or user.trial_until > now()):
    ...
# after
def can_access_pro_features(user, now):
    if not user or not user.is_active or user.is_locked:
        return False
    return user.plan == "pro" or user.trial_until > now
```

### Replace temp with query; split variable

When: a local is assigned once and read many times across a long function
(extract to a function so extracted pieces can share it); or a local is
reused for two meanings (split into two names).

### Replace magic literal with constant / replace type code with enum

See `code-smells.md` sections 12 and 5.

### Encapsulate collection / encapsulate record

When: a class exposes a mutable list or a raw dict that callers modify.

```java
// before
public List<Item> getItems() { return items; }   // callers call .add()
// after
public List<Item> getItems() { return Collections.unmodifiableList(items); }
public void addItem(Item i) { validate(i); items.add(i); }
```

### Pull up / push down

When: subclasses share a method (pull up); a superclass method is used by
one subclass (push down). Prefer composition over deepening a hierarchy;
if you are pulling up for the third time, the hierarchy may be wrong.

### Replace inheritance with delegation

When: a subclass uses a fraction of the parent's interface, or overrides
methods to disable them.

```ruby
# before
class Stack < Array; end     # exposes insert, shuffle, [] ...
# after
class Stack
  def initialize = @items = []
  def push(x) = @items.push(x)
  def pop = @items.pop
end
```

### Change function declaration (add/remove parameter, change signature)

Mechanics for a widely used function: add the new signature as a new
function; make the old delegate to it; migrate callers in batches;
remove the old. For public APIs, the old one gets a deprecation period
(`api-and-compat-review.md`).

### Separate query from modifier

See `code-smells.md` section 10. Mechanics: copy the function, strip side
effects from the copy (the query), strip the return value from the
original (the modifier), replace each call with the right one or both.

### Replace loop with pipeline

When: a loop filters, maps and accumulates and the language has
expressive collection operations.

```csharp
// before
var names = new List<string>();
foreach (var u in users) if (u.Active) names.Add(u.Name.ToUpper());
// after
var names = users.Where(u => u.Active).Select(u => u.Name.ToUpper()).ToList();
```

Stop when the pipeline needs an index, early exit, or side effects; a
loop is clearer then.

### Introduce null object / replace null with Optional

When: callers check for null before every use.

```swift
// before
let name = user?.profile?.displayName ?? "Anonymous"   // repeated in 12 views
// after: a Guest user type with displayName "Anonymous", or
extension User { var displayNameOrDefault: String { profile?.displayName ?? "Anonymous" } }
```

## 5. Dependency direction and breaking cycles

Dependencies should point from volatile to stable, from edges to core:
handlers depend on services depend on domain; infrastructure
(database, HTTP clients) is depended upon through interfaces the core
owns. A cycle (A imports B imports A) means neither can be understood,
tested or deployed alone.

Find cycles:

```sh
# JS/TS
npx madge --circular --extensions ts,tsx src/
npx dpdm --circular src/index.ts
# Python
pip install pydeps && pydeps src --show-cycles
# or: python -X importtime -c "import pkg" 2>&1 | sort -k2 -n   # slow imports hint at tangles
# Go: the compiler forbids package cycles; the symptom is a giant package instead
go list -deps ./... | sort | uniq -c | sort -rn | head   # most-imported packages
# Java/Kotlin
# jdeps -verbose:class build/classes | grep -E '->' ; or ArchUnit tests; or IntelliJ "Analyze Cyclic Dependencies"
# Rust: crate cycles are compile errors; module cycles inside a crate are allowed but smelly
cargo modules dependencies --package mycrate 2>/dev/null | grep -i cycle
```

Breaking a cycle, in order of preference:

1. **Move the shared thing.** If A and B both need `Money`, `Money` goes
   in a third module `C` that both import. Most cycles are this.
2. **Invert one edge with an interface.** If `OrderService` calls
   `EmailSender` and `EmailSender` imports `Order` for formatting,
   define `OrderSummary` (plain data) in the order module and have the
   email module depend on that; or define `Notifier` interface in the
   order module and implement it in the email module (section 6).
3. **Merge.** If A and B are always changed together and neither makes
   sense alone, they are one module pretending to be two.
4. **Event or callback.** A publishes "order placed"; B subscribes. Use
   when the coupling is genuinely asynchronous; otherwise this hides the
   dependency rather than removing it.

Enforce the direction once fixed: `eslint-plugin-boundaries` or
`eslint-plugin-import/no-restricted-paths` (TS), `import-linter` (Python),
ArchUnit (JVM), `go-arch-lint` or `depguard` (Go), Rust visibility
(`pub(crate)`) and workspace crates.

## 6. Dependency inversion done simply

The goal is that the core defines what it needs and the edge supplies it.
The simplest form is a function parameter:

```python
# before: domain imports infrastructure
from infra.smtp import send_email
def register(user):
    ...
    send_email(user.email, "Welcome")

# after: the domain declares the need; main wires it
from typing import Protocol
class Notifier(Protocol):
    def welcome(self, user: User) -> None: ...

def register(user: User, notifier: Notifier) -> None:
    ...
    notifier.welcome(user)

# main.py / composition root
register(user, SmtpNotifier(settings.smtp))
```

Rules that keep this from becoming ceremony:

- Define the interface where it is consumed, not where it is
  implemented. Go makes this idiomatic (small consumer-side interfaces);
  TypeScript, Python Protocols, Rust traits, Kotlin interfaces all
  support it.
- Keep interfaces small: one to three methods, named for the capability
  (`Notifier`, `Clock`, `OrderStore`), not for the implementation
  (`SmtpService`).
- Wire once, at the composition root (`main`, `app.ts`, DI container).
  Nothing in the core knows about the container.
- Do not introduce the interface until there is a second implementation,
  and the test fake counts as one. If the only reason is "for mocking",
  check whether an in-memory fake would be better than a mock anyway.

## 7. Strangler fig for big replacements

When a module is too tangled to refactor in place and too important to
rewrite in one go, grow the replacement alongside and route traffic over
gradually.

1. **Put a seam in front.** All callers go through one entry point
   (a facade, a router, a function). If they do not, that is step zero:
   funnel them (Change function declaration, one caller at a time).
2. **Build the new implementation behind the seam** for one slice of
   behavior (one endpoint, one message type, one command).
3. **Route that slice to the new code** behind a feature flag or a
   percentage. Keep the old path reachable.
4. **Compare.** Shadow mode: run both, return the old result, log diffs.
   Or: canary a percentage and watch errors and latency.
5. **Flip the slice** when diffs are zero (or explained) for long enough.
6. **Repeat** for the next slice. Delete old code as each slice flips;
   do not wait for the end, or the end never comes.
7. **Remove the seam's branching** when nothing routes to the old path.

```ts
// seam with shadow comparison
async function computeQuote(req: QuoteReq): Promise<Quote> {
  const legacy = await legacyQuote(req);
  if (flags.isEnabled("quote.v2.shadow", req.tenantId)) {
    newQuote(req).then((v2) => {
      if (!deepEqual(normalize(legacy), normalize(v2))) metrics.inc("quote.v2.diff", { tenant: req.tenantId });
    }).catch((e) => log.warn("quote.v2 shadow failed", e));
  }
  return flags.isEnabled("quote.v2.serve", req.tenantId) ? newQuote(req) : legacy;
}
```

Shadow mode must never affect the served response: swallow the new
path's errors, cap its time, and never let it write.

## 8. Splitting a module

When a file or package has grown into several concerns:

1. **Map it.** List every exported symbol and its callers (grep or IDE
   "find usages"). List every internal function and which exports use
   it. Draw clusters.
2. **Name the clusters.** Each cluster is a candidate module. If you
   cannot name one in two words, it is not a cluster yet.
3. **Move the leaf cluster first.** The one nothing else in the file
   depends on. Create the new module, move the symbols, re-export from
   the old location so callers do not change yet:

   ```ts
   // old/utils.ts
   export { formatMoney, parseMoney } from "../money/format";  // temporary re-export
   ```

4. **Migrate callers** to the new path in batches (a codemod if there are
   many; section 11). Tests between batches.
5. **Remove the re-exports** once no caller uses the old path. Lint for
   it (`no-restricted-imports`) so it does not come back.
6. **Repeat** for the next cluster. The last thing left in the old file
   should be its real responsibility, or nothing.

Each step is a commit; each commit is green.

## 9. Splitting a giant change into reviewable PRs

When you (or the author) have a 2000-line branch:

**By commit, if the commits are clean:** `git log --oneline main..HEAD`,
group them into slices, create a branch per slice with `git cherry-pick`,
open PRs that stack (each targets the previous).

**By hunk, if they are not:**

```sh
git checkout -b slice-1-rename main
git checkout big-branch -- .          # bring the whole tree into the index
git reset                              # unstage everything
git add -p                             # stage only the hunks for this slice
git commit -m "refactor: rename Order -> PurchaseOrder"
git stash                              # park the rest
# test, push, open PR
git checkout -b slice-2-extract slice-1-rename
git stash pop
git add -p ...
```

**Natural slice order:** mechanical first (renames, moves, formatting),
then preparatory refactors (extract the seam), then the behavior change,
then cleanup (remove the old path). Each slice should pass tests alone.
Reviewers approve mechanical slices in minutes and spend their attention
on the behavior slice.

**Stacked PRs** on GitHub: `gh pr create --base slice-1-rename` for slice
2, and so on; tools like `git-spice`, `graphite`, `ghstack` or `spr`
automate rebasing the stack when a lower PR changes.
`git-and-pr-hygiene.md` has more.

## 10. Refactor vs rewrite: the decision matrix

Rewrites fail because the old code encodes years of fixed bugs that nobody
remembers, and the new code re-discovers them one incident at a time.
Refactors fail when the structure is so wrong that each step fights the
last. The decision is a judgment, but the inputs are concrete:

| Factor | Favors refactor | Favors rewrite (strangler style) |
|---|---|---|
| Test coverage of the area | Any, or you can add characterization tests cheaply | Behavior cannot be pinned (no stable seam, I/O everywhere) and the behavior is documented elsewhere |
| How well the current behavior is understood | Poorly: the code is the only spec | Well: there is a spec, a reference implementation, or a conformance suite |
| Size | Anything; refactoring scales | Small enough to rewrite in a sprint with a flag |
| Language or platform change | Not needed | Required (EOL runtime, framework removed) |
| Structural problem | Local (long functions, bad names, one tangled class) | Global (wrong data model, wrong concurrency model, wrong framework for the domain) |
| Business pressure | Must keep shipping features in the area | Area is frozen or deprecated |
| Risk tolerance | Low | Higher, with a rollback path |

Default to refactoring. Choose rewrite only when at least three right-hand
cells apply, and even then rewrite behind a strangler seam (section 7),
never as a branch that lands all at once. A rewrite without a seam and a
flag is a bet that you understand the old code better than the people who
fixed its bugs.

## 11. Migrating a pattern incrementally: codemods and ratchets

For changes with hundreds of sites (new logging API, new import path,
callback to async, deprecated function), hand-editing is slow and
inconsistent. Two tools:

**Codemods** transform code mechanically with an AST:

- JS/TS: `jscodeshift`, `ts-morph`, `ast-grep`, Biome/ESLint autofix
  rules, `putout`.
- Python: `libcst` (preserves formatting), `bowler`, `ruff --fix` for
  rules with fixes, `pyupgrade`.
- Go: `gofmt -r 'old(a) -> new(a)'`, `gopls rename`, `eg`, `go fix`.
- Java/Kotlin: OpenRewrite recipes, IntelliJ structural search and
  replace.
- Ruby: `rubocop -a` with custom cops, `synvert`.
- Rust: `cargo fix`, `cargo clippy --fix`, `ast-grep`.
- Any language: `ast-grep` (`sg run -p 'oldFn($A)' -r 'newFn($A)'`),
  `comby`, `semgrep --autofix`.

Run the codemod, review the diff by sampling (it is mechanical, so review
the rule and spot-check 10 sites, not all 400), run the suite, commit
with the codemod command in the message so it can be re-run on
stragglers.

**Ratchets** stop the old pattern from coming back and let you migrate
over weeks: add a lint rule that forbids the old pattern, with the
existing sites allow-listed (baseline), and fail CI only on new
violations.

```jsonc
// eslint: forbid the old import path
"no-restricted-imports": ["error", { "paths": [{ "name": "utils/money", "message": "Use @app/money" }] }]
```

```toml
# ruff: enable the rule; generate a baseline of existing violations to fix over time
[tool.ruff.lint]
extend-select = ["UP"]   # pyupgrade rules
# then: ruff check --add-noqa to baseline, remove noqa file by file
```

```sh
# Generic ratchet: count violations, fail if the count grows
count=$(grep -rn 'legacyLogger\.' src | wc -l)
baseline=$(cat .ratchet/legacyLogger)
[ "$count" -le "$baseline" ] || { echo "legacyLogger uses grew from $baseline to $count"; exit 1; }
```

ESLint's `--report-unused-disable-directives`, Ruff's `noqa` baselines,
`golangci-lint`'s `new-from-rev`, RuboCop's `--auto-gen-config` (TODO
file), Detekt's baseline XML and PHPStan's baseline file all implement
this directly.

## 12. Measuring that behavior is preserved

Claims need evidence. In rough order of strength:

1. **Unchanged tests, green before and after.** The baseline. Note
   anything that was red before.
2. **Characterization suite** written before the refactor, untouched
   after.
3. **Golden output diff.** Run the program over a fixed input corpus
   before and after; `diff -r out-before out-after` is empty.
   Normalize timestamps and ids first.
4. **Recorded traffic replay.** Replay production or staging requests
   against both versions; compare status, body, side effects. Tools:
   `goreplay`, `diffy`, `vcr` cassettes, or a 30-line script.
5. **Shadow in production** (section 7) with diff metrics at zero.
6. **Property tests** that assert `new(x) == old(x)` for generated `x`
   while both implementations exist (`fast-check`, `hypothesis`,
   `proptest`, `jqwik`, `rapid` for Go).
7. **Mutation testing** to confirm the tests would notice a change
   (`stryker`, `mutmut`, `pitest`, `cargo-mutants`, `go-mutesting`): if
   mutants survive in the refactored region, the safety net has holes.

Also check the non-functional: a benchmark before and after if the code is
in a hot path (`hyperfine`, `pytest-benchmark`, `go test -bench`,
`criterion`, JMH), and memory if allocations changed.

Record what you ran in the PR description: "Verified: suite green (1032
passed, 2 pre-existing skips), golden diff over 400 fixtures empty,
`go test -bench` within 2%."

## 13. Failure modes

- **Big-bang rewrite on a branch.** Lands late, lands broken, cannot be
  reviewed. Strangler seam instead.
- **Rename without tests or tooling.** Find-and-replace misses the
  string reference in the template and the column in the migration.
  Use the IDE, then grep for the old name in non-code files.
- **"While I was in there."** Fixing the bug you found in the middle of
  an extraction. Now the commit is both and neither can be verified.
  Parking lot; separate commit.
- **Tightening behavior silently.** Changing `== null` to `=== null`,
  adding a bounds check, changing an exception type, reordering two
  calls with side effects. Each is a behavior change. Ask yourself for
  every edit: could any input observe this?
- **Abstracting on the first duplicate.** Two similar blocks become a
  parameterized helper with three flags. Wait for the third, then
  abstract what is really common.
- **Deleting the weird branch.** The odd special case is usually an
  incident fix. `git log -L :funcName:file` or `git blame` before
  removing; if there is a ticket, read it.
- **Refactoring without a target.** "Clean up this module" with no
  sentence about what is true afterwards produces churn. Agree the
  target first.
- **Leaving the re-exports forever.** Temporary compatibility shims that
  stay for years are how codebases get two ways to import everything.
  Put the removal in the same PR series or ticket it with a date.
