# Checkpoints and rewind

Before each turn Centcom saves the agent's working folder as a git commit on a private ref, so you can go back to an earlier turn without touching your branches. It works the same for every engine and never uses Claude Code's own rewind.

## How a snapshot is made

Inside the agent's worktree: a **temporary index** (a copy of the real one, so unchanged files are not re-read) gets `git add -A` (which respects `.gitignore`), then `git write-tree` and `git commit-tree` (parent = the previous checkpoint). The commit is saved as `refs/centcom/checkpoints/<agent>@<n>` (which keeps it from being garbage-collected) and as `refs/centcom/checkpoints/<agent>` (the tip). Your HEAD, branches, real index, stash, reflog and `.gitignore` are never touched. All git calls are argument arrays (no shell), with `GIT_TERMINAL_PROMPT=0` and a 30 s timeout.

The label, prompt number and engine session id are written into the commit message, so checkpoints are found again after a restart.

## End markers

When a turn ends, `endTurn()` saves what the agent left (`<agent>@<n>.end`). Anything that differs from that later was changed by someone else, and a rewind **leaves those files alone** unless you confirm them by name. If no marker exists (nothing recorded when the agent stopped), every changed file is treated that way: Centcom asks rather than overwriting.

## Rewinding

`preview(id, mode)` lists what would be restored, deleted (files the agent created since) and skipped. `rewind` first saves a **safety checkpoint** ("before rewind", also at `refs/centcom/rewind-undo/<agent>`), so a rewind can itself be undone by rewinding to that checkpoint. Files are put back with `git checkout-index` from a temporary index (paths are checked, symlinks are not followed); files that were ignored or already there but untracked are never deleted. If a restore fails half way it stops and reports which paths were and were not put back.

Modes: `files`, `conversation`, `both`. Conversation rewind records the rewind in the transcript and then, if the engine reports `resume` **and** the checkpoint stored its session id, resumes from there; otherwise (or if the engine refuses, showing its own message) it starts a fresh session whose first prompt carries a summary of at most 8 KiB.

## Limits and refusals

- 100 checkpoints per agent; the 101st evicts the first and deletes its refs. (Objects stay in the repository until git's own cleanup.)
- A merge, rebase, cherry-pick, revert or bisect in progress: files rewind is refused.
- Not a git working folder, or the worktree is not the repository's top folder: no file snapshot (`commit: null`); `files` fails with `checkpoint_unavailable`; conversation rewind still works.
- Effects outside the folder (shell commands, installs, network, databases) are never undone; the confirmation text says so.
- `purge()` removes every ref of the agent when its session is removed.

## Wiring

`attachCheckpoints(bus, agentId, manager, { label })` makes a checkpoint on `turn.started` and an end marker on `turn.done`. The `/rewind` slash command, the `esc esc` action and the picker belong to the TUI lanes; `apps/cli/src/commands/rewind.ts` has the list, plan text and confirmation they will use.
