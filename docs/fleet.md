# Fleet: several agents at once

A fleet runs several agents side by side. Each agent is its own engine process (Claude Code or Codex) in **its own git worktree on its own branch**, so they cannot overwrite each other's files. Centcom never merges, pushes or deletes a branch by itself.

## Starting agents

`centcom fleet start --count 3 --engine claude --prompt "..."` makes three agents. Each gets a worktree and a branch named `centcom/<owner>/<label>-<six characters>` (letters, digits and `-` only; two agents with the same label still get different branches). The label defaults to `agent-<n>`.

## How many run at once

The smaller of your plan's limit (`max_parallel_agents`) and `fleet.max_parallel` (default 8). The rest wait in a queue of at most 32; a 33rd waiting spawn is refused. Slots go to the owner with the fewest running agents (ties to whoever waited longest), and while other owners are waiting nobody takes more than their share, `ceil(limit / owners waiting)`. An owner who is the only one asking can use every slot, and nobody is taken off a slot they already have.

New agents of one engine start at least `fleet.stagger_ms` (default 1.5 s) apart, because many parallel agents hit the tools' plan limits fast. When a Claude or Codex agent reports a usage or rate limit, new spawns for **that engine** are paused (running agents are left alone) with the tool's own message, until it is resumed (`resume(engine)`) or the time the tool named has passed. Other engines are not affected.

## States

`queued`, `starting`, `running`, `waiting`, `done`, `failed`, `canceled`. `stop` asks the engine to stop its turn and end; one that ignores that is terminated after 5 seconds and killed after 7. `stopAll` finishes within 8 seconds. An agent that runs longer than `fleet.max_minutes` (default 60, 0 = no limit) is stopped with the reason `fleet_timeout`.

## When an agent ends

- **No changes**: the worktree and branch are removed.
- **Commits and a clean tree**: marked **branch ready**; `onBranchReady` fires once with the branch, how many commits ahead and which files. `mergePreview` lists files that would conflict with the base. Nothing is merged.
- **Anything uncommitted** (or a failure while checking): marked **needs attention** and kept. A worktree with unsaved or unmerged work is never removed automatically; `remove` refuses it unless you force it.

After a crash, `recoverOrphans` lists worktrees from the earlier run. It removes nothing.

## Native subagents

Subagents an engine starts itself (Claude's `Task` tool, for example) show up as child nodes under their agent. They share the parent's worktree, do not use a slot, and the parent shows the `sub-agent` state while one runs. They are not announced as separate agents to teammates.

## What teammates see

`agent.spawn` (id, owner, mode, whose machine runs it, provider) and `agent.exit` (outcome, error code) have clear parts with no label, branch, path or model: those travel only in the encrypted part. Each agent runs on its owner's engine login.

## Not here

Agents on other people's machines (the session layer), the "who pays" banners (C105), merging, and the real wiring of `centcom fleet` to the engine registry in the app.
