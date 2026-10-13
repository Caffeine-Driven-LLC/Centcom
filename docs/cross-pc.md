# Working together across computers (branch mode): the design

Status: **built in the terminal app and the desktop app** (the session mode needs a backend that stores it, lane B110; without it the apps say so and share as a command post). Not built yet: board-note sync (waits on the `board.*` contract change), a read-only view of a teammate's transcript, nudges. Each person runs their **own** agents on their **own** computer, on their own copy of the same project, and all of them are in one shared session: everyone sees who is working on what, files an agent has open are marked, a second agent that is about to touch the same file is warned first, notes and decisions reach the other agents, and work can be handed from one person to another.

This is "branch mode" in the contracts (`contracts/04-session-events.md`: `*` means "in branch mode the agent's owner emits events for their own agents"). What exists today is the other mode:

| | Command post (built, `/share`, `centcom join`) | Branch mode (this design) |
| --- | --- | --- |
| Who runs agents | the host, on the host's computer | every member, on their own computer |
| What others do | ask the host's agent (the host approves) and watch it | run their own agent, see each other's, get warned about conflicts |
| Whose approvals | the host approves everything | each owner approves their own agent's tools locally |
| The code | one working tree (the host's) | one working tree per person, joined by git (branches and merges) |
| Context | one agent's context | each agent's own context, plus the shared board |

## What the session carries

Every frame is end-to-end encrypted with the session key. The relay reads only the small cleartext part of a frame (ids, states, lock hashes, counts). Work content (code, file paths, branch names, model names, message text) stays in the encrypted part.

| Event | Who sends it | Cleartext the relay sees | Encrypted |
| --- | --- | --- | --- |
| `agent.spawn` | an agent's owner | `agent_id`, `owner`, `mode: branch`, `runs_on`, `provider` | label, branch, worktree, model |
| `agent.state` | the owner | `agent_id`, `state`, `since` (at most 2 a second per agent) | |
| `agent.exit` | the owner | `agent_id`, outcome | detail |
| `branch.update` | the owner | | agent, branch, head, ahead, behind, dirty |
| `file.lock` | the owner | action, `path_hmac`, `agent_id`, `ttl_ms` | the real path |
| `conflict.detected` | the relay (from lock denials) or a client | `agent_ids`, `path_hmacs` | the paths (when a client sends it) |
| `message.user`, `message.assistant.delta/done` | the owner | | the text (only if the owner shares the agent's activity) |
| `approval.request` / `approval.decision` | the owner, for their own agent | id, risk, expiry, decision | summary, command, cwd |
| `agent.handoff` | the sender, accepted by the receiver | handoff id, agent, `to`, op | note |
| `presence.update` | any member | status, activity, `agent_count` | |
| `board.note` / `board.pin` / `board.remove` | host and editors | note id, type | text, file references (**needs a contract change**, see `docs/context-board-sync.md`) |

## What is shared and what is not

- **By default in branch mode:** that an agent exists and what state it is in (idle, working, waiting for approval, error), which branch it is on and how far it is ahead of or behind the base, and which files it currently has locked (shown to teammates by name, because they hold the session key; the relay only ever sees a keyed hash).
- **Shared with a visible switch, on by default in branch mode, per agent:** the transcript (messages and tool summaries). The person sees "Sharing this agent's activity with the team" and can turn it off at any time; turning it off stops new frames and the Team view shows "Activity not shared".
- **Never shared:** files' contents, diffs, the local board's private entries, environment, secrets, anything the redaction layer removes. A teammate never sees code unless the owner puts it in a message that is shared.
- **Viewers** (watch-only links) see the Team view and the shared transcripts, read-only. They send nothing.

## Who approves what

Each owner approves their own agent's tool use in their own app, with their own permission mode and rules; nothing about a teammate's agent waits for you. The `approval.request` frame is published so others can see "waiting for approval" (and the risk), but only the owner (or, if the owner allows it, the host, via `approver`) answers it. Command-post style approvals (editors ask, the host approves) stay in command-post sessions.

## A session in branch mode

1. **Creating it.** Share has two choices: "Only I run the agent" (command post) and "Everyone runs their own agent" (branch mode). The mode is a property of the session, not of an agent: the relay refuses a spawn whose `mode` differs from the session's, and in a command post only the host may spawn. **This needs the session to store a mode** (see "What the contracts and the backend need").
2. **Joining.** An invited person opens the link in Centcom, which asks "Which folder is your copy of this project?" and which agent to use, opens that project's workspace on their computer, and attaches a branch bridge to the session. Their agent runs locally and keeps working if they leave the session.
3. **Publishing.** The bridge announces each local agent (`agent.spawn`), keeps its state, branch and lock events up to date, and, if sharing is on, streams the transcript. Frames are throttled (`agent.state` at most twice a second) and coalesced (text at most ten frames a second).
4. **Consuming.** The bridge keeps a model of the session (members, their agents, states, branches, locks, last message) from the frames it receives and from the relay's roster, and gives it to the apps: the Team view in the desktop session panel, `/team` in the terminal.

## Locks and conflicts

`packages/agent/src/locks` already holds advisory locks with a keyed hash of the path, a TTL, renewal, a queue while offline, and `onRemoteLock`. Branch mode gives it a transport: the lock client's `publish` sends `file.lock` frames (hash in the clear, path encrypted), and received `file.lock` frames from other members' agents go into `onRemoteLock`. When a local agent is about to edit a file that a remote agent has locked, the lock client reports a conflict **before** the edit is allowed: the owner sees a banner ("Ana's agent has src/db.ts") and the local agent gets one line in its next turn-start digest. The relay also emits `conflict.detected` from lock denials, which the owner of each agent sees. Locks are advisory: they warn, they do not stop. They expire after their TTL (default two minutes, renewed while the agent works) and are released when the agent's turn ends or the agent exits.

`branch.update` adds a "merge soon" hint when an agent has fallen behind the base or two agents' branches have touched the same files.

## Handing work over

`agent.handoff` carries a note and a target member: "hand my branch's work to Bob". The receiver sees the offer in the Team view, accepts, and gets the sender's note plus the branch name (the code itself moves through git: the sender pushes the branch, the receiver pulls it). Declining or ignoring it changes nothing for the sender.

## Context across computers

The board (`docs/context-sharing.md`) stays per computer. Session-scope notes (a decision, a warning, a finding) are published as `board.note`, received into each member's local board with the author named, and delivered to each agent in its turn-start digest like any other note. Viewers read them and cannot add. Automatic notes stay local unless promoted ("Share these 3 notes with the session?"). Received notes are untrusted text: delimited, labelled with their author, stripped of control characters and markup, capped at 280 characters, and never run as a command.

## When things go wrong

| Situation | What happens |
| --- | --- |
| The relay connection drops | the local agent keeps working; lock and state frames queue and are sent after the reconnect (locks expire by TTL meanwhile); the Team view shows "reconnecting" |
| A teammate's computer sleeps | their agents show as offline after the relay says they left; their locks expire by TTL |
| The host leaves | the session pauses after the grace period unless `auto_failover` is on; local agents keep running regardless |
| A key rotates (someone is removed) | the bridge keeps publishing under the new epoch; the removed person's frames stop |
| Someone sends a frame for an agent they do not own | the relay refuses it (`forbidden`); the bridge also ignores frames whose `from` is not the agent's owner |
| A teammate's text contains instructions | it is untrusted text: never executed, always labelled with its author |
| Two people edit the same file | the second owner is warned first; the merge conflict, if any, is still a git merge |
| An agent crashes | `agent.exit` with an error code; locks are released |
| The server is down at start | local agents are unaffected; the session view says offline |

## What the contracts and the backend need

1. **A session mode.** `POST /v1/sessions` and the `Session` object have no `mode`; the relay's `SessionModePort` answers `command_post` for every session ("until sessions store a mode"). Branch mode needs an additive `mode` (`command_post` default, or `branch`) on `SessionCreate` and `Session`, stored by the API and read by the relay. Until then the registry refuses an editor's spawn.
2. **Board events** (`board.note`, `board.pin`, `board.remove`): `docs/context-board-sync.md`.
3. Nothing else: agent, branch, lock, conflict, handoff, approval and presence events already exist and the relay already has modules for them (agents, approvals, branches, locks, conflicts).

## How it is verified

Unit and integration tests with a fake session handle (no network), and a live script with two fresh accounts, two throwaway homes and mock agents against the local backend: both agents appear in each other's Team view with their states; both touch one file and the second owner is warned before the edit; one agent hands a task to the other; a note added on one computer appears in the other agent's digest.

## Using it

- **Desktop:** Share asks "Only I run the agent" or "Everyone runs their own agent". In a branch session the session panel has a Team section (each agent's state, branch, how far from the base, the files it has open, what it last said, conflicts, handoff offers). "Show the team what my agent says and does" is a switch in the Share dialog.
- **Terminal:** `/share branch` starts one, `/share invite <email>` makes an invite, the other person runs `centcom` in their own copy of the project and `/share join <invite or session id>`. `/team` shows everyone's agents, `/share activity [on|off]` the privacy switch, `/share handoff <number> [note]` offers your work to someone.
- **Conflicts:** when a teammate's agent holds a file your agent is changing, you get a notice and your agent is told once, before its next edit (labelled as coming from the session, not from you).
- **Late joiners** read the agents that were there first from what is re-sent to them (state and branch) and from the session's later frames; a second `agent.spawn` for a known agent is refused by the relay, so it is not repeated, which is why a late joiner may see a teammate's agent as plain "Agent" until the owner's next spawn-bearing event.
- **Try it:** with the backend stack up (`pnpm dev:up`, `dev:api`, `dev:relay` in the backend repo), run `python3 tools/dev/pty-collab.py` (two accounts, `/share`, join) as a starting point.
