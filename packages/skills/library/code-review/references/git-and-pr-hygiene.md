# Git and PR hygiene

How to shape commits and pull requests so they can be reviewed, bisected
and reverted, and how to deliver a review through GitHub's tooling.
Covers atomic commits, commit message format, the PR description, size
guidance with numbers, stacked PRs, `gh pr review` and `gh api` commands
for inline comments and threads, draft PRs, and squash versus merge.
Commands assume `gh` is installed and authenticated (`gh auth status`);
the GitLab equivalents are noted where they differ materially.

## Contents

1. Atomic commits
2. Commit messages
3. The PR description
4. PR size, with numbers
5. Stacked PRs
6. Reviewing with `gh`: reading
7. Reviewing with `gh`: posting comments and verdicts
8. Threads, suggestions and follow-ups
9. Draft PRs and review readiness
10. Squash, merge, rebase
11. Hygiene findings in review

## 1. Atomic commits

A commit is atomic when it does one thing, the tree compiles and tests
pass at that commit, and it can be reverted alone without breaking
anything else. The payoff: `git bisect` finds the breaking change in
minutes; `git revert` undoes one decision without undoing the day's work;
a reviewer can read the branch commit by commit (`git log --reverse -p`)
and understand the author's reasoning in order.

What belongs in one commit: a rename and every call site it touches; a
new function and its tests; a migration and the model change it requires
(if they must deploy together); a dependency bump and the code change it
necessitates. What does not: a rename plus a behavior change; two bug
fixes; formatting of untouched files plus anything.

Shaping commits after the fact:

```sh
git add -p                       # stage hunks selectively
git commit --fixup <sha>         # mark a fix for an earlier commit
git rebase -i --autosquash main  # fold fixups in, reorder, split, reword
git rebase -x 'npm test' main    # run tests at every commit to prove each is green
```

For splitting a commit during interactive rebase: mark it `edit`, then
`git reset HEAD^`, `git add -p` and commit in pieces, `git rebase
--continue`.

Not every repo wants this. Some squash-merge everything and treat the PR
as the atom; there, commit hygiene inside the PR matters less and the PR
title and body carry the message. Check `CONTRIBUTING.md` and the merge
button settings (`gh repo view --json squashMergeAllowed,
mergeCommitAllowed,rebaseMergeAllowed`).

## 2. Commit messages

The format most tooling and most humans agree on:

```
<type>(<scope>): <summary in imperative, under 72 chars>

<body: what changed and, more importantly, why. Wrap at 72. Explain the
problem, the alternatives considered, and anything surprising. Reference
the issue.>

<footer: Fixes #123, BREAKING CHANGE: ..., Co-authored-by: ...>
```

Conventional Commits (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`,
`build`, `ci`, `chore`, `revert`) is optional; use it if the repo does
(check `git log --oneline -30`, `commitlint` config, `.releaserc`,
`cliff.toml`). It enables automated changelogs and semver bumps, which is
its real value; adopted without that tooling it is just a prefix.

Regardless of format, the summary line is imperative ("Add retry to
webhook client", not "Added" or "Adds"), the body explains why, and the
message does not restate the diff. Compare:

```
# weak: restates the diff, no why
Update webhook.ts

Changed the retry count and added a check.

# strong
fix(webhooks): retry only on transient errors

Webhook delivery retried on every exception, including 4xx responses
from the customer's endpoint, so a permanently broken endpoint got five
attempts per event and tripled our outbound volume during the 2024-03
incident. Retries now apply only to network errors and 5xx/429, with
jittered backoff. The 4xx path records the failure and moves on; the
dashboard already surfaces those.

Fixes #4821
```

A commit that needs more than a paragraph to justify is sometimes two
commits; a commit whose body is empty on a non-trivial change is a review
comment.

## 3. The PR description

The description is for the reviewer now and for the archaeologist in two
years. Template (adapt to the repo's `PULL_REQUEST_TEMPLATE.md` if one
exists):

```markdown
## What
One or two sentences: what this change does, in behavior terms.

## Why
The problem or the request, with a link to the issue/ticket. What
happens today that is wrong or missing.

## How
The approach, and the alternatives considered and rejected (one line
each). Anything a reviewer would otherwise have to infer: why this
layer, why this library, why not the obvious way.

## Risk and rollout
What could break; which users or systems are affected; feature flag
name and default; migration deploy order; rollback plan.

## Testing
What you ran and what you observed. Commands and their result, not
"tests pass". Manual steps performed. What you did not test and why.

## Review guidance
Where to start reading; which files are mechanical (rename, generated)
and can be skimmed; the one file that needs careful attention; open
questions you want the reviewer's opinion on.

## Screenshots / recordings
For UI changes: before and after, each state (loading, empty, error).
```

The "Review guidance" section is the most valuable and least common. It
turns a 40-file diff into a 5-file read plus a skim.

Things a description should not do: restate the diff file by file; claim
"no behavior change" without saying how that was verified; say "tested
locally" with no specifics; leave the template's placeholder text in.

## 4. PR size, with numbers

Research on review effectiveness (Cisco/SmartBear's study of 2500 reviews,
and Google's internal data) converges on: defect detection drops sharply
past 200 to 400 lines of change per review session, and reviewers
spending more than about an hour find less per minute. Practical guidance:

| Lines changed (hand-written, non-test, non-generated) | Review experience | Guidance |
|---|---|---|
| Under 50 | Minutes; full attention | Ideal for fixes and single-concern changes |
| 50 to 200 | 15 to 45 minutes; thorough | The target for feature slices |
| 200 to 400 | About an hour; attention fading at the end | Acceptable with good commits and review guidance |
| 400 to 1000 | Multiple sessions or a shallow pass | Ask whether it can split; if not, review in slices by commit and say so |
| Over 1000 | Rubber stamp or refusal | Split, unless it is a mechanical change (rename, codemod, formatter) with a tiny hand-written core that can be reviewed separately |

Files matter as much as lines: 20 files with 10 lines each is harder than
2 files with 100 each because of context switching.

Ways to make a large PR reviewable when splitting is impossible: separate
mechanical commits from logical ones; put generated files in their own
commit; write review guidance; mark files as "viewed" order in the
description; offer a walkthrough call.

`scripts/diff_stats.py` gives the numbers quickly.

## 5. Stacked PRs

A stack is a chain of branches, each building on the last, each with its
own PR targeting the previous branch. The reviewer sees one concern per
PR; the author keeps moving without waiting for review of the base.

```sh
git checkout -b feat/1-schema main        # PR 1 -> main
# ... commit ...
gh pr create --base main --title "..." --body "..."
git checkout -b feat/2-service feat/1-schema   # PR 2 -> feat/1-schema
# ... commit ...
gh pr create --base feat/1-schema --title "..." --body "Stacked on #<PR1>"
```

When PR 1 changes after review, rebase the stack:

```sh
git checkout feat/2-service && git rebase feat/1-schema && git push --force-with-lease
```

When PR 1 merges, retarget PR 2 to `main` (`gh pr edit <n> --base main`;
GitHub does this automatically if PR 1 is merged, not squashed, in most
configurations; with squash merges you rebase PR 2 onto `main` and drop
the now-duplicated commits).

Tools that automate the rebasing and retargeting: `git-spice`, Graphite
(`gt`), `ghstack`, `spr`, `git-branchless`, GitLab's "merge request
dependencies". Use whatever the repo already uses.

Stack etiquette: each PR body links the whole stack and says where it
sits; the base PR is reviewed first; do not merge the top before the
bottom.

## 6. Reviewing with `gh`: reading

```sh
gh pr list --state open --search "review-requested:@me"
gh pr view 123                                # title, body, status, labels
gh pr view 123 --json title,body,baseRefName,headRefName,additions,deletions,changedFiles,files,reviews,commits,labels,isDraft
gh pr diff 123                                # full unified diff
gh pr diff 123 --name-only                    # files touched
gh pr diff 123 | python3 scripts/diff_stats.py   # size, risk flags, test ratio
gh pr checks 123                              # CI status
gh run view --log-failed <run-id>             # failing job logs
gh pr view 123 --comments                     # discussion so far
gh api repos/{owner}/{repo}/pulls/123/comments   # existing inline review comments (JSON)
gh api repos/{owner}/{repo}/pulls/123/reviews    # existing reviews
gh pr checkout 123                            # pull the branch locally
gh issue view <n>                             # the linked issue
```

For the linked issue, parse the body for `#123`, `Fixes`, `Closes`, or
the "Development" sidebar via `gh pr view --json closingIssuesReferences`.

GitLab: `glab mr view`, `glab mr diff`, `glab mr checkout`, `glab ci
status`.

## 7. Reviewing with `gh`: posting comments and verdicts

### A review with a body and a verdict, no inline comments

```sh
gh pr review 123 --approve --body "..."
gh pr review 123 --comment --body "..."
gh pr review 123 --request-changes --body "..."
```

Write the body to a file first for anything multi-line:
`gh pr review 123 --request-changes --body-file review.md`.

### A review with inline comments (the common case)

`gh pr review` cannot attach inline comments; use the REST API to create
one review containing all comments plus the summary, so the author gets
one notification and one coherent review.

```sh
# 1. Get the head commit SHA
SHA=$(gh pr view 123 --json headRefOid -q .headRefOid)

# 2. Build the review payload. `line` is the line number in the NEW file
#    for added/context lines (side RIGHT), or in the OLD file for deleted
#    lines (side LEFT). `start_line` + `line` for a multi-line comment.
cat > review.json <<EOF
{
  "commit_id": "$SHA",
  "event": "REQUEST_CHANGES",
  "body": "**Request changes (1 blocking, 2 should-fix).**\n\nThe blocking item is the missing admin guard on the export route. Checked: read all 14 files, ran the suite locally (green), traced POST /refunds to the Stripe client. Did not run the migration against a large table.",
  "comments": [
    {
      "path": "src/api/admin.ts",
      "line": 12,
      "side": "RIGHT",
      "body": "blocking: this route has no \`requireRole('admin')\`; the other admin routes in this file all have it (lines 5, 8, 20). Any authenticated user can export any user's data. Add the guard and a test like \`admin.test.ts:44\`."
    },
    {
      "path": "src/services/refund.ts",
      "start_line": 40,
      "line": 48,
      "side": "RIGHT",
      "body": "should-fix: this retries on every exception including the \`ValidationError\` from line 42, so a malformed payload is retried five times. Move validation above the retry, or retry only on \`TransientError\`.\n\n\`\`\`suggestion\n  const event = parseWebhook(payload);\n  await retry(() => deliver(event), { retryIf: isTransient });\n\`\`\`"
    },
    {
      "path": "src/services/refund.ts",
      "line": 55,
      "side": "RIGHT",
      "body": "praise: the idempotency key derived from (order_id, attempt) is what makes the webhook retry safe."
    }
  ]
}
EOF

# 3. Post it
gh api --method POST repos/{owner}/{repo}/pulls/123/reviews --input review.json
```

`event` is one of `APPROVE`, `REQUEST_CHANGES`, `COMMENT`; omit it to
create a pending (draft) review you can finish in the UI. Comments can
only be placed on lines that appear in the diff (added, removed, or
context lines within hunks); for an issue in untouched code, comment on
the nearest diff line and say "a few lines above".

### A single inline comment outside a review

```sh
gh api --method POST repos/{owner}/{repo}/pulls/123/comments \
  -f commit_id="$SHA" -f path="src/api/admin.ts" -F line=12 -f side=RIGHT \
  -f body="question: is this route meant to be admin-only like its neighbors?"
```

### Suggestion blocks

A fenced block with the `suggestion` language inside a comment on lines
`start_line..line` offers a one-click replacement for exactly those lines.
Use it for small, certain fixes. Do not use it for a redesign; describe
that and offer to push a commit.

### GitLab

`glab mr approve`, `glab mr note`, and for inline comments the API:
`glab api projects/:id/merge_requests/:iid/discussions -f body=... -f
'position[...]'=...` with `position` fields (`base_sha`, `head_sha`,
`start_sha`, `new_path`, `new_line`).

## 8. Threads, suggestions and follow-ups

- **Resolve threads you opened** once addressed; leave the author's
  threads to the author unless the team convention differs. Via API:
  resolving uses GraphQL (`resolveReviewThread(input:{threadId})`); find
  thread ids with a GraphQL query on `pullRequest(number:) {
  reviewThreads(first: 100) { nodes { id isResolved comments(first:1) {
  nodes { body path } } } } }`.
- **Re-review after changes:** `gh pr diff 123` again, or compare the
  range since your last review: `gh api repos/{owner}/{repo}/pulls/123/
  commits` to find the new commits, then `git diff <old-head>..<new-head>`
  after `gh pr checkout`. Review only what changed, re-verify the
  blocking items, and update the verdict.
- **Follow-up tickets:** when approving with should-fix items deferred,
  create the issue and link it in the approval (`gh issue create --title
  ... --body "Follow-up from #123: ..."`).
- **Request a specific reviewer** for a domain slice: `gh pr edit 123
  --add-reviewer alice` with a comment saying which files.

## 9. Draft PRs and review readiness

A draft PR (`gh pr create --draft`; `gh pr ready` to flip) signals "not
ready for a verdict". Use it for early design feedback ("is this
direction right before I write the tests?"), for CI to run on a branch,
or to show progress on a long change.

Reviewing a draft: review the design and the approach, not the polish.
Say explicitly that you are not checking tests or edge cases yet. Do not
approve or request changes on a draft; leave comments.

Ready for review means: CI green (or failures explained), description
complete, self-review done (`self-review.md`), no WIP commits, rebased on
a recent base so the diff is only your change.

## 10. Squash, merge, rebase

| Strategy | History | When it fits |
|---|---|---|
| Squash merge | One commit per PR on main; branch commits lost | Repos where the PR is the atom and branch commits are messy; most application repos |
| Merge commit | Full branch history plus a merge commit | Repos that value atomic commits and bisecting within a PR; stacks that need retargeting to work |
| Rebase merge | Branch commits replayed onto main, no merge commit | Linear history with atomic commits; requires disciplined branch commits |

The repo's setting decides; do not argue it in a PR. If squashing, the PR
title and body become the commit message, so write them to the commit
message standard in section 2 (`gh pr merge --squash --subject ...
--body ...` to control it). If merging or rebasing, the branch commits
must each be clean (section 1).

Before merge: `gh pr view 123 --json mergeStateStatus,reviewDecision,
statusCheckRollup` to confirm green, approved, and up to date; `gh pr
merge 123 --squash --delete-branch` (or `--merge`, `--rebase`), or enable
auto-merge with `gh pr merge --auto`.

## 11. Hygiene findings in review

| Finding | Severity | Comment |
|---|---|---|
| Unrelated changes in the PR (formatting of other files, a drive-by rename) | should-fix | "These 12 files are formatting-only and unrelated; could they go in a separate PR so this one is the 3 files with the behavior change?" |
| Merge commits from main inside the branch making the diff noisy | nit | "Rebasing on main would make `git log -p` readable; not blocking." |
| WIP / fixup / "address comments" commits in a repo that merges (not squashes) | should-fix | "Since this repo merge-commits, could you squash the fixups into their parents so each commit is green?" |
| Commit messages with no why on a non-trivial change | nit; should-fix in repos with a message standard | "The body of the main commit could say why the retry policy changed; the PR description has it, and it will be lost on merge." |
| Description missing testing section or claiming untested things | should-fix | "What did you run? The description says tests pass but CI shows the integration suite skipped." |
| PR too large to review responsibly | should-fix, raised first | `review-methodology.md` section 9 |
| Secrets, `.env`, build output, IDE files, large binaries committed | blocking for secrets; should-fix otherwise | Secrets: rotate first (`security/references/secrets.md`); then `git rm --cached` and `.gitignore` |
| Lockfile out of sync with the manifest, or lockfile missing | should-fix | "`package-lock.json` does not reflect the new dependency; run `npm install` and commit it." |
| Force-push over a reviewed branch without a note | nit | "A note on what changed since the last review helps re-review; `git range-diff` output is ideal." |
