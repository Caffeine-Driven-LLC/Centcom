# Worktrees (branch mode)

In branch mode every agent works in its own git worktree on its own branch, so it never touches your main checkout. `createWorktreeManager` (in `@centcom/agent`) creates, tracks, inspects and cleans them up.

## What it does

- **create**: `git worktree add -b centcom/<owner>/<label> -- <path> <base>` under `<repo>/.centcom/worktrees/` (or `worktree.root`). Names are cut down to `a-z 0-9 -`; if the branch exists it tries `-2`, `-3`, up to 20. The root is added to `.git/info/exclude`, so nothing shows up in `git status`.
- **status**: `{ branch, head, ahead, behind, dirty }`, relative to the base you gave at creation (the same fields as the `branch.update` event).
- **remove**: refuses a worktree with uncommitted changes or commits that are not merged, unless `force`. It only ever removes worktrees it created and recorded.
- **list / prune**: reconciles the registry (`.centcom/worktrees.json`) with `git worktree list`. A folder deleted by hand shows as `missing`; `prune` cleans it up. A worktree under the root that Centcom did not create is shown as `orphan` and left alone.
- **detectConflict**: `git merge-tree --write-tree`, so it names the files that would conflict without touching any working tree.

## Safety

- git is always called with an argument list, never a shell; refs and paths come after `--`, and anything that looks like an option is refused first. A repository path full of `$()` and `;` is handled as plain text.
- Every call has a timeout (10 s reads, 30 s add/remove/merge-tree) and a 4 MiB output cap, runs with `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` and `LC_ALL=C`, and retries three times if another git holds an index lock.
- The worktree root must resolve (after symlinks) to inside the repository's parent folder and not be a system directory.
- If creating fails halfway (for example the disk is full) the folder and branch are removed again and the registry is unchanged.
- Logs carry agent ids only, never paths or branch names (those are secret on the wire).

## Needs

git 2.38 or newer (`merge-tree --write-tree`). A bare repository or an older git gives a clear message and branch mode stays off; agents can still work in the plain folder.

## Not done here

Merging, pushing and pull requests, file locks (C018), and the sub-agent isolation policy (C024).
