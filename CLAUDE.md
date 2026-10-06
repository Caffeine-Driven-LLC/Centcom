# Claude Code in Centcom

Start with `plan/START_HERE.md`, `plan/GUIDELINES.md` and the lane card you are building. Lane
cards are `plan/lanes/client/C###.json`. Contracts in `contracts/` win over cards (GUIDELINES
§2.2). Run `tools/ci/gates.sh` before every push: it runs every check CI runs, in the same order.

## Claude PR pipeline

`.github/workflows/claude-pr.yml` reviews, fixes and merges lane PRs labelled `claude-automerge`.
Every trigger re-reads the PR, and `tools/ci/claude-pr-state.mjs` picks one step:

1. **Hand off to a human** if the PR touches `contracts/`, `plan/` (other than
   `plan/STATUS.json`), `.github/`, `tools/plan/`, `tools/ci/` or `pnpm-workspace.yaml`.
2. **Update from main** if the PR conflicts with main; Claude resolves the conflicts.
3. **Fix CI** if the CI check failed; Claude reads the log and fixes the code.
4. **Review** if the head commit has no `claude-review` status. Claude fixes blocking findings,
   and only nits become comments. Claude approves only a commit it did not write.
5. **Merge** once the PR is approved, green and up to date. One PR merges at a time. When several
   are behind main, only the lowest-numbered ready PR updates; the others wait their turn.

After three Claude fix commits, anything still failing goes to a human: the PR gets
`claude-needs-human` and a comment saying why. Remove the label once sorted to put the PR back in.
To pause everything, set the repository variable `CLAUDE_AUTOMERGE` to `off`. PRs without the
label, drafts and stacked PRs (base other than `main`) are left alone. The scripts are shared with
Centcom-backend; `tools/ci/claude-pr.config.json` holds this repo's settings.

## Lane loop

A session builds one lane (or a few tightly coupled lanes in one PR, titled `C071+C073: …`) at a
time. After opening the PR it waits until the pipeline merges it, then starts the next lane, so
each lane builds on merged work. Several sessions may run this loop side by side on different
lanes; the pipeline queues their merges. A session never merges, and never approves its own PR.

### 1. Pick the next lane

A lane is eligible when all of these hold:

- it is not merged yet: no `C###` in the subject lines of `git log origin/main --format=%s`;
- every lane in its `depends_on` is merged (same test);
- no open PR covers it (`gh pr list --state open --json title`). This also skips a lane handed
  to a human, and everything that depends on it, until a human sorts it out;
- none of its `deliverables` sit under the paths in pipeline step 1. Those always need a human,
  so leave them for a session a human is watching.

Take eligible lanes in the order of `plan/STATUS.json` → `next`, then by lowest ID. If none is
eligible, stop and report.

### 2. Build it

1. `git checkout main && git pull --ff-only`, then branch `lane/c###-short-slug`.
2. Build only the card's `deliverables`, with a test for each `acceptance` item.
3. In `plan/STATUS.json`, mark the lane done with a note naming the PR once you know its number.
   Then run `python3 tools/plan/progress.py` (on Windows, set `PYTHONUTF8=1`). `plan/STATUS.json`
   is the only file under `plan/` that a lane changes.
4. New dependencies: use only what the card needs, with a licence of MIT, Apache-2.0, BSD or ISC.
5. `tools/ci/gates.sh` must pass.

Lane work always goes through a PR. `tools/ci/commit.sh` pushes straight to `main`; it is not for
lanes.

### 3. Open the PR and hand it over

1. Push, then run `gh pr create` with the title `C###: <lane title>` and a body that covers what
   changed, acceptance criteria and their tests, deviations from the card, and risks. Do not add
   the label yet.
2. Commit the `plan/STATUS.json` and progress update with the PR number, and push.
3. Hand over: `gh pr edit <PR> --add-label claude-automerge`. From here on the pipeline owns the
   branch. **Never push to it again.** The pipeline pushes fixes and merges of `main` to it.

### 4. Wait, without polling yourself

Run `node tools/ci/claude-pr-wait.mjs <PR>` as a background command; you are woken when it exits.
It checks every 3 minutes. Do not wait with `/loop` or repeated `gh` calls.

| Exit | Meaning                                       | Next                                             |
| ---- | --------------------------------------------- | ------------------------------------------------ |
| 0    | merged                                        | step 1 (it pulls `main`)                         |
| 2    | handed to a human (`claude-needs-human`, etc) | note it, then step 1; its dependents are skipped |
| 3    | closed without merging                        | note it, then step 1                             |
| 4    | timed out: no activity for 60 min             | stop: the pipeline is likely broken or paused    |
| 5    | not opted in: the label is missing            | add the label, then wait again (once); else stop |
| 1    | `gh` kept failing or bad arguments            | stop                                             |

Never remove `claude-needs-human`, push to a handed-off PR, or merge anything yourself. A human
sorts those out.

### 5. Report

When you stop, list each lane with its PR, its outcome, and for handoffs the reason the pipeline
gave (the PR's last comment).

## Rules that always apply

- Never edit `contracts/`, or `plan/` other than `plan/STATUS.json` (GUIDELINES §9).
- Ask before anything outward-facing beyond the lane PR, such as extra PRs or repo settings.
