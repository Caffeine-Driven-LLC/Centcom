# terminal (lane C031)

What the terminal can do, decided once at startup, so every component degrades the same way.

- `detectCapabilities(env, out, inp)` is a pure function:
  - **Colour tier:** `NO_COLOR` set to anything but empty wins over everything, then not a TTY or `TERM=dumb` (none), `COLORTERM=truecolor|24bit`, `TERM` with `256color`, otherwise 16.
  - **Unicode:** a UTF-8 locale in `LC_ALL`, `LC_CTYPE` or `LANG`, and never for `TERM=linux`. Half-block drawing needs unicode and colour.
  - **Opt-outs:** `CENTO_MASCOT=on|off`, `CENTO_REDUCE_MOTION=1`, `CENTO_SPINNER=fun|plain` and `CENTO_THEME=dark|light|auto` are read as typed values. A bad value is ignored and reported in `warnings`, never thrown.
- `queryBackground(io)` asks for the background colour (OSC 11, both 2- and 4-digit channels) and answers `dark`, `light`, or `unknown` after 150 ms. It writes nothing without a TTY, swallows the reply, and puts the terminal back as it found it.
- `layoutClass(cols, rows)` gives `ok`, `narrow`, `short` or `tiny`. `mascotAllowed` needs 80x30 and no `CENTO_MASCOT=off`. `watchSize` gives one callback per burst of resizes (50 ms), and its disposer removes the listener.

Reading the environment and drawing with it (colour mapping, the mascot) are other lanes. Wiring this into the app's start-up is not done yet: `apps/cli` still uses `detectColorTier` from the theme package.
