# Memory files

Claude Code reads `CLAUDE.md` and Codex reads `AGENTS.md`. Centcom has no memory of its own: it only helps you edit those two files safely and, if you want, keep them in step. It never loads memory into the model; the tools do that themselves.

## Quick add

In the app, a line that starts with `# ` (hash and a space) is a note, not a prompt:

```
# Use pnpm, not npm
```

It is added as one bullet under `## Notes (added with Centcom)` (the heading is created if needed) in the active tool's file. You see the diff first, and type `y` to confirm. `#hashtag` with no space is an ordinary prompt. From the shell:

```
centcom memory add "Use pnpm, not npm" [--to claude|codex|both] [--scope project|user] [--yes]
centcom memory show [claude|codex]      centcom memory edit [claude|codex]
centcom memory status                   centcom memory sync [push | pull --from claude|codex]
```

## Safety

- **Nothing is written without a diff and a yes.** The confirmation is bound to the exact plan and to the file as it was: if the file changed in the meantime you get a `Conflict` with the new text and nothing is written.
- Writes are atomic (temp file, then rename); an existing file keeps its permissions, a new one is 0644. Line endings (CRLF or LF) and everything you did not touch stay byte for byte.
- Text that looks like a password, a key or a private key block is refused (and never echoed back). Files are limited to 256 KiB, a quick note to 2 KiB.
- Project files must be inside the project folder; the user-level files come from the tools' own paths and nothing else in `~/.claude` or `~/.codex` is read.
- Memory text is never logged or sent anywhere; logs say how many files and what kind of change.
- A file that is not UTF-8 text is shown as unreadable and left alone.

## Keeping both files in step (optional)

Off by default. Turn it on per project with `{"memory":{"sync":true}}` in `.centcom/config.json`, and put the shared text in `.centcom/memory.md`. `centcom memory sync push` writes it into a section of both files:

```
<!-- centcom:memory:begin sha256=... -->
...shared text...
<!-- centcom:memory:end -->
```

Only that section is ever rewritten; everything you wrote around it is left alone, and running it again changes nothing. `centcom memory status` tells you what drifted: `source_changed`, `target_edited` (someone edited inside the section) or `conflict` (both). In a conflict an ordinary edit of that file is refused until you choose a direction: `sync push` (overwrite from the source) or `sync pull --from claude` (take the file's section into the source), each with a diff and a confirmation.

If only one of the two files exists, `status` mentions it and `importHint` / `planImport` can offer a pointer or a copy for the other; nothing is created unasked.

## Known gap

Where Codex looks for a user-level `AGENTS.md` (`~/.codex/AGENTS.md` is assumed) has to be confirmed against the installed version.
