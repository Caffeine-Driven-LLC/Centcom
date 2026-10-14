# Command post and branch mode

A shared session has one of two modes. The host picks the mode when the session starts, and it cannot change afterwards.

| | Command post | Branch mode |
| --- | --- | --- |
| Start it with | `/share` | `/share branch` |
| Who runs agents | the host, on the host's computer | every member, on their own computer |
| What others do | watch the host's agent and ask it for things; the host decides what runs | run their own agent, see each other's, get warned about conflicts |
| Who approves | the host approves everything | each owner approves their own agent's tools, locally |
| The code | one working tree, the host's | one working tree per person, joined with git |
| Context | one agent's context | each agent keeps its own, plus the shared board |

## Command post

You run the agent as usual and share the conversation on screen with `/share`. Guests join with `centcom join <link>` (or the desktop app's Join) and see what your agent does. Editors can ask for things; each request arrives as a notice that you answer with `/share run <n>` or `/share no <n>`, and `/share auto` runs requests without asking. See [Queue and approvals](./queue-approvals.md).

## Branch mode

Everyone runs their own agent on their own copy of the project, and everyone is in one session. In the terminal:

- `/share branch` starts it, `/share invite <email>` makes an invite link for one person.
- The other person runs `centcom` inside their own copy of the project, then `/share join <invite or session id>`.
- `/team` shows everyone's agents, their state, branch and the files they have open.
- `/share activity [on|off]` is the privacy switch: whether teammates see what your agent says and does (on by default in branch mode). State, branch and file locks are always shared.
- `/share handoff <number> [note]` offers your work to someone. The code itself moves through git: you push the branch, they pull it.
- `/watch` gives a read-only view of a teammate's transcript, as far as they share it.

When one agent is about to change a file that a teammate's agent has locked, you get a notice and your agent is told once, before its next edit. Locks only warn; they do not stop anyone, and they expire after two minutes unless renewed while the agent works. A merge conflict, if there is one, is still a git merge.

Branch mode needs a server that stores the session mode. When the server does not, the app says so and the session works as a command post instead.

More detail, including what happens when a connection drops, is in [Working across computers](./cross-computer.md).
