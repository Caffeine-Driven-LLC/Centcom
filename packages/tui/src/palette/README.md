# palette (lane C041)

The ctrl+k command palette: fuzzy search over commands, files, sessions and skills.

- **`fuzzyScore(query, text)`** is a subsequence match found by dynamic programming, so the best alignment wins. Word starts, path parts, camelCase humps and consecutive letters score higher. A capital letter in the query makes it case-sensitive. It returns the matched positions for highlighting, or `null`.
- **`createPaletteEngine`** runs every provider for a query:
  - 30 ms debounce;
  - the previous query is aborted by its `AbortSignal`;
  - a slow provider's results are added when they arrive, without moving the selection (`keepSelection` follows the item id);
  - groups come in the fixed order Commands, Files, Sessions, Skills, and empty groups are left out;
  - an empty query shows each provider's `recent()` items, labelled Recent.
- **Providers:** `listProvider` ranks any list the app already has; `createFileIndex` uses `git ls-files` (so ignored files are left out) or a walk that skips `node_modules` and the like, caps at 20,000 files, and scores in slices so input is never blocked for long.
- **`PaletteView` / `CommandPalette`:** the box is 60 columns wide (`cols-4` when narrower), shows at most 8 rows with `▾ N more`, highlights the matched letters, wraps around with the arrows, runs with enter and closes with esc. The no-results text is the DESIGN copy, and there is no mascot.
- **Actions:** `palette.open` (ctrl+k), `palette.close`, `palette.next`, `palette.prev`, `palette.run`.

The app's present palette (`components/Overlays.tsx`) is not switched over yet, and the providers for sessions and skills still have to be wired in with the real lists.
