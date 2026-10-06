# Claude Code in Centcom

Start with `plan/START_HERE.md`, `plan/GUIDELINES.md` and the lane card you are building. Lane
cards are `plan/lanes/client/C###.json`. Contracts in `contracts/` win over cards (GUIDELINES
§2.2). Run `tools/ci/gates.sh` before every push: it runs every check CI runs, in the same order.

## Claude PR pipeline

`.github/workflows/claude-pr.yml` reviews, fixes and merges lane PRs labelled `claude-automerge`.
Every trigger re-reads the PR, and `tools/ci/claude-pr-state.mjs` picks one step:

| State of the head SHA                                                | Step                                        |
| -------------------------------------------------------------------- | ------------------------------------------- |
| not opted in, draft, fork, `do-not-merge`, a standing change request | skip                                        |
| touches a protected path, or its files cannot all be listed          | hand off to a human                         |
| conflicts with main                                                  | merge main; Claude resolves real conflicts  |
| the CI check failed                                                  | Claude reads the job log and fixes the code |
| no `claude-review` status from this pipeline                         | Claude reviews; fixes blocking findings     |
| approved, CI still running                                           | wait                                        |
| approved, green, behind main                                         | first in the queue: merge main; others wait |
| approved, green, up to date                                          | squash-merge, one PR at a time              |

- **Protected paths** (`protectedPaths` and `protectedNames` in `tools/ci/claude-pr.config.json`):
  `contracts/`, `plan/` (a lane may only modify `plan/STATUS.json`), `.github/`, `tools/plan/`,
  `tools/ci/`, `pnpm-workspace.yaml`, any `CLAUDE.md`, `.claude/`, `.mcp.json`, `.npmrc`,
  `.pnpmfile.*`. Renames count on both sides.
- **Triggers.** PR events go through `claude-pr-trigger.yml`, which only relays them, so
  `claude-pr.yml` always runs as it is on main. Finished CI runs on `lane/` branches, dispatches,
  and a sweep every four hours also re-plan.
- **Reviews run no PR code**, so the code under review cannot forge the verdict. Fix and
  conflict-resolution jobs may run `gates.sh` but never approve: Claude approves only a commit it
  did not write. A separate job, which runs no PR code, writes `claude-review`, and the merge gate
  only accepts this pipeline's status. A merge of main keeps an approval only if the merged head's
  changes equal the approved commit's (checked by patch-id). Nits are comments only.
- **Fix rounds.** After three Claude fix commits (subjects ending `(claude)`), Claude reviews
  without fixing and anything still failing goes to a human.
- **Progress bookkeeping.** Lane PRs do not touch `plan/STATUS.json`, README's progress block or
  `docs/progress.svg`. After each merge the pipeline marks the PR's lanes merged on main and
  regenerates the other two; when an older PR conflicts in those files,
  `tools/ci/claude-pr-bookkeeping.mjs` resolves them without Claude.
- **Pause** with the repository variable `CLAUDE_AUTOMERGE=off`. To take one PR out of automation,
  add `do-not-merge`.
- The scripts and prompts are shared with Centcom-backend, where `docs/ci.md` explains the design;
  `tools/ci/claude-pr.config.json` holds this repo's settings.

**Setup** (once): the official Claude GitHub App on the organisation; the repository secret
`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (organisation secrets do not reach private
repositories on GitHub Free); the labels `claude-automerge`, `claude-needs-human` and
`do-not-merge`. The organisation's Actions minutes are capped (2,000 a month on GitHub Free, $0
budget): each job bills at least a minute and a Claude job up to 25.

**When Claude hands a PR to a human**, it gets `claude-needs-human` and a comment with the reason.
Removing the label re-plans at once, so deal with the reason first: protected paths go to a human
merge; a rejected review needs a pushed fix (a status you post yourself does not count) or a human
merge; a check still failing after three rounds needs a fix or a green re-run; anything else (a
failed Claude step, a fix or conflict it could not do) just needs the cause dealt with.

## Lane loop

One session builds lanes, one at a time: two sessions would pick the same lane. A session builds
one lane (or a few tightly coupled lanes in one PR, titled `C071+C073: …`), waits until the
pipeline merges it, then starts the next, so each lane builds on merged work. A session never
merges and never approves its own PR.

### 1. Pick the next lane

Start with `gh pr list --state all --limit 300 --json number,title,state`, then
`git fetch origin main` (in that order, so a PR that merges in between still shows up in one of
them). A lane is **done** if any of these holds:

- a subject line in `git log origin/main --format=%s` carries its ID;
- a merged PR's title carries its ID;
- its entry in `plan/STATUS.json` on origin/main has `pct` 0.95 or more.

For dependencies only, C001 and C002 also count as done: their scaffold and CI are on main, and
what is left of them is under protected paths, which only a human can finish.

A lane is **eligible** when all of these hold:

- it is not done, and its `pct` is 0 or absent (a partly built lane needs a human to decide how to
  finish it: skip it and list it in the report);
- every lane in its `depends_on` is done;
- no open PR covers it, and it was not closed earlier in this run. An open PR also covers a lane
  that was handed to a human, and so blocks everything that depends on it;
- none of its `deliverables` sit under a protected path, and its `acceptance` and `scope_in` do not
  require a new or changed workflow, CI job, matrix or schedule that a test cannot provide. Leave
  those lanes for a session a human is watching.

Take eligible lanes in the order their IDs first appear in the `next` titles of `plan/STATUS.json`
(a range counts as each ID in it), then by lowest ID. If none is eligible, stop and report.

### 2. Build it

1. `git checkout main && git pull --ff-only`, then branch `lane/c###-short-slug`.
2. Build only the card's `deliverables`, with a test for each `acceptance` item. If a card asks for
   a check "in CI", write it as a test that `pnpm test` runs; never edit `gates.sh` or workflows.
3. Do not edit `plan/STATUS.json`, README's progress block or `docs/progress.svg`: the pipeline
   records the lane on main when it merges.
4. New dependencies: use only what the card needs, with a licence of MIT, Apache-2.0, BSD or ISC.
5. `tools/ci/gates.sh` must pass.

Lane work always goes through a PR. `tools/ci/commit.sh` pushes straight to `main`; it is not for
lanes.

### 3. Open the PR and hand it over

1. Check `git diff --name-only origin/main...HEAD` against the protected paths. If any file
   matches, take that change out of the branch, or leave the lane unlabelled, report it and go to
   step 1.
2. Push, then run `gh pr create` with the title `C###: <lane title>` and a body that covers what
   changed, acceptance criteria and their tests, deviations from the card, and risks (including
   any CI wiring a human should add).
3. Hand over: `gh pr edit <PR> --add-label claude-automerge`, then confirm the label is there
   (`gh pr view <PR> --json labels`). If the label does not exist in the repo, stop and report
   that the pipeline setup is incomplete. From here on the pipeline owns the branch.
   **Never push to it again.**

### 4. Wait, without polling yourself

Run `node tools/ci/claude-pr-wait.mjs <PR>` as a background command; you are woken when it exits.
It checks every 3 minutes and re-dispatches the pipeline when the PR goes quiet. Do not wait with
`/loop` or repeated `gh` calls.

| Exit | Meaning                                                                    | Next                                                    |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| 0    | merged                                                                     | step 1 (it fetches main)                                |
| 2    | handed to a human: `claude-needs-human`, `do-not-merge`, a change request, or the label was removed | note it, then step 1; its dependents are skipped        |
| 3    | closed without merging                                                     | note it; skip the lane and its dependents for this run  |
| 4    | timed out: 90 min with no activity, or 240 min in all                      | see below                                               |
| 5    | the PR never got the `claude-automerge` label                              | add it once if your step 3 add failed; otherwise stop   |
| 1    | `gh` kept failing, or bad arguments                                        | stop                                                    |

On exit 4: if `gh variable get CLAUDE_AUTOMERGE` prints `off`, or the latest
`gh run list --workflow claude-pr.yml` runs are failing or not starting, stop and report. Otherwise
note the PR as stuck and go to step 1; its open PR keeps it and its dependents out of selection.

### 5. Report

When you stop, list each lane with its PR, its outcome, and for handoffs the reason the pipeline
gave (the PR's last comment). List partly built lanes you skipped.

## Rules that always apply

- Never edit a protected path (listed above). The pipeline hands any PR that touches one to a
  human.
- Never merge, never approve, never post commit statuses, and never remove or re-add a pipeline
  label after a human or the pipeline changed it.
- Ask before anything outward-facing beyond the lane PR, such as extra PRs or repo settings.
