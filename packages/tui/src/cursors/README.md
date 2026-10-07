# Shared cursors and selections (C077)

Draws teammates' `presence.cursor` positions over the visible file, and publishes your own.

- `RemoteCursors` / `layoutCursors`: other members' cursors on the visible `path` only. Your own cursor is never tagged. Unknown members are ignored until the roster has them.
- Lifecycle: dim from 3.0 s without an update, gone from 10.0 s; offline members and members who left are dropped at once (`cursorsFromPresence`). There is no fade animation, so `CENTO_REDUCE_MOTION` needs no special case.
- Colours: you are violet; others take red, yellow, green, brown in slot order skipping you; a sixth person is violet with an outline marker `[ ]`. The initial and name are always shown, never colour alone. Under 60 columns tags collapse to the initial. Names are cut at 12 cells with an ellipsis.
- Tiers: truecolor selections use the member colour blended at 20 %; 256, 16 and `NO_COLOR` use reverse/dim. With `NO_COLOR` the tag is reverse video plus the name text.
- A cursor above or below the viewport becomes an edge marker (`↑ name` / `↓ name`).
- `useCursorPublisher` / `createCursorPublisher`: at most 10 frames a second, only on change, and the last position always goes out within 100 ms. The path and lines travel only inside the encrypted payload built by the presence client; the clear `p` stays empty.
- Open question (DESIGN.md says a 4x6 pixel arrow): a terminal uses a single cell. A half-block pixel arrow on truecolor with 2 or more free rows is not built.
- Nothing depends on a cursor frame arriving (CT-WS-PRESENCE).
