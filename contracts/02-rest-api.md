# 02 · REST API

Contracts in this file: **CT-API-ACCOUNTS · CT-API-WORKSPACES · CT-API-SESSIONS · CT-API-BILLING · CT-API-USAGE · CT-API-AUDIT · CT-API-NOTIFY · CT-API-WEBHOOKS · CT-API-RELEASES · CT-API-FLAGS**

Machine-readable form: **`openapi.yaml`** (OpenAPI 3.1). This file is the human index; if they disagree the OpenAPI document wins and this file gets fixed in a Contract PR.

Base URL `https://api.centcom.dev` · all paths below are under it · JSON only (`application/json`) except errors (`application/problem+json`) · auth per CT-AUTH · errors per CT-ERR · lists per CT-PAGE · ids per CT-IDS.

Column legend: **Scope** = OAuth scope required (CT-AUTH). **Role** = minimum role (CT-RBAC). **Idem** = `Idempotency-Key` required (R) or accepted (A) on POST. `—` = n/a.

---

## CT-API-ACCOUNTS

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/me` | profile | any | — | Current user, plan summary, active workspace, entitlement revision |
| PATCH | `/v1/me` | profile | any | — | Update display name, locale, avatar slot, telemetry opt-in |
| DELETE | `/v1/me` | profile | any | — | Begin account deletion (30-day grace; `Location` of status) |
| POST | `/v1/me/export` | profile | any | A | Request a data export |
| GET | `/v1/me/export/{id}` | profile | any | — | Export status and signed download URL |
| GET | `/v1/devices` | profile | any | — | List own devices |
| GET | `/v1/devices/{id}` | profile | any | — | One device (name, platform, last seen, key fingerprint) |
| DELETE | `/v1/devices/{id}` | profile | any | — | Revoke a device; kills its tokens |
| GET | `/v1/devices/{id}/keys` | sessions:read | any member who shares a session | — | Public X25519 + Ed25519 keys (CT-CRYPTO) |
| GET | `/v1/api-keys` | workspaces:write | admin/own | — | List API keys (prefix only) |
| POST | `/v1/api-keys` | workspaces:write | admin/member(own) | A | Create key; secret returned once |
| DELETE | `/v1/api-keys/{id}` | workspaces:write | admin/own | — | Revoke key |

## CT-API-WORKSPACES

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/workspaces` | workspaces:read | any | — | Workspaces the caller belongs to |
| POST | `/v1/workspaces` | workspaces:write | any user | A | Create workspace (caller becomes owner) |
| GET | `/v1/workspaces/{id}` | workspaces:read | member+ | — | Workspace detail (ETag) |
| PATCH | `/v1/workspaces/{id}` | workspaces:write | admin+ | — | Rename, settings (If-Match) |
| DELETE | `/v1/workspaces/{id}` | workspaces:write | owner | — | Delete (immediate purge of history, 7-day billing wind-down) |
| GET | `/v1/workspaces/{id}/members` | workspaces:read | member+ | — | Members with roles, presence-agnostic |
| PATCH | `/v1/workspaces/{id}/members/{mem}` | workspaces:write | admin+ | — | Change workspace role |
| DELETE | `/v1/workspaces/{id}/members/{mem}` | workspaces:write | admin+ / self | — | Remove or leave |
| POST | `/v1/workspaces/{id}/transfer-ownership` | workspaces:write | owner | A | Hand ownership to an admin |
| GET | `/v1/workspaces/{id}/invites` | workspaces:read | admin+ | — | Pending invites |
| POST | `/v1/workspaces/{id}/invites` | workspaces:write | admin+ | R | Create invite (email or link); checks seat entitlement |
| DELETE | `/v1/invites/{id}` | workspaces:write | admin+ | — | Revoke invite |
| GET | `/v1/invites/{token}` | none | public | — | Invite preview (workspace name, inviter, role, expiry) |
| POST | `/v1/invites/{token}/accept` | profile | any user | A | Accept; creates membership |
| PUT | `/v1/invites/{id}/key-bundle` | sessions:host | host | — | Upload sealed key bundle (CT-CRYPTO §4) |
| GET | `/v1/invites/{token}/key-bundle` | profile | invitee | — | Fetch the sealed bundle once |
| GET | `/v1/workspaces/{id}/projects` | workspaces:read | member+ | — | Projects (named repo references) |
| POST | `/v1/workspaces/{id}/projects` | workspaces:write | member+ | A | Create project |
| PATCH | `/v1/projects/{id}` | workspaces:write | member+ | — | Update |
| DELETE | `/v1/projects/{id}` | workspaces:write | admin+ | — | Delete |
| GET | `/v1/workspaces/{id}/settings` | workspaces:read | member+ | — | Policies: default auto-approve level, history sharing, retention override |
| PATCH | `/v1/workspaces/{id}/settings` | workspaces:write | admin+ | — | Update policies (If-Match) |

## CT-API-SESSIONS

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/sessions` | sessions:read | member+ | — | List sessions (filters: `workspace`, `state`, `mine`) |
| POST | `/v1/sessions` | sessions:host | member+ | A | Create a command post (checks `relay` entitlement); returns region hint and `host` member |
| GET | `/v1/sessions/{id}` | sessions:read | participant | — | Session detail, state, policy, region |
| PATCH | `/v1/sessions/{id}` | sessions:host | host | — | Rename, policy defaults |
| POST | `/v1/sessions/{id}/end` | sessions:host | host | — | End session |
| POST | `/v1/sessions/{id}/join-token` | sessions:write | participant | — | Mint a single-use relay ticket (CT-AUTH) |
| POST | `/v1/sessions/{id}/claim-host` | sessions:host | workspace admin+ | — | Claim host when the host is gone |
| GET | `/v1/sessions/{id}/members` | sessions:read | participant | — | Members with slot, role, device keys, join order |
| GET | `/v1/sessions/{id}/history` | sessions:read | participant | — | Ciphertext frames after `after_seq` (CT-RESUME), paginated |
| DELETE | `/v1/sessions/{id}/history` | sessions:host | host/owner | — | Purge history |
| GET | `/v1/sessions/{id}/snapshot` | sessions:read | participant | — | Latest snapshot descriptor + pre-signed GET |
| POST | `/v1/sessions/{id}/snapshot` | sessions:host | host | A | Begin snapshot upload (pre-signed PUT) |
| POST | `/v1/sessions/{id}/snapshot/{snp}/commit` | sessions:host | host | A | Commit `{seq, sha256, size, kid}` |
| POST | `/v1/sessions/{id}/share-links` | sessions:host | host | A | Create a viewer-only guest link |
| DELETE | `/v1/sessions/{id}/share-links/{token}` | sessions:host | host | — | Revoke |
| POST | `/v1/share-links/{token}/join` | none | public | — | Join as limited viewer guest (rate-limited) |

## CT-API-BILLING

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/plans` | none | public | — | Public plans and prices (USD/EUR) |
| GET | `/v1/workspaces/{id}/subscription` | billing:read | owner/billing/admin | — | Subscription state (`active|trialing|past_due|canceled`) |
| POST | `/v1/workspaces/{id}/checkout` | billing:write | owner/billing | R | Create a hosted checkout session → `{url}` |
| POST | `/v1/workspaces/{id}/portal` | billing:write | owner/billing | A | Billing portal → `{url}` |
| PATCH | `/v1/workspaces/{id}/seats` | billing:write | owner/billing | A | Change seat count (returns proration preview with `?preview=true`) |
| GET | `/v1/workspaces/{id}/invoices` | billing:read | owner/admin/billing | — | Invoices (paginated) |
| GET | `/v1/workspaces/{id}/entitlements` | workspaces:read | member+ | — | Entitlements for the workspace (CT-ENTITLEMENTS), with `rev` |
| GET | `/v1/workspaces/{id}/usage/summary` | billing:read | member+ | — | Period usage vs limits |
| POST | `/v1/workspaces/{id}/coupons/redeem` | billing:write | owner/billing | A | Redeem a code |

Stripe webhooks are **not** part of this contract (internal).

## CT-API-USAGE

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| POST | `/v1/usage/events` | usage:write | device | R | Batch of usage events `[{id, type, qty, at, session_id?, agent_id?}]` (≤ 500), deduped by `id`. Types: `agent_minutes`, `tokens_in`, `tokens_out`, `queue_items`, `relay_bytes` |

## CT-API-AUDIT

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/workspaces/{id}/audit` | audit:read | admin+ | — | Audit events (filters `actor`, `action`, `from`, `to`) |
| POST | `/v1/workspaces/{id}/audit/exports` | audit:read | admin+ | A | Export (CSV/JSON) |
| GET | `/v1/workspaces/{id}/audit/exports/{exp}` | audit:read | admin+ | — | Export status/download |

## CT-API-NOTIFY

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/notifications` | profile | any | — | In-app inbox (paginated; `unread=true`) |
| POST | `/v1/notifications/{id}/read` | profile | any | — | Mark read |
| POST | `/v1/notifications/read-all` | profile | any | — | Mark all read |
| GET | `/v1/notification-preferences` | profile | any | — | Channels × categories, quiet hours |
| PUT | `/v1/notification-preferences` | profile | any | — | Replace |
| POST | `/v1/push/subscriptions` | profile | any | A | Register web-push / APNs / FCM token |
| DELETE | `/v1/push/subscriptions/{id}` | profile | any | — | Unregister |

Payload shape of notifications: CT-NOTIF-PAYLOAD (in `08-integrations.md`).

## CT-API-WEBHOOKS (management)

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/workspaces/{id}/webhooks` | webhooks:write | admin+ | — | List endpoints |
| POST | `/v1/workspaces/{id}/webhooks` | webhooks:write | admin+ | R | Create (`url`, `events[]`); returns signing secret once |
| GET | `/v1/webhooks/{id}` | webhooks:write | admin+ | — | One endpoint |
| PATCH | `/v1/webhooks/{id}` | webhooks:write | admin+ | — | Update url/events/enabled; rotate secret via `rotate_secret:true` |
| DELETE | `/v1/webhooks/{id}` | webhooks:write | admin+ | — | Delete |
| POST | `/v1/webhooks/{id}/test` | webhooks:write | admin+ | A | Send a test event |
| GET | `/v1/webhooks/{id}/deliveries` | webhooks:write | admin+ | — | Delivery log |
| POST | `/v1/webhooks/{id}/deliveries/{dlv}/redeliver` | webhooks:write | admin+ | A | Redeliver |

Delivery payloads and signing: CT-WEBHOOKS.

## CT-API-RELEASES

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/releases/{channel}/latest` | none | public | — | Latest manifest for `platform` + `arch` (`channel` ∈ `stable|beta|nightly`) |
| GET | `/v1/releases/{channel}/manifest.json` | none | public | — | Full manifest (all platforms) |

Manifest schema: `schemas/release-manifest.schema.json`. Artifacts are signed (Ed25519) and served from a CDN; the API returns URLs only.

## CT-API-FLAGS

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| GET | `/v1/flags` | none or profile | any | — | Flags evaluated for the caller (anonymous allowed). `{flags:{key:value}, rev, ttl_s}` cached by ETag |

## CT-TELEMETRY (ingest; payloads in 08)

| Method | Path | Scope | Role | Idem | Summary |
|---|---|---|---|:-:|---|
| POST | `/v1/telemetry/events` | none or profile | any | A | Batch of opt-in telemetry events (≤ 100); `204` always (even if dropped); `Idempotency-Key` is accepted but never required, since the endpoint never errors visibly |

## Cross-cutting

- Auth endpoints: see CT-AUTH. Status endpoints: CT-STATUS.
- Every state-changing endpoint above writes an audit event server-side.
- Every endpoint documents its error codes in `openapi.yaml` using the registry in `errors.json`.
- Standard response headers: `X-Request-Id`, `RateLimit-*`, `ETag` (mutable resources), `Deprecation`/`Sunset` when applicable, `Idempotency-Replayed` on replays.
