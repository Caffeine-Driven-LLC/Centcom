# Shared notes between people: built in branch mode (contract events `board.note`, `board.pin`, `board.remove`)

Status: built in the terminal app (`/note`, `/board`) and the desktop app (the Shared notes panel). A note a host or editor adds goes to everyone's board with the author's name and role; pinned notes are always in each agent's digest; a viewer reads and cannot add. A person who joins later reads the notes from the history, and the sender also sends its live notes (newest ten) once more a few seconds after somebody joins; a receiver that already has a note (same author, kind and text) keeps one copy. Checked live with `python3 tools/dev/pty-board.py`. The text below is the original proposal.

The board (docs/context-sharing.md, phase 1) lives on one computer. This page is the concrete proposal for phase 3, **session scope**: notes travelling between the people of a shared session. It is a proposal because `contracts/04-session-events.md` has no event kind for it, and contracts are changed by a human merge, not by a client PR. Until then the board stays local and the Shared notes panel says nothing about other people.

## Why no existing kind will do

- `message.system` (host and editors, encrypted) would put every note in every transcript as a system message and cannot carry pin, remove or an author's role.
- `comment.add` (anyone, encrypted) is a comment on a message (`target`, `text`), not a board entry, and viewers may send it.
- `file.lock` is clear-routed for locks only.

## The proposed rows

| kind           | class   | routing | who may send               | fields (clear)                                                        | secret                                   |
| -------------- | ------- | ------- | -------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| `board.note`   | `event` | hybrid  | host, editor               | `type` (`decision`, `warning`, `finding`), `supersedes`? | `text` (at most 280 characters), `refs`? |
| `board.pin`    | `event` | clear   | host, editor               | `target`, `pinned`                                                    | none                                     |
| `board.remove` | `event` | clear   | host, or the note's author | `target`                                                              | none                                     |

The text and the file references are encrypted like every other work content (the backend never sees them). A note's id is the `msg_` id of its `board.note` frame; `board.pin` and `board.remove` name it in `target` (not `note`: the relay's privacy stage strips a clear `note` from every kind). Late joiners read the notes from history or from the snapshot, like the transcript.

## Who may do what

| Role                          | See notes | Add a note | Pin                   | Remove |
| ----------------------------- | --------- | ---------- | --------------------- | ------ |
| host                          | yes       | yes        | yes                   | any    |
| editor                        | yes       | yes        | yes (own and others') | own    |
| viewer (invite or watch link) | yes       | no         | no                    | no     |

A viewer cannot send signed encrypted frames at all (contract 05, section 4a), so the table follows from the transport as well.

## How the client would use it

- The desktop service keeps the local board as the source for the host's own agents. A note added by the host or an editor (`/note`, the Shared notes box) is also sent as `board.note` when the session is shared; a received `board.note` is added to the receiver's board with the author's name and role shown, and enters the digest each agent gets with its next message (already built for local notes).
- Automatic notes (claims, failing tests, decisions) stay local to each machine's agents unless promoted: the share prompt of docs/context-sharing.md ("Share these 3 notes with the session?").
- Pin and remove travel as `board.pin` and `board.remove`; a receiver ignores one from a member whose role does not allow it (and shows nothing for a note it never received).
- Guests joining with a watch link get the host's notes through history; the panel shows them read-only.

## Safety

A received note is untrusted text, exactly as in docs/context-sharing.md (Safety): it is delimited and labelled with its author when it reaches an agent, stripped of control characters and markup, capped at 280 characters, and never runs anything. A guest terminal prints it through the same filter as every other host text (`clean` in `centcom join`).

## What the contract change needs

1. The three rows above in contracts/04, with `board.*` added to the routing table and the schema files.
2. The relay passes the clear fields and the ciphertext untouched (it already forwards unknown clear-routed events by class; the hybrid one needs the same size limits as `message.system`).
3. A lane card for the backend (relay allow-list) and one for the client (the service wiring above).

I did not edit `contracts/` or `plan/`: this page is the input for that decision.
