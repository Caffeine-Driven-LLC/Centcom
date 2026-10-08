# Self-review before asking for review

The author-side pass that catches what the reviewer would otherwise spend
their attention on. Run it before opening a PR, before flipping a draft to
ready, and whenever you (the agent) finish a change bigger than a few
lines. The goal is that the reviewer's first comment is about a design
decision, not about a `console.log`.

## Contents

1. Why self-review is worth the time
2. Step 1: Read your own diff as a stranger
3. Step 2: Run everything
4. Step 3: Hunt leftovers
5. Step 4: Check scope and shape
6. Step 5: Update what the code change implies
7. Step 6: Write the description
8. Step 7: Anticipate the questions
9. The agent-specific pass
10. Checklist

## 1. Why self-review is worth the time

Every defect a reviewer finds costs a round trip: their time to write it
up, your time to context-switch back, their time to re-review. A defect
you find yourself costs one edit. Self-review typically removes a third
to a half of what would have been commented on, and the comments that
remain are the valuable ones about judgment rather than hygiene.

There is a second benefit: reading your own diff in the reviewer's
format (the unified diff, not the editor) shows you what you actually
changed rather than what you meant to change. The two differ more often
than feels plausible.

## 2. Step 1: Read your own diff as a stranger

Use the diff view, not your editor:

```sh
git diff main...HEAD --stat                  # the shape: is every file expected?
git diff main...HEAD                         # the whole thing, in order
git diff main...HEAD -w                      # without whitespace noise
git log --oneline main..HEAD                 # the commit story
gh pr diff <n>                               # once the PR exists, what the reviewer sees
```

Read it top to bottom with the reviewer's questions:

- Can I state what this change does in one sentence? If not, it is two
  changes.
- Does every file in `--stat` belong? Files you do not remember touching
  are formatter runs, accidental saves, or scope creep.
- For each hunk: would I understand this without the context in my head?
  Is there a comment that is now wrong? A name that made sense while
  writing and does not when reading?
- Where would I, as a reviewer, put a `blocking:`? Go there and look
  harder.
- What would I ask the author? Answer it in the description or the code.

Reading the commits in order (`git log --reverse -p main..HEAD`): does
the sequence tell the story? Are there "fix typo", "oops", "address
comments" commits that should be squashed into their parents
(`git-and-pr-hygiene.md` section 1)?

## 3. Step 2: Run everything

Actually run it; do not reason that it should work.

- The full test suite, not just the tests you wrote (`npm test`, `pytest`,
  `go test ./...`, `cargo test`, `./gradlew test`, `bundle exec rspec`,
  `dotnet test`, `swift test`, `php artisan test`). Note pre-existing
  failures separately.
- Lint and format with the repo's config (`npm run lint`, `ruff check &&
  ruff format --check`, `golangci-lint run`, `cargo clippy -- -D warnings
  && cargo fmt --check`, `rubocop`, `./gradlew check`, `dotnet format
  --verify-no-changes`, `swiftlint`, `vendor/bin/phpstan`). Fix what it
  flags; do not add disables.
- Type check where separate from the build (`tsc --noEmit`, `mypy`,
  `pyright`).
- Build from clean if the change touches build config, dependencies or
  generated code.
- The thing itself: start the server and hit the endpoint; run the CLI
  with the new flag; open the page and click through each state; run the
  migration up and down against a copy of realistic data; consume a
  message from the queue.
- The edge cases you listed while writing: empty, null, zero, max,
  duplicate, concurrent, unauthorized. Each one, by hand or by test.
- Break your own tests: comment out the new logic and confirm the new
  tests fail. Tests that stay green are decoration.
- If anything is performance-sensitive, measure before and after
  (`performance-and-concurrency-review.md` section 11).

Record what you ran and what you saw; it goes in the description.

## 4. Step 3: Hunt leftovers

Grep the diff, not the tree, for things that should not ship:

```sh
D="git diff main...HEAD"
$D | grep -nE '^\+.*(console\.(log|debug|dir)|print\(|println!|fmt\.Print|System\.out|puts |p |var_dump|dd\(|dump\(|NSLog|debugPrint|Console\.Write)' 
$D | grep -nE '^\+.*(debugger|binding\.pry|byebug|breakpoint\(\)|pdb\.set_trace|import pdb|ipdb|dbg!)'
$D | grep -nE '^\+.*(TODO|FIXME|XXX|HACK|WIP|TEMP|REMOVE ME|DO NOT MERGE)'
$D | grep -nE '^\+.*(\.only\(|\.skip\(|xit\(|xdescribe\(|fit\(|fdescribe\(|@pytest\.mark\.skip|@Ignore|@Disabled|t\.Skip|#\[ignore\]|skip:)'
$D | grep -nE '^\+.*(eslint-disable|noqa|nolint|ts-ignore|ts-expect-error|rubocop:disable|phpcs:ignore|pragma warning|allow\(|suppress)'
$D | grep -nE '^\+.*(localhost|127\.0\.0\.1|0\.0\.0\.0|:3000|:8080|staging\.|\.local)'
$D | grep -nEi '^\+.*(api[_-]?key|secret|password|passwd|token|private[_-]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE)' | grep -vE 'process\.env|os\.environ|getenv|ENV\[|config\.|settings\.|secrets\.'
$D | grep -nE '^\+.*(sleep|setTimeout\([^,]+, *[0-9]{4,})' 
$D | grep -nE '^\+.*(verify=False|rejectUnauthorized: *false|InsecureSkipVerify|--no-verify|NODE_TLS_REJECT_UNAUTHORIZED)'
git diff main...HEAD --stat | grep -E '\.(env|pem|key|p12|sqlite|db|log|DS_Store)$|node_modules/|dist/|build/|__pycache__|\.idea/|\.vscode/'
```

Also run `gitleaks detect --source . --log-opts="main..HEAD"` or
`trufflehog git file://. --since-commit main` if available
(`security/references/secrets.md`). If a secret made it into any commit,
rotate it before doing anything else; rewriting history does not
un-leak it.

Then the quieter leftovers:

- Commented-out code: delete it; git remembers.
- Dead code the change made unreachable: the old function nobody calls
  now, the flag branch that is always true, the import that is unused
  (the linter catches most; `knip`, `vulture`, `deadcode`, `cargo udeps`
  catch the rest).
- Stale comments and docstrings near the change; parameter lists in
  docstrings that no longer match.
- Hard-coded values that should be config, or config that should be
  constants.
- Error messages with typos or internal jargon that a user will see.
- Test fixtures with real-looking personal data.

## 5. Step 4: Check scope and shape

- **Scope.** Every changed file traces to the task. Formatting changes to
  files you only passed through: revert them (`git checkout main --
  path`), or if the repo wants them, put them in a separate PR. Drive-by
  improvements to neighboring functions: revert or separate. "While I
  was in there" is the phrase to catch yourself saying.
- **Behavior change hidden in a refactor** or vice versa. If the PR
  claims no behavior change, confirm no test expectation changed and no
  default moved. If it changes behavior, the description says so.
- **Size.** `scripts/diff_stats.py` or `--stat`. Past 400 hand-written
  lines, decide now whether to split (`refactoring.md` section 9) rather
  than after a reviewer asks.
- **Commits.** Each compiles and passes (`git rebase -x '<test cmd>'
  main` proves it). Messages explain why. Fixups squashed.
- **Base.** Rebased on current main (or merged, per repo convention) so
  the diff is only your change and CI runs against reality.

## 6. Step 5: Update what the code change implies

A code change usually implies other changes; reviewers notice when they
are missing:

- Tests for new behavior and for the bug being fixed (the regression test
  that fails on main and passes here).
- Documentation: README sections showing the old usage; API reference
  for changed signatures or endpoints; inline doc comments; architecture
  notes if a boundary moved.
- Changelog or release notes entry, in the repo's format (`CHANGELOG.md`,
  changesets, `towncrier` fragments, release-please annotations).
- `.env.example`, config schemas, Helm values, Terraform variables for new
  config keys; deployment config in each environment, or a linked PR.
- Migration file, and its reversibility, and the deploy order note
  (`api-and-compat-review.md` section 8).
- Type definitions, OpenAPI/proto/GraphQL schema, generated clients
  regenerated.
- Lockfile updated and committed.
- Feature flag registered, defaulted, and ticketed for cleanup.
- Monitoring: a new failure mode has a log line or metric; a new
  endpoint has a dashboard entry if the repo keeps them.
- Deprecation notices for anything you replaced but kept.

## 7. Step 6: Write the description

Use the template in `git-and-pr-hygiene.md` section 3 or the repo's own.
The parts that matter most and are most often skipped:

- **Why**, with a link. Not "refactor X" but what was wrong with X.
- **Testing**, concretely: the commands you ran, their results, the manual
  steps, the edge cases, and what you did not test. "Tests pass" is not
  information; "`pytest` 412 passed, 2 skipped (pre-existing, see #88);
  manually verified the 401 path with an expired token via curl; did not
  test against MySQL" is.
- **Risk and rollout**: flag name, migration order, affected users,
  rollback.
- **Review guidance**: where to start, what is mechanical, what needs
  care, what you are unsure about. Asking "I was not sure whether the
  retry belongs in the client or the job; I put it in the client because
  X; push back if you disagree" gets you a better review than hoping
  nobody notices.
- **Screenshots or recordings** for anything visual, every state.

Reread the description against the final diff, not against what you set
out to do. Descriptions drift as the implementation evolves.

## 8. Step 7: Anticipate the questions

Imagine the three most likely reviewer comments and handle them now:

- If a reviewer would ask "why not use the existing helper?", either use
  it or say why not in a code comment or the description.
- If they would ask "what happens when X is empty?", add the test or the
  guard.
- If they would ask "is this safe to run twice?", add the idempotency note
  or the key.
- If they would ask "did you consider the N+1 here?", add the `EXPLAIN`
  or the eager load.
- If they would ask "where is the migration?", link it.
- If they would say "this PR is doing two things", split it now.

Walk through the change type table in SKILL.md for your change and read
the domain reference it points at. Run the relevant checks yourself
(`security/references/code-audit-playbook.md` greps for a new handler;
`database` for a new query). The reviewer will.

## 9. The agent-specific pass

When you are the author, add the checks from
`reviewing-ai-generated-code.md` section 4, because your own failure
modes are the ones you are least likely to notice:

- Every API, method, flag and import you used: verified to exist in the
  installed version, by compiling, running, or inspecting the package.
  Not from memory.
- Every claim in your description: backed by something you actually ran
  in this session. If you did not run it, the description says "not run".
- Every new helper: grepped for an existing one in the repo and its
  dependencies first.
- Every try/catch you added: catches a named exception for a stated
  reason, or is removed.
- Every abstraction you introduced: has at least two real uses now, or is
  inlined.
- Every comment you wrote: matches the code as it ended up, not as you
  first drafted it.
- Every file you touched: implied by the task. Revert the rest.
- Your tests: fail when the implementation is broken (you checked by
  breaking it).
- Scope: you did what was asked, not what you decided would also be nice.
  Suggestions for more go in the description as suggestions.
- Uncertainty: stated, not hidden. "I believe this handles DST correctly
  but did not test a transition date" is more useful than silence.

## 10. Checklist

- Diff read in full, in diff form; every file expected; intent in one
  sentence.
- Full suite, lint, format, type check run with the repo's config; results
  recorded; pre-existing failures noted.
- The feature exercised by hand for the main path and the listed edge
  cases.
- New tests confirmed to fail when the implementation is broken.
- Leftover hunt done: debug output, breakpoints, skipped tests, lint
  disables, TODOs, local URLs, secrets, disabled TLS verification, stray
  files.
- Secrets scan on the branch's commits.
- Dead and commented-out code removed; stale comments fixed.
- No unrelated changes; formatting-only diffs to untouched files reverted.
- Commits atomic and green; messages explain why; fixups squashed; rebased
  on current base.
- Docs, changelog, config examples, schemas, generated code, lockfile,
  migration and flag registration updated as implied.
- Description complete: what, why, how, risk, testing with specifics,
  review guidance, screenshots for UI.
- Domain checks from the change type table run (auth greps, query plans,
  migration safety, compat).
- Agent pass: APIs verified, claims backed by runs, no scope creep,
  uncertainty stated.
