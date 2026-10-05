# 01 · Authentication, authorisation

Contracts in this file: **CT-AUTH · CT-RBAC**

---

## CT-AUTH · Authentication

### Principals
| Principal | Credential | Used by |
|---|---|---|
| User (interactive, terminal) | **Device authorization grant** (RFC 8628) → access + refresh tokens | CLI/TUI |
| User (interactive, browser) | **Authorization code + PKCE** (RFC 7636) → access + refresh | Web app |
| Machine | **API key** `cen_live_…` / `cen_test_…` | CI, automation, webhooks management |
| Relay connection | **Relay ticket** (short-lived JWT, audience `centcom-relay`) | WebSocket hello |

Login *methods* (magic link, GitHub, Google) are the backend's business behind the authorize page. They are **not** part of this contract; the client only sees the grants below.

### Endpoints (all under `/v1/auth`)
| Method + path | Purpose |
|---|---|
| `POST /v1/auth/device/code` | Start device flow. Body `{client_id, scope?, device_name, device_pubkeys:{x25519,ed25519}}` → `{device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}` |
| `POST /v1/auth/token` | Token endpoint. `grant_type` = `urn:ietf:params:oauth:grant-type:device_code` \| `authorization_code` \| `refresh_token`. |
| `GET /v1/auth/authorize` | Browser authorize (PKCE `code_challenge`, `S256` only) |
| `POST /v1/auth/revoke` | Revoke a refresh token or device (RFC 7009) |
| `GET /v1/auth/devices` | List the user's devices |
| `DELETE /v1/auth/devices/{id}` | Revoke a device (kills its tokens, flags its keys) |

Device flow details:
- `client_id` values: `centcom-cli`, `centcom-web`, `centcom-tui` (fixed, public clients).
- `user_code`: 8 chars `[A-Z2-9]` minus ambiguous (`0,O,1,I,L`), displayed as `ABCD-EFGH`. TTL 10 min, poll `interval` 5 s; `slow_down` → +5 s; errors per RFC 8628 (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`).
- The CLI shows `verification_uri_complete` and also tries to open the browser.
- Device registration happens here: the public keys (X25519 for key wrapping, Ed25519 for signing; see CT-CRYPTO) are bound to the new `dev_` ID and the issued tokens.

### Tokens
- **Access token:** JWT (RFC 9068 profile), signed **EdDSA (Ed25519)**, lifetime **15 min**, `kid` header, keys at `/.well-known/jwks.json` (rotated ≥ every 90 days, 2 keys overlap).
- Claims: `iss` `https://api.centcom.dev`, `sub` (`usr_…`), `aud` `centcom-api`, `exp`, `iat`, `jti`, `scp` (space-separated scopes), `dev` (`dev_…`, absent for API keys), `wsp` (active workspace, optional), `plan` (`free|pro|team`), `ent` (entitlement revision integer, so clients know when to refetch CT-ENTITLEMENTS).
- **Refresh token:** opaque 256-bit random, **rotating** with reuse detection: each use returns a new refresh token; reuse of a spent token revokes the whole token family and returns `refresh_reuse_detected`. Lifetime 30 days sliding, 180 days absolute. Bound to a device.
- **Relay ticket:** `POST /v1/sessions/{id}/join-token` → JWT, `aud` `centcom-relay`, **60 s** lifetime, single use (`jti` stored), claims: `sid`, `mid` (member id), `role` (`host|editor|viewer`), `dev`, `caps`. Sent in `sys.hello`, never in a URL.
- Clients store refresh tokens only in the OS keychain (never plaintext config, never logs). Access tokens live in memory.

### Scopes
`profile` · `workspaces:read` · `workspaces:write` · `sessions:read` · `sessions:write` · `sessions:host` · `billing:read` · `billing:write` · `usage:write` · `webhooks:write` · `audit:read` · `admin` (internal only).
CLI default scope: `profile workspaces:read sessions:read sessions:write sessions:host usage:write billing:read`.
API keys carry an explicit subset chosen at creation.

### API keys
- Format: `cen_live_<32 base62>` / `cen_test_<32 base62>`; shown once; server stores `sha256(pepper‖key)` and the first 8 chars as a display prefix.
- Sent as `Authorization: Bearer <key>`. Keys cannot create relay tickets or join sessions (machine principals are not members); they may read/manage workspace resources per scope.

### Request authentication
`Authorization: Bearer <access token or api key>`. On `401` the body is a problem+json with `code` in {`token_expired`, `token_invalid`, `token_revoked`, `device_revoked`}. The client refreshes once on `token_expired`; for the others it must re-authenticate.

### Redirect URIs (exact match, registered)
`centcom://auth/callback` (desktop custom scheme) · `http://127.0.0.1:<port>/callback` and `http://[::1]:<port>/callback` (RFC 8252 loopback, any port) · `https://app.centcom.dev/auth/callback` (web).

### Devices for the web app
The web app is also a *device*. During the PKCE flow it generates an X25519 and an Ed25519 keypair with WebCrypto (non-extractable where the browser supports it, stored in IndexedDB), and passes the public halves and a device name as `device_pubkeys` / `device_name` on `GET /v1/auth/authorize`; the resulting tokens carry a `dev_` id exactly like a CLI device. Browsers that cannot generate Ed25519 keys fall back to read-only participation (viewer) and cannot sign frames.

### Web sessions
The web app uses the PKCE flow and keeps tokens in memory + a `Secure; HttpOnly; SameSite=Lax` refresh cookie scoped to `/v1/auth/token`. CSRF: the token endpoint requires a custom header `X-Centcom-Client: web`.

### Security requirements
- All auth endpoints rate-limited (CT-PAGE) and return uniform error timing.
- `redirect_uri` exact-match against a registered allow-list; custom scheme `centcom://auth/callback` for desktop PKCE.
- No tokens in URLs, ever (except the one-time `code` in the PKCE redirect).

---

## CT-RBAC · Roles and permissions

### Roles
**Workspace roles:** `owner` · `admin` · `member` · `billing` · `guest`
**Session roles:** `host` · `editor` · `viewer`
**Machine:** API key scopes (above).

A workspace member's *default* session role: owner/admin/member → `editor`, guest → `viewer`. The session creator is `host`. Host can be transferred (CT-WS-CONTROL).

### Permission matrix (✓ allowed, — denied)
| Action | owner | admin | member | billing | guest |
|---|:-:|:-:|:-:|:-:|:-:|
| Read workspace, members | ✓ | ✓ | ✓ | ✓ | ✓ (limited) |
| Update workspace settings | ✓ | ✓ | — | — | — |
| Invite / remove members | ✓ | ✓ | — | — | — |
| Change member role | ✓ | ✓ (not owner) | — | — | — |
| Transfer ownership | ✓ | — | — | — | — |
| View billing, invoices | ✓ | ✓ | — | ✓ | — |
| Change plan, payment method, seats | ✓ | — | — | ✓ | — |
| Create/host session | ✓ | ✓ | ✓ | — | — |
| Join session (as editor) | ✓ | ✓ | ✓ | — | — |
| Join session (as viewer) | ✓ | ✓ | ✓ | — | ✓ (if invited) |
| Read audit log | ✓ | ✓ | — | — | — |
| Manage webhooks, API keys | ✓ | ✓ | own keys only | — | — |
| Delete workspace | ✓ | — | — | — | — |

| Session action | host | editor | viewer |
|---|:-:|:-:|:-:|
| Send frames of type `message.user`, submit queue item | ✓ | ✓ | — |
| Approve / reject / reorder / drop queue items | ✓ | — | — |
| Approve tool calls | ✓ (and delegated approvers) | — | — |
| Run agents (host's runner) | ✓ | — | — |
| Spawn own branch agent (branch mode) | ✓ | ✓ | — |
| Presence, cursors, reactions, comments | ✓ | ✓ | ✓ (reactions, comments only) |
| Kick, mute, change roles, end session, transfer host | ✓ | — | — |
| Read history | ✓ | ✓ | ✓ |

### Enforcement rules
1. **The server is the only authority.** Every REST and WS action is authorised server-side from the token and current membership state, never from client-sent role claims.
2. Role changes take effect on the **next frame** (relay re-checks membership state on every privileged frame, with a ≤ 2 s cache).
3. The relay ticket's `role` is a hint for fast-path; the live membership record wins.
4. Client UIs mirror this matrix only to hide/disable controls. A client that attempts a denied action gets `403 forbidden` (REST) or `sys.error` code `forbidden` (WS).
5. Plan limits (seats, relay access) are enforced through entitlements (CT-ENTITLEMENTS), not roles.
6. Every denied privileged action writes an audit event.
