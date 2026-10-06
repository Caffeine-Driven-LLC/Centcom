# presence client (lane C059)

`new PresenceClient(session, { clock, activity, awayAfterMs? })`: what we tell the session about ourselves, and what we hear. Always best effort: no call returns a promise, nothing in the session waits for presence, and a presence frame is never buffered, sequenced or resent.

- **Sending:** `presence.update { status, activity, agent_count? }` on change and at most once a second (the latest value wins; same value sends nothing). While typing it is refreshed every 3 s, and `idle` follows 5 s after the last keypress. With no input for 5 minutes (`ActivitySource.lastInputAt`) `away` is sent once; the next input sends `online`; a `busy` chosen by the person is never replaced by `away`. `presence.cursor` goes out encrypted only (path, line and column are work content), at most 10 a second, the latest position, nothing for an unchanged one (`setCursor(null)` clears it).
- **Hearing:** `members()` gives each member's status, activity, agent count and cursor. A cursor disappears after 10 s without an update; a new update replaces the old one; a member who left shows `offline`; frames from someone outside the roster and our own are ignored. The post-welcome burst fills the model without us sending anything.
- **Session side:** presence frames are not sequenced, so the session client reads them off the socket directly, verifies and decrypts cursors, and drops anything that does not verify without a word (`session.presenceDropped()` counts them). Encrypted presence frames carry a frame id (the signature covers it); the delivery channel's `sendEphemeral` now takes an `id` for that.

`ActivitySource` is `{ lastInputAt(): number; onInput(fn): () => void }`, for the TUI or web app to provide.
