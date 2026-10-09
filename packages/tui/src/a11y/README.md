# a11y (lane C049)

Reduced motion, NO_COLOR and a screen-reader mode that does not depend on colour, glyphs or the mascot.

- **`resolveA11yMode`** combines `--screen-reader`, `CENTO_SCREEN_READER=1` and the config key `a11y.screenReader` with `CENTO_REDUCE_MOTION`. Screen-reader mode implies reduced motion, no mascot, no alt screen, no borders and no redraws (`screenReaderTraits`).
- **`MotionProvider` / `useMotion()`** give components one place to read `'full' | 'reduced'`. In reduced motion `crash`, `glitch` and `panic` are never chosen (`allowedAnimation`).
- **`describeState`** gives a full sentence for every one of the 64 state names (`Cento is editing 3 files`, `Waiting for your approval`) and `Cento is working` for anything unknown.
- **`createLinearRenderer`** prints events as plain appended lines:
  - `Assistant: …`, `Tool: Read src/a.ts`, `Result: 120 lines`.
  - `Status: …` for a normal change; `Error: …` for a blocking state or a fatal error.
  - Text is cleaned of every escape and control character first.
  - `ask()` prints `Allow Cento to run: <command> in <dir>? [y/n/a]`, asks again on anything else, has no timeout and no default, and treats ended input as no.
- **Test helpers:** `assertNoColorCodes`, `assertNoEscape`, `assertGlyphAndWord`.

- **`runLinear`** (`run.ts`) runs the whole app in this mode: `centcom --screen-reader`, `CENTO_SCREEN_READER=1` or `a11y.screen_reader` in the config. No alternate screen, no first-run screen, no mascot, no Ink. Each event is a line; notices and toasts print as `Status:` / `Error:`; approvals are asked as `[y/n/a]`; lists are numbered (type the numbers, `all`, or Enter to cancel); `/help` prints the commands as text. A question always gets the next line before the main prompt does. Ending the input or `/quit` leaves.
- **Conformance** (`test/a11y/conformance.test.tsx`): 14 screens (header, status line, permission prompt, prompt, command menu, palette, model picker, toasts, fleet panel, transcript, night panel, list picker, both help pages) are drawn with no colour and may not contain a colour or escape code; statuses must show a word or glyph, not only a colour.
