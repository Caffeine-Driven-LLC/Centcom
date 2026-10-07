# spinner (lane C040)

The calm "working" line: `⠹ Tentacle-wrangling…   (12s · ↑ 1.4k tokens · esc to interrupt)`.

- **Glyph:** ten braille frames, one every 80 ms. With `motion='reduced'` it is a static `…`, the verb changes at most every 30 s, and the elapsed time still updates once a second. Without a terminal (`animate=false`) it is one static line.
- **Meta:** elapsed time after 2 s, tokens after 5 s, `esc to interrupt` whenever the work is interruptible. The line is one row: the meta is cut first, then the verb.
- **Verbs** (`createVerbPicker`): the 743 lines of `lines.json` (generated from `assets/The-Lines.txt` by `node tools/spinner/build-lines.mjs`; the runtime never reads `assets/`).
  - The pool follows the agent state (`pools.json`).
  - It is a shuffle bag: nothing repeats until all eligible lines were used.
  - At most 40 characters, or 24 when the width is under 60.
  - After 30 s the `Absurd` pool is used.
  - The next change comes after 3 to 6 s (`nextVerbDelayMs`).
- **Serious states** (approval, auth, expired sessions, limits, errors, crashes, deleting files, reconnecting) get plain words (`Waiting for approval…`, `Reconnecting…`, `Retrying…`, `Working…`), never a joke. `CENTO_SPINNER=plain` always gives `Working…` (pass `plain`).
- `loadingPattern(ms)` gives DESIGN 9.4: nothing under 100 ms, dim until 1 s, spinner, mascot hint from 8 s, long form from 30 s.

The app's present working line (`components/Strip`, `util/verbs.ts`) is not switched over to this yet.
