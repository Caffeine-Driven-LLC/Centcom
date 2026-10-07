# diff (lane C037)

File changes as a readable, collapsible unified diff.

- **`parseUnifiedDiff(text)`** reads `git diff` output (and plain unified diffs) into files, hunks and numbered lines: added, deleted, modified, renamed (no hunks when the similarity is 100 %) and binary. It is bounded: 2,000 lines kept per file (the rest counted in `moreLines`) and 200 files (`moreFiles(files)` says how many were left out). A 50,000-line diff parses in well under 300 ms.
- **`diffStrings(old, new, {context})`** compares two texts line by line (common start and end trimmed first, then a longest-common-subsequence), with 3 lines of context around each change.
- **`wordRanges(old, new)`** marks the differing words of a changed line pair. Words split at punctuation, spaces, `_` and camelCase humps, so `retryCount` against `retryLimit` marks only `Count` and `Limit`. Lines over 2,000 characters are not paired.
- **`renderDiffRows`** builds the rows:
  - a file header `path  +12 −3`;
  - 5-column right-aligned line numbers, then `+`, `-` or a space;
  - long lines wrapped with a 7-column indent;
  - a gap of more than 6 unchanged lines folded to `⋯ 42 unchanged lines`, keeping 3 lines of context next to each change; expanding by gap id shows them;
  - `⋯ N more lines` and `⋯ N more files` rows when the caps are hit.
- **No colour needed:** the `+` and `-` prefixes tell added from removed, and a changed word is bold reverse video (`r` on the span).
- **`<DiffView>`** draws the rows. With `focusable`, up and down pick a folded gap and enter opens it.
- **`fromDiffShare`** reads `diff.share` payloads (unknown shapes give what can be read); `fromEdit` makes a diff from an edit's old and new text.

Not done: using this in the approval prompt and transcript (they still use `util/diff.ts`), and the `diff.share` blob fetch (a net lane).
