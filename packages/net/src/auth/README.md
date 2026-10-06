# auth (lane C052)

Signing in to Centcom, and keeping the sign-in alive. Only needed for hosted sessions; local and LAN use never signs in.

- **`startDeviceLogin`:** the device flow (`POST /v1/auth/device/code`, then polling `/v1/auth/token`). It waits the server's `interval`, adds 5 s on `slow_down`, and ends clearly on `access_denied` or `expired_token`.
- **`pkceStart` / `pkceComplete`:** the browser sign-in for the desktop app, with an S256 challenge and a constant-time `state` check.
- **Tokens live only in the OS keychain** (`createKeychainTokenStore`); API keys have their own store. If there is no keychain you get a message that says what to do, never a file with a token in it.
- **`TokenManager`:** gives out the access token, refreshes it a little before it expires, refreshes once for many callers, and takes a cross-process lock (`withRefreshLock`) so two Centcom windows do not refresh together. A refresh that the server rejects for good ends the session and says so (`AuthRequiredError`); a network failure keeps it.
- **`decodeAccessClaims`** reads the non-secret claims of the access token (who, which workspace, expiry) without trusting them.
- **Logs and events** carry no tokens, codes or keys (a test checks the log output).

Built against the mock backend and the HTTP client (C051); no real account is needed.
