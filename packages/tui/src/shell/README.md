# shell (lane C034) and text helpers

The frame every other lane plugs into, and the text functions they share.

- **`<Shell slots cols rows>`** and **`renderApp`**:
  - **Layout:** header 1 row, scrollback filling the rest, an optional toast row, a prompt of 3 to 12 rows, footer 1 row, a 28-column rail from 100 columns (the scrollback gives up 29 columns) and an overlay above all.
  - **Too small:** below 40 columns or 10 rows only `Terminal too small. Need 80x24.` is shown; a valid size brings the layout back.
  - **Resize:** a burst of resize events gives one relayout (50 ms).
- **`createScreenGuard`** enters the alternate screen and always leaves it again (normal exit, SIGINT, SIGTERM, an uncaught error) with the cursor shown. After a signal it re-sends the signal so the process ends the way it would have. `altScreen: false` (`--no-alt-screen`) turns it off.
- **`createActionRegistry`:** a duplicate id throws `DuplicateActionError`; a key goes to the action whose context matches the top of the focus stack (`FocusStack`, `useFocus`). The key-binding layer in `keys/` (C045) stays the place for remapping and chords.
- **`text/`:** `stringWidth` (graphemes: wide characters 2, combining marks 0), `wrapText`, `truncate` (`hello w…`) and `sanitizeForTerminal` (no escape, C1 or other control characters; tabs become 4 spaces). These are exported from the package as `stringWidth`, `wrapText`, `truncateText` and `sanitizeText` (the transcript's own, stricter `sanitizeForTerminal` keeps its name).

Not done: the app's `App.tsx` still builds its own layout instead of `<Shell>`, `--no-alt-screen` and `tui.altScreen` are not wired into `main.tsx`, and the lint rule that forbids raw `<Text>{props.text}` is not written.
