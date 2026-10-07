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

Not done yet: starting the app in linear mode from `main.tsx` (the renderer is ready, the switch is not wired), `a11y.screenReader` in the config schema, and the 12-component conformance run (it covers the task list and the progress bar so far; the spinner, toast, palette and settings lanes add theirs).
