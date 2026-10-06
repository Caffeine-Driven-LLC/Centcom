# prompt (lane C035)

The logic behind the message box, with no drawing in it.

- **`TextBuffer`:** the text and cursor, edited by whole characters as a person sees them (`Intl.Segmenter`), so a family emoji deletes as one unit. It does word moves (`alt+b/f`), `ctrl+w`, `ctrl+u`, line start and end, wrapping by columns (wide characters count 2) and the cursor's row and column.
- **`checkSubmit`:** an empty or blank message is not sent, and one over 65,536 characters is refused with `Message is too long (max 65,536 characters).` A trailing `\` followed by enter is a newline (`continuesLine`) for terminals that cannot report shift+enter.
- **`PasteStore`:** pastes over 10 lines or 2,000 characters become a chip like `[Pasted text #1 +49 lines]`, which `expand` puts back when the message is sent. At most 256 KiB is kept, with a warning.
- **`createHistoryStore`:** `<data>/history.jsonl`, mode 0600, at most 1,000 lines, a repeat of the last message is not added, nothing over 8 KiB is stored, only this project's messages are offered, damaged lines are skipped. `walker()` is up and down; `search()` is ctrl+r, newest first.
- **`createSlashRegistry`:** other lanes register their commands; `list('/mo')` ranks prefix matches first and hides hidden or unavailable ones; `run` reports an unknown command or a failing one as text. `registerBuiltins` adds `/clear` and `/exit`.

Not done: the bordered `<PromptInput>` that uses these (the app's current `components/Prompt.tsx` still has its own editor), the inline suggestion list drawing, and the ctrl+r search line.
