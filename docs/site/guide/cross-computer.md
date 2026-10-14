# Working across computers

Branch mode lets several people work on one project at the same time, each with their own agent on their own computer. Nobody remote-controls anybody else's machine.

## What is shared

- **By default:** that an agent exists, its state (idle, working, waiting for approval, error), its branch and how far it is ahead of or behind the base, and the files it currently has open. Teammates see file names, because they hold the session key; the relay sees only a keyed hash of each path.
- **With a switch you control, per agent:** the transcript (messages and tool summaries). The Share dialog says "Sharing this agent's activity with the team", and turning it off stops new frames at once.
- **Never shared:** file contents, diffs, private notes on your context board, your environment and secrets, anything the redaction layer removes. A teammate never sees your code unless you put it in a message that is shared.
- **Viewers** (watch-only links) see the team view and the shared transcripts, read-only.

## Who approves what

Each owner approves their own agent's tools, in their own app, with their own permission mode. Nothing about a teammate's agent waits for you. Others only see that an agent is "waiting for approval" and how risky the request is.

## Notes between agents

The context board is per computer. Notes you promote to the session (a decision, a warning, a finding) reach every member's board with the author named, and each agent receives them with its next message. Notes from other people are untrusted text: labelled with their author, stripped of markup, capped at 280 characters and never run as a command.

## When things go wrong

| Situation | What happens |
| --- | --- |
| Your connection drops | your agent keeps working; state and lock updates queue and go out when the connection is back; the team view shows "reconnecting" |
| A teammate's computer sleeps | their agents show as offline; their locks expire |
| The host leaves | the session pauses after a grace period unless automatic failover is on; local agents keep running |
| Someone is removed from the session | the key rotates and their frames stop being readable |
| Someone sends a frame for an agent they do not own | the relay refuses it, and clients ignore it too |
| Two people edit the same file | the second owner is warned first |
| The server is down at the start | local agents are unaffected; the session view says offline |

## Not built yet

Nudges (asking a teammate's agent to look at something) are not built. A late joiner may see a teammate's agent as plain "Agent" until the owner's next update.

What each frame carries in the clear and what stays encrypted is in [Privacy and encryption](./privacy.md).
