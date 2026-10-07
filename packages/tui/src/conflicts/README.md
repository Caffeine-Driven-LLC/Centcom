# Conflict handling UX (C078)

Shows who holds a file, for how long, who waits, and what to do about a merge conflict. Locks are advisory: nothing here stops anyone from editing.

- `ConflictStore` folds `file.lock` and `conflict.detected` frames (plus `agent.state` / `agent.exit`, which end a conflict). Each path keeps its events ordered by `seq`, so late and duplicate frames are harmless. A path text is only ever the decrypted `ct.path` of a frame; otherwise the label is `file ab12…`.
- `useConflicts(store)`, `LockChip`, `LockInspector`, `ConflictBanner` (keys `w t b r`; Resolve asks in plain text), `ConflictStack` (two banners, then `+N more`), `cardState` (the card state and animation for an agent).
- `useNow()` returns the time once a second; pass it as `now` so the countdowns move. Without it the components show the countdown for the `now` they were given.
- All text is in `messages.ts`.
