# Building Centcom with Centcom

1. `pnpm install`, then **`pnpm dogfood`** in the repository root. It queues the lanes `CLAUDE.md` says are eligible (if any; `pnpm lanes:next` just prints them) and starts the terminal app on this folder. Pick the agent with `--engine claude-code` or `--engine codex`.
2. The agent already follows the project rules: Claude Code reads `CLAUDE.md`, Codex reads `AGENTS.md` (which points to it). They cover the lane loop, the protected paths, `tools/ci/gates.sh`, the PR label and the "never merge, never approve, never comment on your own PRs" rules.
3. **By day**: work as usual. Ask for a lane, review the diff in the transcript, answer approvals. `ctrl+k` palette, `/fleet start <task>` for parallel agents in their own worktrees.
4. **By night**: `ctrl+n`, paste tasks (one per line), `/night allow push` (work branches and pull requests only: never `main`, never force, never merge, never comment), `/night timeout 120`, Enter on an empty line. In the morning read `~/.centcom/night/night-*.md`. For lane work each task is "build lane C### … open the PR … add the label … stop"; `pnpm lanes:next` prints them in that form.
5. The safety net is the repo's, not the night cycle's: hard blocks (credentials, outside the project, `.git`), the protected-path rule, `gates.sh`, and the PR pipeline reviewing and merging. A night PR still needs the pipeline (or you) to merge it.

## Ready-to-paste tasks (from `plan/STATUS.json` "next")

```
Wire the permission policy, memory files, MCP and hooks into the web/desktop Local agent screen where the terminal app already uses them; one small PR per piece with tests.
Finish the M1 terminal lanes C036 (transcript view), C043 (task list), C045 (keybindings and help) and C048 (onboarding): list what each card still lacks, build the smallest missing piece per lane, test it.
Run the Codex questions in questions.txt sections 12 and 13 that were not tested, using the mock where a real Codex is needed, and fix what differs from the recorded traffic.
```

(Those are partly built lanes, which `CLAUDE.md` says need a human to decide how to finish them: read the task, then queue it knowingly.)

## What is not ready

- No real unattended run against a real Claude Code or Codex yet: do one short night on a throwaway branch first.
- GitHub Actions cannot start jobs at the moment (billing), so the PR pipeline will not merge anything; merge by hand after your own `gates.sh` run.
- The desktop app does not have the night cycle yet; use the terminal app for nights.
