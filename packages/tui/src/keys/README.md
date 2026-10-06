# Keys

Every shortcut is a named **action** (`palette.open`, `tasks.toggle`, `approval.always` ...) in one keymap, so any of them can be changed. Action ids never change once released: they are what people write in their own file.

- **Key strings** (`parseKey`, `formatKey`): modifiers `ctrl+ alt+ shift+ meta+`, names `enter esc tab space backspace delete up down left right home end pageup pagedown f1`..`f12`, single characters, and chords of two steps (`ctrl+x ctrl+s`, 1 s to press the second).
- **Contexts**: `global`, `prompt`, `overlay`, `transcript`, `permission`, `palette`, `toast`. The innermost focused context is asked first, then `global`. One action per key press.
- **Your overrides**: `keybindings.json` in the user config folder (`centcom keys` prints the path):
  ```json
  { "bindings": [{ "key": "ctrl+p", "action": "palette.open", "context": "global" }], "unbind": ["ctrl+k"] }
  ```
  The file is checked entry by entry; anything wrong is skipped with a warning (shown on the help screen and by `centcom keys`), and nothing in it is ever run. Two actions on one key in the same context: the first wins and you are told. `ctrl+c` is reserved for interrupt and quit. `app.quit` and `help.open` always keep a key: unbind the last one and the default comes back.
- **Help**: `?` (when the prompt is empty) or `/help` or `f1`: actions grouped, live keys in bold, type to filter, `esc` closes. Two columns from 100 columns wide, or when one would not fit. `centcom keys` prints the same table; `centcom keys --json` gives `[{ id, group, description, keys, context }]`.
- **Not here**: the prompt's own editing keys (lane C035) and pasted text, which never triggers actions.
