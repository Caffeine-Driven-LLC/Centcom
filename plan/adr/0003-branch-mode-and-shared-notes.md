# ADR 0003: choose branch mode when a session is created, and shared board notes

Status: proposed (contract PR, needs one approver from each side) · Lanes: B110 (session mode), B111 (board notes in the relay), client follow-up in the apps

## Context
The contract already describes two session modes (`welcome.p.session.mode`, the `*` notes of CT-WS-SESSION-EVENTS): in a **command post** only the host runs agents and emits events; in **branch mode** every member runs their own agents (on their own computer, in their own worktree) and emits the events for them (`agent.spawn` with `owner` and `runs_on`, `agent.state`, `message.*`, `file.lock`, `conflict.detected`, ...). The relay modules (agent registry, branches, conflict signal) already implement the branch-mode rules.

But nothing can create a branch session: `POST /v1/sessions` has no way to ask for one, the API stores no mode, and the relay's mode port answers `command_post` for every session. So the cross-computer case, several people each running their own agents on the same project, cannot work.

Separately, agents on different computers need to share what they learn (decisions, warnings, findings). The context board (docs/context-sharing.md) is local; docs/context-board-sync.md proposed carrying notes through the session. No event kind fits (see that page).

## Decision
1. `POST /v1/sessions` accepts `mode`: `command_post` (default) or `branch`; `Session.mode` returns it; it cannot change after creation. Existing sessions are command posts.
2. Three new additive event kinds: `board.note` (hybrid: `type` and `supersedes` clear, `text` and `refs` encrypted), `board.pin` and `board.remove` (clear). The note id is the `msg_` id of the `board.note` frame, so no new id prefix. Host and editors may add and pin; the host or the note's author may remove; viewers send none of them. Limits: 20 notes per member per hour, 500 live notes per session, text at most 280 characters; over the limit the relay refuses with `frame_rate_exceeded`.

## Alternatives considered
- A new id prefix for notes: touches CT-IDS in both repos for no gain.
- Carrying notes as `message.system` or `comment.add`: wrong semantics (see docs/context-board-sync.md).
- Letting `PATCH /v1/sessions/{id}` switch the mode: rejected, because agents, locks and queue items of one mode would be live in the other.

## Consequences
Additive only: old clients ignore unknown kinds (the relay still sequences them), and a missing `mode` means `command_post`. A command-post session keeps today's rules. A branch session needs members to run their own agent, publish `agent.spawn` for it and respect ownership when displaying `message.*` (the relay cannot read the encrypted `agent_id`, so receiving clients check that a `message.*` frame's sender is the agent's owner).
