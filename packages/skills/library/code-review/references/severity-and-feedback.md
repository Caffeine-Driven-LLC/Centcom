# Severity and feedback

How to label what you found so the author can prioritize, and how to write
it so they act on it. Covers the severity rubric with examples, the labels,
the anatomy of a comment, tone rewrites, comment volume, specific praise,
the approve/request-changes decision, writing the summary, disagreeing
well, and a bank of example comments across severities.

## Contents

1. The severity rubric
2. Labels and where to put them
3. Anatomy of a good comment
4. Tone: before and after
5. How many comments
6. Praise that teaches
7. Approve, approve with nits, or request changes
8. Writing the summary
9. Disagreement protocol
10. Reviewing in a language you know less well
11. Comment bank

## 1. The severity rubric

Severity is about consequence if merged as-is, not about how much the
code bothers you.

| Label | Meaning | Test | Examples |
|---|---|---|---|
| `blocking` | Merging this causes harm or is clearly wrong against the stated intent | "If this ships tonight, does something bad happen that someone will have to clean up?" | Missing authz on a new endpoint; data loss on a path; a race that corrupts state; a migration that locks a hot table; a public API break with no versioning; a test that cannot fail; secret in the diff; the feature does not do what the ticket says |
| `should-fix` | Wrong, fragile or costly, but survivable; fix before merge or in an immediate follow-up with a ticket | "Will this cause a bug report, an on-call page, or a painful refactor within months?" | Error swallowed and logged at debug; N+1 on a list endpoint with bounded size; missing test for the edge case the issue was about; retry wrapping non-transient failures; leaky abstraction that two callers already depend on; misleading name on a public function |
| `nit` | Taste, polish, minor consistency; author may ignore | "Would two reasonable engineers disagree, or would nobody notice either way?" | Naming of a local; comment wording; ordering of struct fields; slightly long function that is still readable |
| `question` | You do not know, and the answer could change the verdict | "Am I asserting or guessing?" | "Can this be null here?"; "Is this called concurrently?"; "Is the default change intentional?" |
| `praise` | Something specifically good that you want more of | "Could I say exactly what was good and why?" | A well-chosen boundary; a test that pins a tricky edge; a clear commit sequence |

Two rules that follow from the rubric:

- A `blocking` requires verification (you traced it or ran it). Otherwise
  it is a `question` with your suspicion stated.
- Severity does not inflate with how many times the pattern appears. Ten
  nits are ten nits, batched into one comment.

### Severity for non-bug findings

| Finding | Usually |
|---|---|
| Missing tests for the main path of new behavior | should-fix |
| Missing tests for an edge case nobody mentioned | nit or question, unless the edge case is dangerous (then should-fix) |
| Duplicates existing utility | should-fix if the existing one has behavior the copy lacks (validation, logging); nit otherwise |
| Inconsistent with the file's conventions | nit, batched |
| Inconsistent with a documented house rule | should-fix, cite the rule |
| Unnecessary abstraction | should-fix if it hides a bug or will be copied; nit otherwise |
| Performance in a cold path | nit |
| Performance in a known hot path, measured or clearly algorithmic | should-fix or blocking depending on scale |
| Scope creep (unrelated changes) | should-fix: ask to split |
| Debug leftovers, commented-out code | should-fix (they ship) |
| Typos in user-facing text | should-fix; in comments, nit |

## 2. Labels and where to put them

Prefix every inline comment with the label and a colon. Lowercase, short.

```
blocking: `orders` is iterated after `conn` is closed on line 88, so the second page always fails with a closed-connection error. Move the `with` block to wrap the loop, or materialize the list first.
```

Some teams use emoji or the "Conventional Comments" format
(`issue (blocking):`, `suggestion (non-blocking):`, `nitpick:`,
`question:`, `praise:`, `thought:`). If the repo or team already uses
one, use theirs; search recent PRs. Otherwise the five labels here are
enough.

In a conversational or markdown review, group by label with the most
severe first:

```
## Verdict: request changes (1 blocking)

### Blocking
- src/api/orders.ts:88 ...

### Should fix
- ...

### Questions
- ...

### Nits (batched, feel free to ignore)
- ...

### Praise
- ...

### What I checked
- Read all 14 files; ran the test suite locally (green, 2 pre-existing skips); traced the create-order path from handler to repository; did not run the migration against a large table.
```

## 3. Anatomy of a good comment

Four parts, in this order, as short as each can be:

1. **Observation.** What the code does, with the line or symbol. Not what
   you feel about it.
2. **Why it matters.** The consequence: which input, which outcome.
3. **Suggestion.** What to do instead. Concrete.
4. **Code (optional).** A suggestion block for small fixes, a sketch for
   larger ones.

```
should-fix: `parseAmount` returns `NaN` for an empty string (line 14: `Number("")` is 0, but `Number(" ")` is also 0 and `Number("abc")` is NaN), and `NaN` passes the `> 0` check on line 20 as false, so the order silently gets amount 0 rather than rejecting. Validate with a regex or `Number.isFinite` before the comparison.

```suggestion
const n = Number(raw);
if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`amount: "${raw}"`);
```
```

What the structure prevents: comments that are only observation ("this
returns NaN") and leave the author to work out whether you care; comments
that are only suggestion ("use Number.isFinite") with no reason, which
read as taste; comments that are only consequence ("this will break
orders") with no location.

### Phrasing rules of thumb

- Talk about the code, not the author. "This function retries..." not
  "You retry...".
- Prefer "because" over "should". Every instruction gets its reason.
- When uncertain, ask; when certain, say so and show why.
- One idea per comment. Two findings on the same line are two comments
  (or one comment with two labeled bullets).
- Offer the fix even if it is obvious; it halves the author's cost.
- If the fix is large, offer to pair or to push a commit rather than
  describing a redesign in a text box.

## 4. Tone: before and after

Tone is not softness. It is precision plus the assumption that the author
is competent and busy.

| Before | After |
|---|---|
| "This is wrong." | "should-fix: this returns the cached value even after `invalidate()` because the key on line 30 includes the old timestamp. Compute the key once in `get`." |
| "Why didn't you use the existing helper?" | "should-fix: `formatMoney` in `utils/money.ts` already handles the zero-decimal currencies this reimplements (and this version drops JPY). Use it here, or if it does not fit, tell me what is missing and we can extend it." |
| "Did you even test this?" | "question: I could not find a test for the expired-token path. Is it covered somewhere I missed? If not, one that asserts a 401 with a valid-signature expired token would pin the behavior." |
| "Nit: rename." | "nit: `data` here is specifically the list of unpaid invoices; `unpaidInvoices` would save the next reader a lookup." |
| "This is a terrible pattern." | "should-fix: catching `Exception` here also catches `KeyboardInterrupt` subclasses in older code paths and, more importantly, the `ValidationError` raised on line 12, which then gets retried five times. Catch `RequestError` and let the rest propagate." |
| "I would have done this completely differently." | "thought (non-blocking): an alternative is to keep the state machine in the domain object and have the handler just call `order.transition(to)`. That would make the three handlers trivial and put the rules in one place. Happy to leave this as-is for this PR and discuss separately." |
| "LGTM" | "approve: read all files, ran the suite, traced the refund path including the webhook retry. The idempotency key on the refund call (line 55) is the thing that makes this safe to retry; good call. One nit inline." |
| "Please add tests." | "should-fix: the new `mergeRanges` has no tests, and the overlap logic on lines 20-31 has at least three boundary conditions (touching, contained, identical). A table-driven test over those would catch regressions; here is a start: ..." |
| "Consider refactoring this." | "nit: `process` is 120 lines with three distinct phases (parse, validate, persist) separated by the comments on lines 15, 48, 90. Extracting each into a function named after the comment would let the phases be tested separately. Not blocking." |
| "Security issue!!!" | "blocking: the new `GET /admin/users/:id/export` on line 12 has no `requireRole('admin')`; the other admin routes in this file all have it (lines 5, 8, 20). As-is any authenticated user can export any user's data. Add the guard and a test like the one at `admin.test.ts:44`." |

## 5. How many comments

Target: as few as will convey your judgment. Guidance by diff size:

| Diff size (hand-written lines) | Typical comment count | If you have more |
|---|---|---|
| Under 50 | 0 to 3 | Something is wrong with the design or the review; step back |
| 50 to 200 | 2 to 8 | Batch nits into one; drop anything a linter covers |
| 200 to 400 | 5 to 15 | Lead with a summary of themes; inline only the instances that need a location |
| Over 400 | Ask for a split, or review one slice thoroughly | Do not produce 40 comments; produce one top-level comment on the design and 5 to 10 on the riskiest slice |

Techniques that reduce count without losing content:

- **Batch by theme.** "nit (batched): three naming consistency points: `usr` -> `user` (line 10), `getData` -> `fetchInvoices` (line 44), `tmp2` -> `remainder` (line 81)."
- **Comment on the first instance only.** "should-fix: unchecked error return here, and the same pattern at lines 50, 71, 102."
- **Promote to summary.** If the same design issue produces ten line
  comments, it is one design comment at the top.
- **Delete.** Re-read your comments before submitting; remove any you
  would not defend if challenged.

## 6. Praise that teaches

Praise is not politeness padding. It is information about what to do more
of, and it only carries information when it is specific.

Useless: "Nice!", "Clean code", "Great PR".

Useful:

- "praise: putting the retry at the HTTP client level instead of in each
  caller means the three endpoints get the same backoff for free and the
  tests for it live in one place."
- "praise: the test on line 88 (expired token with a valid signature) is
  exactly the case that bit us in the last incident. Glad it is pinned."
- "praise: the commit sequence (rename, then extract, then the behavior
  change) made this 600-line diff reviewable in twenty minutes."
- "praise: `explain` in the description showing the index is used saved
  me from asking."

One or two pieces of real praise per review is plenty. Zero is fine on a
tiny PR. Fake praise to soften a rejection is noticed and resented.

## 7. Approve, approve with nits, or request changes

| Verdict | When | What the summary says |
|---|---|---|
| Approve | No blocking, no should-fix, or should-fix items the author has agreed to handle in a tracked follow-up | What you checked; any nits are optional |
| Approve with nits | No blocking; should-fix items are small and you trust the author to address before merge without another round | "Approving on the assumption the two should-fix items are addressed; no need to re-request." |
| Comment (no verdict) | You reviewed a slice, or you are not an owner, or you have only questions | What you covered and what you did not |
| Request changes | At least one blocking, or several should-fix that together change the design | The blocking items first; what would flip you to approve |

Request changes is not an insult; it is a routing decision that says
"another look is needed". Make it easy to flip: state the exact condition
for approval. Never request changes over nits alone.

## 8. Writing the summary

Five parts, in order, as short as possible:

1. **Verdict** with the count of blocking/should-fix.
2. **The one or two things that matter**, in a sentence each.
3. **What you checked**: files read in full vs skimmed, tests run,
   paths traced, branch pulled, tools used.
4. **What you did not check** and why (time, access, out of scope).
5. **Optional**: a note on the approach (design-level thought, an offer to
   pair on a follow-up).

Example:

> **Request changes (1 blocking, 2 should-fix).**
>
> The blocking item is the missing admin guard on the export route; the
> rest is solid and the refund flow is careful about idempotency.
>
> Checked: read all 14 files; ran `pnpm test` locally (green); traced
> `POST /refunds` from handler to Stripe client including the webhook
> retry path; grepped callers of `RefundService.create` (only the handler
> and the job). Did not run the migration against a production-sized
> table; `database` notes suggest adding the index concurrently and I left
> a should-fix for that.

## 9. Disagreement protocol

Disagreements are normal and are where most of the learning in code
review happens. The protocol:

1. **State the trade-off, not the preference.** "A gives X at the cost of
   Y; B gives Y at the cost of X. In this codebase Y matters more because
   Z." If you cannot name the trade-off, it is taste; label it a nit and
   let go.
2. **One round in writing.** If the author pushes back with a reason you
   had not considered, say so and close the thread. If you still disagree
   after one exchange, move to a call or ask a third person. Threads of
   six replies help nobody.
3. **Author's call on taste; reviewer's call on correctness; team's call
   on conventions.** Correctness disagreements get resolved by evidence
   (a test, a reproduction). Convention disagreements get resolved outside
   the PR by changing the written convention.
4. **Disagree and commit.** Once decided, approve without a parting shot.
   "Approving; I still prefer approach B but A is fine and this is not the
   PR to decide it" is the whole comment.
5. **When you were wrong, say so plainly.** "You are right, the type
   guard on line 12 makes that impossible. Resolving." Credibility
   compounds.

Never: block a PR to win an argument; re-raise a closed thread in a later
PR without new information; escalate before one honest exchange; use
"we" to dress up a personal preference as a team rule.

## 10. Reviewing in a language you know less well

Say so in the summary. Focus on what transfers: intent, tests, error
paths, data flow, naming, structure. Lean on `language-checklists.md` for
the idioms, and on the linter. Phrase idiom comments as questions:
"question: is it idiomatic here to return `(nil, err)` without wrapping?
Other call sites in the package wrap with `fmt.Errorf("...: %w", err)`."
Do not pretend to a confidence you lack; a reviewer who is candid about
limits gets listened to on the things they are sure about.

## 11. Comment bank

Thirty-plus examples across severities and languages, for calibration.
Adapt, do not paste.

### Blocking

1. `blocking:` The new `DELETE /projects/:id` (line 31) checks that the user is authenticated but not that they own the project; `ProjectPolicy#destroy?` exists and the other destructive routes use it (lines 18, 25). Any logged-in user can delete any project. Add `authorize @project` and a test mirroring `spec/requests/projects_spec.rb:120`.
2. `blocking:` `UPDATE accounts SET balance = balance - :amt` on line 44 runs outside the transaction opened on line 40 because `conn.commit()` on line 42 ends it. A failure on line 46 leaves the debit without the credit. Move the commit after both statements.
3. `blocking:` The migration adds `NOT NULL` without a default to `orders.region`; on the 40M-row table this rewrites every row under an exclusive lock. Add the column nullable, backfill in batches, then add the constraint (see `database/references/` on migrations). I can pair on the batch script.
4. `blocking:` `cache.get(f"user:{user_id}")` on line 12 has no tenant in the key, and `user_id` is per-tenant. Tenant B with id 7 reads tenant A's user 7. Include `tenant_id` in the key, and add a test with two tenants.
5. `blocking:` `Promise.all` on line 60 is not awaited (missing `await`), so the handler returns before the writes finish and errors become unhandled rejections. Add `await`; the test passes today only because the mock resolves synchronously.
6. `blocking:` `process_items` reads and writes `self.seen` (line 22) and the worker config runs 8 threads over the same instance. This is a data race; two workers can both skip or both process an item. Make `seen` per-call, or guard it with a lock, or move dedup to the queue.
7. `blocking:` The response shape changed from `{ items: [...] }` to `[...]` (line 90), and the mobile client on `v2.3` reads `.items`. This is a breaking change to a public endpoint; either keep the envelope or version the route.
8. `blocking:` `test_refund_success` asserts `mock_stripe.refund.assert_called()` and nothing else (line 71). It passes if the refund amount is wrong, the currency is wrong, or the order is never marked refunded. Assert on the arguments and on the order state.
9. `blocking:` `AWS_SECRET_ACCESS_KEY=AKIA...` appears in `config/dev.env` in this diff. Even in a dev file this is a live-looking key. Remove it from the commit, rotate it, and use the secret manager (`security/references/secrets.md` has the first-hour steps).
10. `blocking:` The ticket asks for soft delete; this sets `deleted_at` on `users` but the `sessions` FK has `ON DELETE CASCADE` and line 33 still calls `user.destroy`. Sessions are hard-deleted and the user row is gone. Replace `destroy` with the soft-delete method and add a test that the row survives.

### Should-fix

11. `should-fix:` `except Exception: logger.debug(...)` on line 50 swallows every failure including the `ConnectionError` that should surface. Log at `error` with `exc_info=True`, and either re-raise or return an explicit failure the caller handles.
12. `should-fix:` The loop on line 28 calls `repo.find_author(post.author_id)` per post; for the 200-item page that is 201 queries. Fetch authors in one query with `WHERE id IN (...)` and join in memory, or use the ORM's eager load.
13. `should-fix:` `retry(times=5)` wraps `handle()` which includes `validate(payload)`. A malformed payload is retried five times with backoff before failing. Move validation outside the retry, or retry only on `TransientError`.
14. `should-fix:` `isValid` on line 9 returns `true` for an empty array because `every` on `[]` is `true`. If an empty list is invalid here (the callers on lines 40 and 62 seem to assume at least one), check length first.
15. `should-fix:` This reimplements `chunk` from `lodash`, which is already a dependency, and the local version drops the final partial chunk (line 17: `i + size <= arr.length`). Use `_.chunk` or fix the boundary and add a test for `length % size != 0`.
16. `should-fix:` `defer f.Close()` on line 22 is inside the loop, so files stay open until the function returns; with a large directory this exhausts descriptors. Move the open/close into a helper called per iteration.
17. `should-fix:` The new `status` enum adds `CANCELLED` but `renderStatus` on line 80 has no case for it and falls through to the `default` that renders "Unknown". Add the case; a `switch` exhaustiveness check (`assertNever`) would catch the next one.
18. `should-fix:` `@Transactional` on a `private` method (line 45) has no effect with Spring's proxy-based AOP; the method runs without a transaction. Make it public on a bean that is called from outside, or move the annotation to the caller.
19. `should-fix:` No test covers the overlapping-range case for `mergeRanges` (lines 20-31 have three branches; tests exercise one). A table-driven test over `[touching, contained, identical, disjoint]` would pin it. Sketch below.
20. `should-fix:` The PR mixes the rename (`Order` -> `PurchaseOrder`, ~700 lines) with the new discount logic (~150 lines). The rename hides the logic. Could you split, rename first? I will approve the rename quickly.
21. `should-fix:` `console.log(payload)` on line 66 logs the full request body including the card number field. Remove, or log a redacted summary (`security/references/logging-privacy.md`).
22. `should-fix:` `time.sleep(2)` in the test on line 14 waits for the background job; it makes the suite 2 seconds slower per test and flakes under load. Use the job's synchronous mode or poll with a timeout.
23. `should-fix:` `Optional.get()` without `isPresent` on line 70; `findByEmail` returns empty for unknown emails and the API would 500 instead of 404. Use `orElseThrow(() -> new NotFoundException(...))`.
24. `should-fix:` The `unwrap()` on line 33 panics if the env var is unset; in production that takes the service down at boot with a stack trace instead of a message. `expect("DATABASE_URL must be set")` at minimum, or return a config error.

### Nits

25. `nit:` `data` on line 12 is the list of unpaid invoices; `unpaidInvoices` reads better at the call sites on lines 30 and 41.
26. `nit (batched):` comment on line 8 says "returns null on error" but it throws since the last change; `TODO` on line 50 has no owner or ticket; `utils2.ts` as a file name will not age well. None blocking.
27. `nit:` the three early returns on lines 15-22 could be a single guard clause with the conditions combined, but this is readable as-is. Your call.
28. `nit:` `is_valid_flag` as a boolean name reads oddly as a predicate; `is_valid` or `has_flag` depending on which it means.
29. `nit:` ordering: the other handlers in this file validate, then authorize, then act; this one authorizes first. Either order is defensible, matching the neighbors is just easier on the reader.

### Questions

30. `question:` Can `lookup()` return `None` here? The type hint says `User`, but `repo.lookup` on line 88 of `repo.py` returns `Optional[User]`. If it can, line 14 dereferences `None`.
31. `question:` Is the default page size change (50 -> 20, line 9) intended? It is not in the description and the CLI in `tools/export.py` assumes 50 pages of 50.
32. `question:` Is `on_message` ever invoked concurrently for the same `conversation_id`? If so the read-modify-write on lines 30-34 needs a lock or an atomic update.
33. `question:` I expected a migration for `orders.region` but did not find one in the diff. Is it in a separate PR, or created by the ORM at startup?
34. `question:` The old code caught `TimeoutError` and returned a cached value; the new code lets it propagate (line 40). Deliberate? It changes behavior for the dashboard, which called this with a 2s budget.

### Praise

35. `praise:` the idempotency key derived from `(order_id, attempt)` on line 55 is what makes the webhook retry safe; good that it is on the client call and not just in the DB.
36. `praise:` the commit sequence (rename -> extract -> behavior) made this reviewable in one pass. Thank you.
37. `praise:` the test at line 102 (clock skew of +5 minutes on token `nbf`) is a case I would not have thought to ask for.
38. `praise:` the `explain analyze` output in the description answered the index question before I asked it.
