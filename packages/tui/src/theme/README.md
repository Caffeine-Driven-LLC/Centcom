# theme (lane C032)

Styled terminal output for every colour tier and theme.

- **`createTheme({caps, mode, background, statusColors})`** gives `style(token)` (Ink props), `paint(token, text)` (a string with escape codes), `glyph(name)`, `status(kind, word)`, `setMode()` and `subscribe()`.
- **Tiers:**
  - Truecolor uses the token hex.
  - 256 colours use the pinned indices for the 13 design tokens (`PINNED_256`) and a nearest-colour search for the rest.
  - 16 colours use ANSI slot names (`PINNED_16`).
  - With no colour there are only bold, dim and reverse, and a status is always glyph plus word (`✗ error`).
- **Status colours** use ANSI names on truecolor terminals so they follow the user's own terminal theme (`statusColors: 'hex'` turns that off); the brand violet stays hex.
- **Modes:** `dark`, `light` and `hc` (DESIGN 19.5: black, white, white borders). `auto` follows the detected background and falls back to dark. `setMode` notifies once and the next paint is the new look, with no transition.
- **`memberColor(slot, selfSlot)`:** you are violet; the others take red, yellow, green and brown in slot order, skipping yours; a sixth person is violet and outlined. It depends only on the slots.
- **`<ThemeProvider>`, `useTheme()`, `useToken()`** for components.

**Differences from the card:**
- The pinned grey values follow the shipped graphite palette (for example `text.muted` is 245, not the retired navy palette's 68); the colourful ones match DESIGN.
- The card's `memberColor` examples are not consistent with each other (`memberColor(2,0)` red and `memberColor(0,2)` violet "for self"); this follows the written rule instead: others in slot order skipping yours.

Not done: the app still uses `packages/theme`'s older `createTheme(mode, tier)` and its own colour helpers; switching components to these hooks is an integration step.
