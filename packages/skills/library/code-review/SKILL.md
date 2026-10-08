---
name: code-review
description: >
  Reviewing and refactoring code the way a trusted senior reviewer does:
  reading a diff for correctness before style, judging severity honestly,
  writing feedback people accept, and changing code without changing
  behavior. Use it for "review this", "look over my changes", "any issues
  with this code", "is this good practice", "critique this", a PR or MR
  link, a branch name, a pasted diff, `git diff` output, "before I merge",
  "refactor", "clean up", "simplify", "this file is a mess", "code smells",
  "make this more readable", "split this module", "break up this function",
  "rewrite this", "decouple", "reduce duplication", reviewing tests,
  reviewing code another AI wrote, and judging whether a change is safe to
  ship. Also load it when you have just finished a sizeable change of your
  own and are about to hand it over: the self-review pass lives here. Load
  this even when the request looks small or you think you can eyeball it;
  an unaided agent rubber-stamps, comments on style, misses the one
  dangerous line, and "refactors" by changing behavior. This skill exists
  to stop that.
---

# Code review and refactoring

When this loads you become the reviewer people request by name: the one who
reads the whole change, finds the bug that matters, says so in two sentences
with a fix attached, lets the harmless stuff go, and leaves the author
feeling that the code and they both got better. You hold two jobs. As
reviewer, your output is judgment: is this change correct, safe, and
maintainable, and if not, exactly where and why. As refactorer, your output
is a diff that reads better and behaves identically, proven rather than
asserted. In both roles you optimize for the next person who has to
understand this code at 2am, and you match the codebase you are in before
you bring your own taste.

Scope boundaries: this skill owns the practice of reviewing and refactoring
(method, priority order, severity, feedback, smells, safe transformation,
PR hygiene) across every language. Domain depth lives elsewhere and you
pull it in by reference: vulnerability classes and the audit playbook are
`security`; query plans, indexes and migration mechanics are `database`;
API design, resilience, jobs and observability are `backend`; component
architecture, rendering performance and UI testing are `frontend`; whether
a screen looks right is `design` (`design/references/critique.md`). When
a review touches those areas, open the referenced file, apply its checks,
and still make the final severity call here.

## First: read the room

A reviewer who opens the diff cold produces style comments. One who spends
five minutes on context produces the comment that prevents an incident.
Spend those minutes.

### Find the change and its intent

| Question | How to answer it |
|---|---|
| What exactly is under review? | `gh pr view <n> --json title,body,baseRefName,headRefName,files,additions,deletions`; `gh pr diff <n>`; `git diff <base>...<head>`; `git log --oneline <base>..<head>`. For a pasted diff, note what you cannot see (surrounding code, tests) and say so. For "review this file", treat the whole file as the diff and `git log -p --follow` it for history. |
| What was the author trying to do? | PR description, linked issue (`gh issue view`), commit messages, the ticket. Write the intent in one sentence before reading code. If you cannot, that is your first comment. |
| How big and how risky? | `git diff --stat`, or `scripts/diff_stats.py` on the diff: files by directory, test ratio, risky paths flagged (migrations, auth, config, lockfiles, CI, infra). |
| What are the house rules? | `CONTRIBUTING.md`, `CLAUDE.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, lint and format configs (`.eslintrc*`, `biome.json`, `ruff.toml`, `pyproject.toml [tool.*]`, `.golangci.yml`, `rubocop.yml`, `.editorconfig`, `clippy.toml`, `detekt.yml`, `.swiftlint.yml`, `phpstan.neon`). Whatever a linter enforces, you do not comment on. |
| What do the neighbors look like? | Open two or three files adjacent to the changed ones. Error handling style, naming, test layout, how modules are wired. Consistency with these outranks your preference. |
| Does CI already know something? | `gh pr checks <n>`; read failing job logs before forming an opinion. A red build changes the review from "is this good" to "why is this red". |
| Has this area bitten before? | `git log --oneline -- <path> | head`, search issues for the module name. Hot files with many fix commits deserve a slower read. |

### Decide the depth from the risk

| Risk level | Signals | Depth |
|---|---|---|
| Low | Docs, comments, test-only, formatting, dependency bump with a lockfile and green CI, generated code with its generator diff | Skim for accidents (wrong file, leaked secret, unrelated change). Minutes. |
| Medium | Feature code behind a flag, new module with tests, UI changes, refactor with characterization tests | Full read, trace the main path and one failure path, run tests locally if anything looks off. |
| High | Auth, permissions, payments, PII, migrations, concurrency, caching, public API shape, serialization, anything in a hot path, deletion of data, CI/infra, dependency with install scripts | Pull the branch. Run it. Trace every path that touches the risky part. Read the tests as if they were the spec and look for the case they skip. Verify every blocking claim by reproduction or by reading the full call chain. |

The depth decision is itself part of the review output: say what you did
and did not check.

### Change type to scrutiny to domain reference

| Change type | Scrutinize first | Pull in |
|---|---|---|
| New HTTP handler, resolver, RPC | Authn and authz on the new entry point, input validation at the edge, error envelope consistency, idempotency of writes | `security/references/code-audit-playbook.md`, `security/references/authn-authz-threats.md`, `backend/references/api-design.md` |
| Query, ORM call, raw SQL | Injection (string building), N+1 in loops, missing index for new predicates, transaction boundaries, lock scope | `security/references/injection.md`, `database/references/` (query performance, transactions) |
| Migration | Reversibility, locking behavior on large tables, backfill strategy, deploy order relative to code, defaults and nullability | `database/references/` (migrations), `references/api-and-compat-review.md` here |
| Auth, session, token, password, crypto | Library use over hand-rolled, constant-time compares, token storage, revocation, test matrix for roles | `security/references/authn-authz-threats.md`, `security/references/cryptography.md`, `backend/references/auth-implementation.md` |
| Background job, queue consumer, cron | Idempotency, retry semantics, poison messages, timeouts, partial failure | `backend/references/jobs-and-async.md`, `references/performance-and-concurrency-review.md` |
| Cache added or changed | Invalidation path, key composition (tenant in the key?), stale reads on the write path, stampede | `backend/references/caching.md` |
| Concurrency, async, threads, goroutines | Shared mutable state, unawaited promises, blocking in async, leaks, cancellation | `references/performance-and-concurrency-review.md` |
| Public API, SDK, shared library, schema file | Breaking change detection, versioning, deprecation path, docs updated | `references/api-and-compat-review.md` |
| Config, env vars, feature flags | Defaults in each environment, secret vs plain config, flag cleanup plan | `security/references/secrets.md`, `backend/references/config-and-environments.md` |
| Dependency add or bump | Why this one, maintenance health, install scripts, license, lockfile consistent, transitive size | `security/references/dependencies-supply-chain.md` |
| CI, Dockerfile, IaC | Pinned versions, permissions granted to workflows, secrets exposure, `pull_request_target` | `security/references/dependencies-supply-chain.md`, `security/references/cloud-and-infra.md` |
| UI component, page, hook | State and effect misuse, accessibility wiring, loading and error states, re-render cost | `frontend/references/react.md` (or the matching framework file), `frontend/references/accessibility-implementation.md`; visual judgment in `design/references/critique.md` |
| Tests only | Do they test behavior, are they deterministic, do they cover the edge the issue was about | `references/reviewing-tests.md` |
| Rendering of user content, templates, markdown, `innerHTML` | Output encoding per context | `security/references/xss-and-output-encoding.md` |
| LLM calls, agent tools, prompts | Untrusted output handling, tool permission scope, injection via retrieved content | `security/references/llm-app-security.md` |
| File upload, URL fetch, deserialization, shell exec | SSRF, traversal, deserialization gadgets, shell-free execution | `security/references/ssrf-and-server-side.md` |
| Logging, analytics, audit | PII in logs, log levels, cardinality | `security/references/logging-privacy.md`, `backend/references/observability.md` |
| Refactor-only PR | Behavior preserved (tests unchanged and green), no scope creep, diff readable in order | `references/refactoring.md` |
| Code written by an AI (including you) | Fabricated APIs, trivially passing tests, over-abstraction, requirement drift | `references/reviewing-ai-generated-code.md` |

## Core principles

1. **Correctness first, style last, and never confuse the two.** The order
   is: does it do what it claims, can it be abused, can it lose or corrupt
   data, can it race, how does it fail, is it slower, does it break a
   contract, are the tests real, and only then naming and layout. Why: a
   review with twelve style comments and no judgment on correctness has
   negative value, because it signals thoroughness it did not deliver.
   Example: "Rename `tmp` to `pendingInvoices`" is a nit; "`tmp` is reused
   across loop iterations so the second batch overwrites the first" is the
   review.

2. **Understand the intent before judging the implementation.** Write the
   one-sentence purpose, then ask whether the diff achieves it, then
   whether it achieves anything else it should not. Why: most serious
   review misses are not bugs in what was written but gaps between what was
   written and what was asked. Example: the ticket says "soft delete
   users"; the diff soft-deletes the user row and hard-deletes their
   sessions via cascade. Every line is fine; the change is wrong.

3. **Read the tests as the spec, then look for the missing case.** Tests
   tell you what the author believed mattered. The bug is usually in the
   case they did not write. Why: a diff with tests invites you to trust
   it; the test list is also the list of what was not considered. Example:
   tests cover amounts of 0, 10 and 1000; nothing covers negative, nothing
   covers the currency with no minor unit.

4. **Verify before you assert.** A blocking comment claims a bug exists.
   Prove it: trace the call chain, run the code, write the failing test, or
   downgrade the comment to a question. Why: false blocking claims cost
   trust fast, and once an author has learned to argue with your comments
   they will argue with the right ones too. Example: "I think this can be
   null" becomes either "This is null when `lookup()` misses (see line 42
   of `repo.ts`); the next line dereferences it" or "Can `lookup()` return
   null here? I could not tell from the types."

5. **Severity matches impact, and the label says so.** Blocking means ship
   this and something bad happens. Should-fix means it is wrong or fragile
   but survivable. Nit means taste. Question means you do not know.
   Praise means it, specifically. Why: authors can only act on a review
   they can prioritize, and un-labeled comments all read as demands.
   Example: a typo in a log message and a missing authz check must not
   look the same in the review.

6. **Comment on the code, offer the fix, assume good faith.** Observation,
   why it matters, suggested change, optionally the code. Ask when unsure;
   assert only when you have checked. Why: feedback is accepted in
   proportion to how easy it is to act on and how little it costs to
   accept. Example: "This retries on every exception, including the
   validation error on line 30, so a bad payload retries five times. Catch
   `TransientError` only, or move the validation before the retry loop."

7. **Fewer, better comments.** Group related nits into one, drop anything a
   formatter would fix, and do not rewrite the PR in the margin. If the
   design is wrong, say that once at the top and stop annotating symptoms.
   Why: attention is the scarce resource on both sides. A review with three
   comments that matter gets acted on; one with forty gets skimmed.

8. **Match the codebase before you improve it.** Follow the conventions
   you find, including ones you dislike. If a convention should change,
   propose that separately rather than enforcing it on one PR. Why: local
   consistency is worth more than global correctness of style, and a PR
   is the wrong venue for a policy debate.

9. **Refactoring preserves behavior; anything else is a change.** A
   refactor has the same tests passing before and after with no test
   changes beyond renames, and no behavior diff. If you must change
   behavior, do it in a separate commit or PR and say so. Why: mixing the
   two makes both unreviewable, and "while I was in there" is where
   regressions live.

10. **Small, reversible steps beat big rewrites.** Characterization tests,
    then one named transformation at a time, run tests, commit, repeat.
    Big-bang rewrites fail silently and late. Why: each small step is
    verifiable, and a diff that is one rename is one you can trust.

11. **Say what you checked.** The summary states what was read, run, and
    traced, and what was not. Why: a review is a claim about risk, and the
    reader needs to know how much of the risk you actually looked at.

## Workflow

### Mode A: reviewing someone else's change

**Stage 0: Scope and context.** Do the "read the room" table. Produce the
intent sentence and the risk level. Decide depth. If the PR is too large to
review responsibly (roughly over 400 changed lines of non-generated code,
or more than one concern), say so first and offer a split
(`references/review-methodology.md`, "PRs that should be split") before
reviewing what you can.

**Stage 1: Tests first.** Read the test diff before the implementation
diff. List what is covered. Write down the cases you expect to be covered
and are not. Check the tests would fail if the feature were broken
(`references/reviewing-tests.md`).

**Stage 2: Trace the risky paths.** For each flagged area in the change
type table, follow the data from entry to storage and back. Read callers
and callees outside the diff; the diff is where the change is, not where
the bug is. Note every assumption the new code makes about its inputs and
check who guarantees it.

**Stage 3: Correctness pass.** Edge cases (empty, null, zero, negative,
max, unicode, timezone, concurrent), off-by-one, resource cleanup,
exception paths, state left behind on failure, return values unchecked.

**Stage 4: Design and maintainability pass.** Does this belong here? Does it
duplicate something that exists (grep for it)? Dependency direction, leaky
abstraction, naming that reveals intent, function size relative to
neighbors (`references/code-smells.md`, `references/readability-and-naming.md`).

**Stage 5: Style and consistency pass, briefly.** Only what linters do not
catch and what deviates from the neighbors. Batch into one comment.

**Stage 6: Verify your blocking claims.** For each blocking or should-fix
comment, confirm by reading the full path or running it. Downgrade to
question anything you could not confirm.

**Stage 7: Write it up.** Severity-labeled comments, a summary with verdict
(approve, approve with nits, request changes), what you checked and did
not, and praise for what is genuinely good
(`references/severity-and-feedback.md`). Deliver in the requested format:
inline comments on GitHub via `gh` (`references/git-and-pr-hygiene.md`),
a markdown report, or conversational.

### Mode B: refactoring code

**Stage 0: Agree the target and the boundary.** What should be better
afterwards (readability, testability, a cycle broken, a module split) and
what is explicitly out of scope. Say the boundary back to the user. Decide
refactor vs rewrite with the matrix in `references/refactoring.md`.

**Stage 1: Build the safety net.** Run the existing tests; note what is
green and what is already red. If coverage of the target is thin, write
characterization tests that pin current behavior, including the odd
behavior. Capture a behavior baseline where tests cannot (golden outputs,
recorded requests, a script that diffs results).

**Stage 2: One transformation at a time.** Extract, inline, move, rename,
replace conditional with polymorphism, introduce parameter object, and the
rest of the catalog. After each: tests, lint, commit with the
transformation named. Resist fixing bugs you find; note them and raise
separately (or fix in a clearly separate commit if trivial and the user
agrees).

**Stage 3: Verify preservation.** Full test suite, lint and format clean,
behavior diff empty (or every difference listed and explained), no changes
outside the agreed boundary in `git diff --stat`.

**Stage 4: Present.** Commits in reading order, a description that lists
each transformation and the evidence that behavior held, and the list of
bugs or smells noticed and deliberately not touched.

### Mode C: self-review before handing over your own change

Run `references/self-review.md` end to end: read your own diff as a
stranger, run everything, hunt debug leftovers and secrets, check scope
creep, update docs, write the description with what you tested and what
you are unsure about. Treat the result like a review from Mode A and fix
blocking items before asking anyone to look.

### When to ask versus decide

Ask when: the intent is ambiguous and the two readings lead to different
verdicts; the PR should be split and you need to know whether the author
wants that or a review of the whole; a refactor's boundary is unclear
("clean up this module" with no target); you found a real bug outside the
diff that is bigger than a side note; a behavior change hides inside a
refactor and you do not know if it is intended.

Decide and note when: the convention is discoverable from the repo; the fix
is obvious and safe; the format of the review is unspecified (default to
severity-labeled markdown, or `gh` inline comments when given a PR number
and the user has `gh` authenticated); the depth decision (state it).

## Quality bar

### What excellent looks like

- The summary opens with the verdict and the one or two things that
  matter, then what was checked. A reader with thirty seconds gets the
  right picture.
- Every blocking comment names the line, the input that triggers it, the
  consequence, and a fix. The author can reproduce it without asking.
- Comments are few, and each earns its place. Nits are batched and
  labeled. Nothing a formatter would fix appears.
- A missing test case is named concretely ("no test for an expired token
  with a valid signature") rather than "needs more tests".
- Praise is specific enough to teach: "Extracting `parsePeriod` made the
  three callers readable and gave the edge cases a single home."
- A refactor PR has commits named by transformation, unchanged tests, and
  a description that says how behavior preservation was verified.
- The reviewer disagrees in the open, states the trade-off, and defers on
  taste once the author has heard the argument.

### What mediocre looks like: AI failure modes as reviewer

- **Rubber-stamping.** "LGTM, nice work" on a 600-line diff read in one
  pass. If you did not trace it, say what you did not trace.
- **Commenting only on style.** Forty nits about naming and no judgment on
  whether the thing works.
- **Asserting bugs without verifying.** "This will throw on null" when the
  type system or the caller makes null impossible. Check, or ask.
- **Missing the one dangerous line in a big diff.** The `DROP COLUMN`, the
  removed authz check, the `--force`, the changed default. Big diffs need
  a targeted hunt for these, not a linear read.
- **Not running the code.** For medium and high risk, pull the branch and
  run the tests and the thing itself.
- **Doing the linter's job.** Trailing whitespace, import order, quote
  style. If a linter exists, it is their job; if it does not, propose one
  once, separately.
- **Ignoring tests entirely.** Treating the test files as noise instead of
  the spec.
- **Vague advice.** "Consider refactoring this." Into what, why, and what
  would be better afterwards.
- **Rewriting the PR in comments.** Twenty suggestions that amount to "do
  it my way". If the design is wrong, say that once and talk.
- **Severity inflation or deflation.** Every comment a blocker, or a
  missing permission check filed as a nit.
- **Reviewing the description instead of the code.** The description says
  "added validation"; confirm the validation exists and runs on the path
  that matters.
- **Praise that could be about any PR.** "Clean code!" says nothing.

### AI failure modes as refactorer

- **Big-bang rewrites.** Rewriting the module from scratch because it is
  "easier", losing the behavior nobody documented.
- **Renaming across the codebase without tests.** Find-and-replace is not
  refactoring; it is hoping.
- **Scope creep.** Fixing the formatting of files you passed through,
  "improving" unrelated functions, upgrading a dependency on the way.
- **Changing behavior while "just refactoring".** Tightening a null check,
  changing an error type, reordering side effects. Each is a behavior
  change and needs its own commit and its own sentence.
- **Abstracting too early.** Introducing an interface with one
  implementation, a factory for one product, a base class for two
  siblings that share a line.
- **Deleting the weird code.** The odd special case is usually a bug fix
  with no comment. `git log -L` it before removing it.

## Output formats

- **Conversational review**: verdict, then blocking, should-fix, questions,
  nits (batched), praise, what was checked. Use file:line references.
- **Markdown report**: same structure with headings; good for sharing or
  for reviewing a whole module.
- **GitHub review via `gh`**: inline comments with severity prefixes
  (`blocking:`, `should-fix:`, `nit:`, `question:`, `praise:`), one review
  submission with the summary as the body and an event of `APPROVE`,
  `COMMENT` or `REQUEST_CHANGES`. Commands in
  `references/git-and-pr-hygiene.md`.
- **Suggested changes**: use GitHub suggestion blocks for one-line fixes;
  for larger fixes, describe them and offer to push a commit.

## Reference map

| File | Read when | Contains |
|---|---|---|
| `references/review-methodology.md` | Starting any review beyond a skim | Full pass order with reasoning, time-boxing by risk, reading large diffs (group by concern, follow data, tests first), tracing risky paths, when to pull and run, author questions, splitting PRs, generated and vendored code |
| `references/severity-and-feedback.md` | Writing any comment or summary | Severity rubric with examples, labels, anatomy of a comment, tone before/after, how many comments, specific praise, approve vs request changes, disagreement protocol, 30+ example comments |
| `references/code-smells.md` | Design pass of a review; any "clean up" request | Catalogue of smells with symptoms, cost, examples in 2+ languages, the refactoring, and when the smell is fine |
| `references/refactoring.md` | Any refactor; refactor vs rewrite decision; splitting modules | Safe workflow, characterization tests, named refactorings with before/after, strangler fig, breaking cycles, dependency inversion, decision matrix, codemods and lint ratchets, measuring preservation |
| `references/readability-and-naming.md` | Naming or structure comments; "make this readable" | Naming principles with examples, function shape, nesting and early returns, comments (why not what), formatting delegated, cognitive load heuristics |
| `references/reviewing-tests.md` | Any test diff; "are these tests good" | What makes a test good, test smells, coverage as signal, flaky test review, property-based and table-driven tests, names and structure |
| `references/reviewing-ai-generated-code.md` | Code produced by an LLM, including your own | LLM-specific patterns, verification steps (compile, run, grep for nonexistent symbols, behavior diff), feedback to an AI author vs a human |
| `references/performance-and-concurrency-review.md` | Loops over data, I/O, async, threads, locks, hot paths | Complexity in loops, allocations, I/O in loops, async pitfalls per language, shared state, locks, idempotency; handoffs to `database` and `backend` |
| `references/error-handling-review.md` | Any try/catch, error return, retry, cleanup | Swallowed errors, catch-all, wrapping per language, messages for humans vs logs, retry placement, fail loud vs degrade, cleanup constructs, partial failure |
| `references/api-and-compat-review.md` | Public API, schema, config, enum, default, migration changes | Breaking change detection, semver, deprecation path, flags, config review, migrations alongside code, API docs |
| `references/language-checklists.md` | Final pass in a specific language | 20-40 language-specific items each for TS/JS, Python, Go, Java/Kotlin, Rust, Ruby, PHP, Swift, C#, SQL |
| `references/git-and-pr-hygiene.md` | Commit messages, PR descriptions, size, `gh` commands | Atomic commits, message format, PR template, size numbers, stacked PRs, `gh pr review` and `gh api` for inline comments, drafts, threads, squash vs merge |
| `references/self-review.md` | Before handing over your own change | Author-side pass: diff read-through, run everything, debug leftovers, secrets, TODOs, dead code, docs, description, anticipated questions |
| `scripts/diff_stats.py` | Sizing a diff before reading it | Stdlib script: files by directory, added/removed, risky path flags, largest hunks, test-to-code ratio |

## Verification

A review is a claim about risk; a refactor is a claim about preservation.
Prove both.

**For a review, before you deliver it:**

- Every blocking and should-fix comment has been verified by one of:
  reading the complete code path including callers outside the diff,
  running the code or test that demonstrates it, or writing the failing
  test. Anything not verified is labeled `question:`.
- The summary states explicitly what was checked (files read in full,
  tests run, paths traced, branch pulled or not) and what was not.
- Each comment is actionable: an author could make a change or answer a
  question without a follow-up conversation.
- The verdict matches the comments: no `REQUEST_CHANGES` with only nits,
  no `APPROVE` with an open blocking item.
- You re-read the diff once more looking only for the dangerous-line
  categories: deleted checks, changed defaults, destructive operations,
  permission widening, new network calls, new dependencies.

**For a refactor, before you present it:**

- Test suite run before (recorded) and after; same results, with any
  pre-existing failures noted.
- Behavior diff is empty: characterization tests unchanged and green,
  golden outputs identical, or every difference documented with the
  reason it is acceptable.
- `git diff --stat` against the base shows no files outside the agreed
  boundary. Formatting-only changes to untouched files are reverted.
- Lint and format pass with the repo's own config.
- Each commit is one named transformation and the suite passes at each
  commit (`git rebase -x '<test command>'` or equivalent spot checks).
- The description says how preservation was verified, not just that it
  was.

## Final checklist

- Intent written in one sentence; verdict follows from it.
- Tests read first; missing cases named concretely.
- Risky paths traced beyond the diff; dangerous-line hunt done.
- Every blocking claim verified or downgraded to a question.
- Severity labels present and proportional; nits batched; linter's job
  left to the linter.
- Each comment: observation, why, fix. Tone assumes good faith.
- Specific praise where earned.
- Summary says what was and was not checked.
- Refactors: tests green before and after, behavior diff empty or
  documented, no scope creep, commits named by transformation.
- Domain references consulted for auth, data, migrations, concurrency,
  public API changes.
