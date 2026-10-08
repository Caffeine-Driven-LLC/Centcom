# Review methodology

How to read a change so that you find what matters: the pass order and the
reasoning behind it, how much time each risk level deserves, how to read a
diff that is too big to hold in your head, how to trace the dangerous paths
beyond the diff, when to pull the branch, what to ask the author, and how
to handle PRs that should not be reviewed as one unit.

## Contents

1. Why pass order matters
2. The pass order in detail
3. Time-boxing by risk
4. Reading a large diff
5. Tracing risky paths beyond the diff
6. The dangerous-line hunt
7. When to pull the branch and run it
8. Questions to ask the author
9. PRs that should be split
10. Generated, vendored and formatted code
11. Reviewing a whole file or module
12. Reviewing a pasted diff with no repo

## 1. Why pass order matters

Attention is finite and front-loaded. Whatever you read first shapes what
you look for afterwards. If you start with the implementation, you adopt
the author's mental model and check their work against their own
assumptions, which is the one thing a reviewer must not do. If you start
with style, you spend your freshest attention on the least valuable
findings and arrive at the dangerous code already tired and already
inclined to approve.

So the order is: intent, then tests, then risky paths, then general
correctness, then design, then style. Each pass has a different question,
and keeping the questions separate is what lets you answer any of them
well.

## 2. The pass order in detail

### Pass 0: Intent and shape (no code yet)

Read the title, description, linked issue, and commit list. Write one
sentence: "This change makes X do Y so that Z." Then write the shape of
the change you would expect: which modules should be touched, roughly how
much test code, whether a migration or a config change should appear.

Compare against `git diff --stat`. Mismatches are your first findings:

- Files touched you did not expect: scope creep, or a dependency you did
  not know about. Ask.
- Files you expected and are missing: the migration, the docs, the test
  file, the client update that goes with the server change.
- Test ratio near zero on behavior code: a question before anything else.

### Pass 1: Tests as specification

Read every test file in the diff before reading any implementation. For
each test, write down in a few words what behavior it pins. Then write the
behaviors you would expect to be pinned given the intent sentence. The
difference is your list of untested cases, and the untested case is where
the bug usually is.

While reading tests, also check they are real: would they fail if the
feature were broken? A test that asserts the mock was called with the
arguments the implementation passes to it has pinned the implementation,
not the behavior. `reviewing-tests.md` has the catalogue.

### Pass 2: Risky paths

From the change-type table in SKILL.md, identify what in this diff is
high-consequence: auth, money, data deletion, migration, concurrency,
caching, public contract, serialization, external calls. For each one,
trace the full path, not just the diff hunk (section 5). Pull in the
domain reference. Write your findings as you go with a tentative severity;
you will verify in Pass 6.

### Pass 3: Correctness

Now read the implementation linearly. For every function, ask:

- What does it assume about its inputs, and who guarantees that?
- What happens on empty, null, zero, negative, maximum, non-ASCII,
  duplicate, out of order, already-processed?
- What happens when each call inside it fails? Is state left half-written?
- Are return values checked? Are errors propagated or swallowed?
- Are resources (files, connections, locks, timers, subscriptions)
  released on every path including the exception path?
- Are boundaries inclusive or exclusive, and is that consistent with the
  callers? Off-by-one lives here.
- Time: timezone, DST, leap years, clock skew, monotonic vs wall clock.
- Numbers: integer overflow, float comparison, currency as float,
  division by zero, rounding direction.
- Strings: encoding, normalization, length in bytes vs characters,
  locale-dependent casing.

### Pass 4: Design and maintainability

Step back from lines to structure.

- Does the new code live in the right place? Does it depend inward
  (toward the domain) or outward (toward infrastructure)? A domain module
  importing an HTTP client is a direction problem.
- Does it duplicate something that already exists? Grep for the function
  name's synonyms and for the distinctive constant or string.
- Is the abstraction earned? One implementation behind an interface, a
  factory for a single product, a base class for two children sharing a
  line: see `code-smells.md` "Speculative generality".
- Would the next person find this? Names reveal intent; file placement
  matches the neighbors; the public surface is as small as it can be.
- Is there a smell with a cheap fix? Long parameter list, boolean flag
  parameter, deep nesting. Note it; decide severity by how often this code
  will be touched.

### Pass 5: Style and consistency

Short, and only for what the linter does not enforce:

- Deviations from the surrounding code's idiom (error handling style,
  naming scheme, module layout).
- Comments that explain what instead of why; stale comments.
- Inconsistent vocabulary (the same concept called two names).

Batch these into one comment. Never block on them.

### Pass 6: Verify your claims

For every finding you intend to label blocking or should-fix: can you point
to the exact input and the exact line where it goes wrong? Have you read
the callers to be sure the input can arrive? If a type system or a
validator upstream prevents it, you have a nit about defensive clarity, not
a bug. If you cannot confirm, convert to `question:` and say what you
could not determine.

### Pass 7: Write up

`severity-and-feedback.md` covers the comment and summary format. The
summary includes what you checked and did not.

## 3. Time-boxing by risk

Review quality degrades sharply after about an hour of continuous reading
and after about 400 lines in one sitting. Plan for that.

| Risk | Target | What fits in the budget |
|---|---|---|
| Low (docs, tests-only, formatting, lockfile bump with green CI) | 5 to 15 minutes | Pass 0, skim for accidents, check CI, one re-read for the dangerous-line categories |
| Medium (feature with tests, UI, bounded refactor) | 30 to 60 minutes | All passes; run tests locally if anything smells; trace the main path and one failure path |
| High (auth, money, data, migration, concurrency, public API, infra) | As long as it takes, in sessions of at most an hour | All passes; pull the branch; run it; trace every risky path to its end; write the failing test for anything you suspect |

If a medium or high change does not fit the budget because of size, the
finding is "this needs to be split" (section 9), and you review the
riskiest slice properly rather than all of it badly.

## 4. Reading a large diff

A 1500-line diff read top to bottom in GitHub's file order is read in
alphabetical order of path, which has nothing to do with how the change
works. Reorganize before reading.

### Group by concern

```sh
git diff --stat base...head | sort -k1
# or
gh pr diff 123 --name-only | sort
```

Cluster the file list into concerns: "schema and migration", "domain
model", "API layer", "UI", "tests", "config", "generated". Read one
concern at a time, inside-out: domain first, then the layers that call it,
then the edges. Tests for a concern go with that concern, read first.

### Follow the data

Pick the central piece of data the change introduces or alters (a new
field, a new event, a new parameter). Follow it from where it enters
(request, message, file, user input) through validation, transformation,
storage and back out to any consumer. `grep -rn fieldName` across the
head commit, not just the diff, tells you every place it is touched and
whether the diff covers them all. A field added to the model but not to
the serializer, or to the serializer but not to the validator, shows up
here.

### Read the smallest files first

Interfaces, types, schema files, constants, config. They are short and
they frame everything else. A changed enum or a changed default is a
contract change and should color your reading of every consumer.

### Diff tooling that helps

```sh
# Ignore whitespace-only changes
git diff -w base...head
# Show moved code as moves instead of delete+add
git diff --color-moved=dimmed-zebra base...head
# Word-level diff for prose, config, and long lines
git diff --word-diff base...head -- '*.md' '*.yaml'
# One file at a time with full context
git diff -U20 base...head -- path/to/file.py
# Function-level context (shows the enclosing function name)
git diff --function-context base...head -- path/to/file.go
# Commits in order, to read the change as the author built it
git log --reverse -p base..head
```

Reading commit by commit (`git log --reverse -p`) works well when the
author made atomic commits; it fails when they did not, and that itself
is a hygiene comment.

### Keep a running ledger

Open a scratch note. For each file: one line of what it does in the
change, and any question raised. Findings go in with a tentative
severity. At the end, the ledger is your review; nothing is held in
memory across 40 files.

## 5. Tracing risky paths beyond the diff

The diff shows where the code changed. The consequences are wherever the
changed code is called from and whatever it calls. For each risky hunk:

1. **Callers.** Who calls this function? (`grep -rn functionName`, or the
   IDE's references.) Did any caller rely on the old behavior: the old
   return type, the old exception, the old ordering, the old default?
2. **Callees.** What does the new code call, and what can those calls
   return or throw that the new code does not handle?
3. **Guards.** Where is the authn or authz check for this path? Is it
   before the new code runs? Does the new code add a way to reach the
   sensitive operation that bypasses the existing guard (a new endpoint,
   a new message handler, a new CLI flag)?
4. **Data at rest.** If the change alters what gets stored, what reads it
   back? Is there old data in the stored format that the new reader will
   choke on? Is there a migration, and does it run before or after the
   code deploys?
5. **Concurrency.** Can two instances of this path run at once (two
   requests, two workers, a retry overlapping the original)? What is
   shared between them?
6. **Failure midway.** If the process dies between step 3 and step 4,
   what is left behind, and does the retry handle it?

Write the trace as a short list in your ledger: "Request ->
`handler.create()` -> `service.create()` -> `repo.insert()`; authz in
`handler` line 22 only; `service.create()` is also called from the import
job at `jobs/import.py:88` which has no authz, so the new field is
writable by import without the check." That sentence is a finding.

## 6. The dangerous-line hunt

Big diffs hide small catastrophes. After the linear read, do one more pass
looking for nothing but these, using search rather than reading:

```sh
# Destructive data operations
git diff base...head | grep -nEi 'drop (table|column)|truncate|delete from|\.delete\(|remove_column|rm -rf|--force|force: true|cascade'
# Removed guards: lines starting with - that contain checks
git diff base...head | grep -nE '^-.*(auth|permission|can\?|authorize|verify|validate|assert|check|require|if .* return|throw|raise)'
# Permission or scope widening
git diff base...head | grep -nEi 'admin|superuser|is_staff|role|scope|allow_all|\*|public|0\.0\.0\.0|chmod|777'
# Changed defaults and feature flags
git diff base...head | grep -nEi 'default|fallback|flag|enabled|disabled|env\.|process\.env|os\.environ|getenv'
# Disabled safety
git diff base...head | grep -nEi 'skip|xit\(|it\.skip|@pytest.mark.skip|@Ignore|#\[ignore\]|nolint|eslint-disable|noqa|ts-ignore|ts-expect-error|unsafe|dangerouslySetInnerHTML|verify=False|rejectUnauthorized|InsecureSkipVerify'
# New network or process calls
git diff base...head | grep -nEi 'fetch\(|axios|http\.|requests\.|urllib|exec\(|spawn|subprocess|system\(|popen|Runtime\.getRuntime'
# Secrets-looking strings
git diff base...head | grep -nE '(api[_-]?key|secret|password|token|private[_-]?key)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9+/=_\-]{12,}'
```

Every hit is either explained by the intent or a comment. Also check the
diff for files the author probably did not mean to include: `.env`,
editor settings, `node_modules`, build output, large binaries
(`git diff --stat` shows sizes).

## 7. When to pull the branch and run it

Pull and run when any of these is true:

- Risk level is high.
- The change is in a language or framework where types do not catch the
  category of bug you suspect (dynamic languages, SQL, shell, YAML).
- The tests are the only evidence of correctness and you are not sure they
  exercise the real path (heavy mocking, snapshot tests).
- There is a UI change; screenshots in the PR are the author's view, not
  yours.
- CI is red, flaky, or not running the relevant suite.
- You are about to write a blocking comment you cannot prove by reading.

What to do once pulled:

```sh
gh pr checkout 123
# Run the tests the diff touched, then the full suite
<test command> path/to/changed_test
<full test command>
# Run the thing: start the server, hit the new endpoint with the edge
# cases you listed in Pass 3; run the CLI with the new flag; open the page
# Mutation-style spot check: break the implementation on purpose and
# confirm the new tests go red
```

A test suite that stays green after you comment out the new behavior has
told you the tests are not real. That is a should-fix at least.

## 8. Questions to ask the author

Ask when the answer changes your verdict and you cannot find it in the
code. Good questions are specific and show what you looked at:

- "The description says soft-delete; I see the `deleted_at` column, but
  `UserSession` has `on_delete=CASCADE`. Is removing sessions on soft
  delete intended?"
- "Is `process_batch` ever called concurrently? I could not tell from the
  job config. If so, the `seen` set on line 40 is shared."
- "What should happen when `rate` is zero? The current code divides by it
  on line 73 and no test covers it."
- "This changes the default page size from 50 to 20. Do we have clients
  that assume 50?"
- "I expected a migration for the new `status` column but did not find
  one. Is it created elsewhere?"
- "The retry wraps the whole function including validation. Is retrying a
  validation failure intended?"

Questions to avoid: "Why did you do it this way?" with no alternative
offered; anything the description already answers; anything you could
have found with grep in under a minute.

## 9. PRs that should be split

Signals that a PR is too big to review as one:

- More than about 400 lines of hand-written, non-test change, or more
  than roughly 15 files of behavior code.
- Two or more unrelated intents ("add feature X and also upgrade the
  linter and also rename the module").
- A refactor and a behavior change in the same diff.
- A migration plus the code that depends on it plus the backfill, when
  these need to deploy in separate steps anyway.
- You cannot write the one-sentence intent without "and".

How to raise it: before any line comments, one top-level comment that
names the slices you see and offers an order:

> This mixes three things that I would like to review separately, because
> the middle one is risky and the others are hiding it: (1) the rename of
> `Order` to `PurchaseOrder` (mechanical, ~900 lines, I can approve fast
> if it is alone), (2) the new refund flow (~250 lines, needs a careful
> read), (3) the Prettier config bump (touches 40 files). Could you split
> into 1 -> 2 -> 3, or 3 first? If splitting is not practical, tell me and
> I will review (2) in depth here and skim the rest, noting that in the
> summary.

Then, if the author cannot split, do exactly that: review the risky slice
properly, state in the summary what you only skimmed.

How to split mechanically when you are the author or are asked to help:
`refactoring.md` section "Splitting a giant change" covers
`git add -p`, `git rebase -i` to reorder commits, and stacked branches.

## 10. Generated, vendored and formatted code

**Generated code** (protobuf stubs, GraphQL types, OpenAPI clients, ORM
schemas, snapshot files): do not read it line by line. Review the input
that generated it (the `.proto`, the schema, the spec) and verify the
generated output matches by regenerating locally and diffing. Flag
hand-edits to generated files; they will be lost. Check the generator
version is pinned.

**Vendored dependencies** (a copied library under `vendor/`,
`third_party/`): review the decision to vendor and the version, not the
code. Confirm the license file came with it and that any local patches
are documented in a `PATCHES.md` or equivalent. `security/references/
dependencies-supply-chain.md` for the supply chain angle.

**Formatter runs** (a commit that applies Prettier, Black, gofmt to the
tree): confirm it is only formatting with `git diff -w --stat` (whitespace
ignored) showing near-zero change, and that it is in its own commit or
PR. Mixing a formatter run with behavior changes makes the behavior
changes unreviewable; ask for the split.

**Lockfile changes**: confirm the lockfile change matches the manifest
change (no unexplained additions), and that CI installed from the
lockfile. A lockfile diff with hundreds of transitive changes for a
one-line manifest change deserves a look at what came in.

## 11. Reviewing a whole file or module

"Review this file" has no diff. Treat the current content as the change
and the history as context:

```sh
git log --oneline --follow -- path/to/file | head -20
git log -p --follow -S 'suspiciousFunction' -- path/to/file
git blame -w -C -C -C path/to/file   # ignore whitespace, follow moves
```

Then run the same passes: what is this file for (intent), what tests
cover it (tests first; find them with grep for the module name in test
dirs), where are its risky responsibilities, correctness, design, style.
The output is a report rather than inline comments: a short summary of
what the module does, findings by severity, and a prioritized list of
what to change first and why.

For a module review, add a dependency sketch: which modules import this
one, which it imports, and whether the direction makes sense
(`refactoring.md` "Dependency direction").

## 12. Reviewing a pasted diff with no repo

You can see the hunks and nothing else. Say so in the first line of your
review. Then:

- Review what is visible for correctness within the hunk: null handling,
  off-by-one, error paths, obvious smells.
- For anything that depends on context you cannot see (callers, types,
  tests, whether a guard exists upstream), phrase it as a question or a
  conditional: "If `items` can be empty here, line 12 throws; I cannot
  see the caller."
- Ask for the two or three things that would most change your verdict:
  the test file, the caller, the type definition.
- Do not approve. You can say "nothing blocking in what I can see" and
  list what you could not see.
