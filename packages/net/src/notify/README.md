# notifications client (lane C066)

- **`NotificationsClient`**: `list({ unread })` (cursor pages of up to 200), `unreadCount()`, `markRead(id)` and `markAllRead()` (the count changes first and is put back, with an `error` event, if the request fails), `on('new' | 'unread' | 'error')`, `start()` / `stop()` / `refresh()`.
- **Polling:** every 60 s, backing off 60 → 120 → 300 s after failures and back to 60 s on success. Nothing is requested while `active()` says false (logged out or offline).
- **OS notices:** for categories whose `os` switch is on (the client-local switch wins over the stored one). Each id shows once; the last 200 ids are kept in `<stateDir>/notifications-seen.json`. After a fresh install only high-priority items show, so old items do not flood the screen. Quiet hours hide them, except `security_alert` and `billing_issue`; a high-priority `approval_needed` gets through only with `allow_approval_needed`. Linux `notify-send`, macOS `osascript`, Windows PowerShell; arguments are arrays (text goes to PowerShell through environment variables), never a shell.
- **Words:** `render(n)` looks up `title_key` / `body_key` in `messages.ts` (`registerMessages` adds `notif.*` keys). `{name}` is filled only with ids, short plain words and numbers; control characters and escape sequences are removed; an unknown key or category gives the generic line.
- **Actions:** `parseAction(n)` accepts only `centcom://session/<ses_id>[?focus=approval|queue]` and never opens anything.
- **Preferences:** `getPreferences` / `setPreferences` (with `If-Match`), `inQuietHours` handles windows across midnight and time zones.
- **Push:** `createPushSubscription` / `deletePushSubscription` are thin calls for the web app.

Contract note: the OpenAPI `Notification` has 14 categories, as the lane card says.
