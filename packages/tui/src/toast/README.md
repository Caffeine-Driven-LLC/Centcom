# toast (lane C044)

Short notices above the prompt.

- **`createToastController`:** one toast at a time, with a FIFO queue behind it.
  - Plain toasts last 4 s. Toasts with actions, and errors, never expire on their own.
  - A more serious toast (error over warning over info or success) replaces the visible one, which goes to the front of the queue and keeps its remaining time.
  - The same `key` within 60 s becomes `(xN)`, not a stack.
  - The queue holds 20. Beyond that the oldest info or success toast is dropped, and warnings and errors are never dropped.
  - `dismiss` calls `onDismissed`, which the app turns into the bus event `toast.dismissed`.
- **`noticeToToast`:** `sys.notice` codes become text from a local table (`messages.ts`), never from server text. Times are shown in local time and every interpolated value is cleaned. An unknown code gives `Notice received.`.
- **`<ToastLine>`:** one row, cut with `…`, never wrapped. The glyph (`✓ ! ✗ i`, ASCII without unicode) carries the level without colour.
- **Keys:** `toast.dismiss` is `esc` in the toast context and `ctrl+y` anywhere (the card says ctrl+x, but that key starts the two-key chords). While an agent is running, `esc` stays the interrupt, so `ctrl+y` is the way to dismiss then.

The app's current toasts (`controller.toast`, `components/Toasts.tsx`) are not moved onto this yet.
