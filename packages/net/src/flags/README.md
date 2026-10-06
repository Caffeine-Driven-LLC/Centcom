# feature flags (lane C067)

`FlagsClient` reads `GET /v1/flags` in the background and answers `flag(key)` at once from memory.

- **Never waits:** `flag()` returns the registry default if nothing else is known; `start()` returns before any network call finishes, and each refresh is bounded at 2 s.
- **Refresh:** ETag revalidation (a 304 changes nothing), the server's `ttl_s` clamped to 30 s to 3,600 s, a retry a minute after a failure, one request for concurrent refreshes, and a refresh on login, logout and plan changes. `flags-changed` says which keys were added, removed or changed.
- **Cache:** the last answer is kept on disk (`flags.json`) and used for up to 7 days when the network is down.
- **Types:** a flag is a boolean, string or number as declared in the registry; a wrong-typed value is ignored. Unknown keys are kept but `flag()` only takes registered ones (each feature lane adds its own key).
- **Overrides** (`flags.overrides` in config, `CENTCOM_FLAGS=key=value,...`) work only in a development build or with `CENTCOM_DEV=1`; a stable build ignores them and says so once.
- Flags only switch visible features; they never decide anything about security.
