# billing and entitlements (lane C064)

What the account's plan allows, fetched, kept and checked. The server decides; this only reads and caches.

- **`GET /v1/workspaces/{id}/entitlements`** with ETag revalidation; the answer is checked against the CT-ENTITLEMENTS schema and cached in memory and on disk, so a restart without a network still knows the last plan.
- **Gates:** small functions that say whether a hosted feature is allowed (relay access, seats, concurrent sessions, parallel agents) from the cached plan, with a clear reason and an upgrade link. LAN and local use never ask: they are free, always.
- **Upgrade and manage links** come from the API (`/v1/billing/...`); the client opens a URL, it never handles payment details.
- If the plan cannot be fetched, the last good answer is used; with none, hosted features read as not allowed and everything local keeps working.
