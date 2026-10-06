# permission (lane C038)

One permission question, whatever the engine.

- **`ApprovalView`** is what the prompt shows, built by `approvalFromEvent` (the normalised `approval.requested` of Claude Code or Codex) or `approvalFromWire` (a shared session's `approval.request`). The prompt never talks to an engine; its answer is an `ApprovalDecisionInput` handed to whoever owns the permission engine.
- **`createPromptMachine`** holds the key rules, with time injected:
  - `y` is once, `s` this session, `a` always, `n` or `esc` deny; keys for scopes that are not allowed do nothing.
  - `e` edits only when the request is editable.
  - Keys within 300 ms of the prompt appearing are ignored.
  - A high-risk or destructive request needs `y` and then Enter within 5 s (`Type y then Enter to confirm.`).
  - At the expiry time it denies once with reason `expired`.
  - Someone who may not decide gets no keys.
- **`<PermissionPrompt>`** draws it: title, the command (6 lines, then `⋯ +N lines (v to view all)`), `in <dir> (<branch>)`, `engine · provider · runs on …`, risk in words, `expires in 4:32`, and the key row. The box is `min(cols-2, 78)` wide, with a heavy `┏━┓` border for destructive requests so it shows without colour.
- **What will run is what you see:** `visibleText` turns bidirectional controls, zero-width characters and escape sequences into `‮`, `​`, `\x1b`.

Not done: replacing the app's `components/Approval.tsx` with this, the queue badge (`1 of 3`) host component, the view-all (`v`) screen, and the optional bell.
