# pixel (lane C033)

The mascot in the terminal, on top of the half-block renderer in `@centcom/mascot`.

- **`<Cento animation color size playing loop onDone tier unicode motion />`:**
  - Each frame stays for its own duration (80 to 500 ms; `idle_breathe` is 450 ms).
  - It draws from a frame cache, holds still when `playing={false}` or motion is reduced, and calls `onDone` after the last frame when not looping.
  - `hero` is the full canvas (`idle_breathe`: 8 rows by 14 columns). `mini` is 2 rows by 6 columns, made by boiling the body down.
- **Tiers:** truecolor, 256 colours (no `38;2` sequences) and, below that or without unicode, the text face `asciiCento` (`¡` over `(•_•)`, `(^_^)`, `(•_•?)`, `(x_x)`, `(-_-)zZ`; `(o_o)` when unicode is off).
- **`createFrameCache`** renders each animation once per colour, tier and size; a cached frame costs far under 2 ms.
- **`createAnimationBudget`** lets at most 6 mascots animate; the others hold their first frame until a place frees up, in the order they asked.

Not done: byte-for-byte golden files against `assets/mascot/play.py`, and the app does not use this component yet (it still draws through `PixelView` in `components/ui.tsx`).
