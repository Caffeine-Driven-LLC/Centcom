# status (lane C039)

The header and footer lines and the service banner.

- **Header:** `cento · ~/code/app · main` on the left, `● 3 agents · ☻ 2 online · $0.42` on the right, plus a quota chip (`quota 82%` from 80 %, `quota 100%` at the limit, never for an unlimited plan), a role chip (`HOST`, `EDIT`, `VIEW`) and `offline` or `reconnecting`. **Footer:** `⏵⏵ accept edits on · main` and the key hints.
- **`layoutStatus(fields, width, dropOrder)`** fits a line by dropping fields in `STATUS_DROP_ORDER` (hints, cost, online, agents, branch, mode). Quota, role and connectivity are never dropped; a branch name over 24 characters is cut to `agent/feature-r…`. No line is ever wider than the terminal.
- **Warnings are words** (`quota 82%`, `offline`), so they read without colour; the colour only adds emphasis.
- **`ServiceBanner`** shows local wording for a degraded or down relay, only when there is a hosted session, and never text from the server. Local and LAN use are never blocked.
- **`statusText`** is one plain sentence for screen-reader mode.

Not done yet: the app's own header and status line (`components/Header.tsx`, `StatusLine.tsx`) still draw themselves; switching them to these, and reading `status.showCost` from config, is left for the integration.
