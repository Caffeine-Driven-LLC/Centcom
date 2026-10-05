# 07 · Entitlements and quotas

Contract in this file: **CT-ENTITLEMENTS** (REST endpoints for billing are in `02-rest-api.md`, CT-API-BILLING)

The backend owns money and plans. Everything the product gates is expressed as **entitlements**: a flat, versioned map of limits and booleans per workspace. Clients and the relay read entitlements; they never read Stripe state, plan names, or prices to decide what is allowed.

Schema: `schemas/entitlements.schema.json` · fixtures: `fixtures/entitlements/*.json`.

## 1. Object

```json
{
  "workspace": "wsp_…",
  "rev": 42,
  "plan": "pro",
  "status": "active",
  "period": { "start": "2026-10-01T00:00:00.000Z", "end": "2026-11-01T00:00:00.000Z" },
  "limits": {
    "relay_access": true,
    "lan_multiplayer": true,
    "max_seats": 5,
    "max_session_members": 8,
    "max_concurrent_sessions": 3,
    "max_parallel_agents": 8,
    "history_days": 7,
    "agent_minutes_month": 6000,
    "tokens_month": null,
    "queue_items_month": null,
    "audit_log_days": 0,
    "webhooks_max": 2,
    "api_keys_max": 5
  },
  "usage": { "agent_minutes_month": 1830, "tokens_month": 4120000, "queue_items_month": 212, "seats": 3 },
  "warnings": [ { "limit": "agent_minutes_month", "pct": 80 } ],
  "grace_until": null
}
```

- `rev` increments on every change; it is also the `ent` claim in access tokens (CT-AUTH) so clients know when to refetch.
- `null` limit = unlimited. `0` for a count = none.
- `usage` is best-effort (eventually consistent, ≤ 60 s behind). The server is authoritative at enforcement time.
- `status`: `active | trialing | past_due | canceled | none`. See §4.

**Seats:** only memberships with workspace role `owner`, `admin` or `member` consume a seat. `guest` and `billing` do not.

## 2. Keys (the contract; values are product decisions)

| Key | Type | Meaning | Enforced by |
|---|---|---|---|
| `relay_access` | bool | May create/join hosted sessions via the relay | API (`POST /v1/sessions`, join-token), relay |
| `lan_multiplayer` | bool | LAN sessions. **Always true**; clients never ask the backend | client only |
| `max_seats` | int\|null | Workspace member seats | API (invites, accept) |
| `max_session_members` | int | Simultaneous members per session | relay |
| `max_concurrent_sessions` | int | Live hosted sessions per workspace | API |
| `max_parallel_agents` | int | Agents running at once per session (advertised; host client enforces, relay checks `agent.spawn`) | host client + relay |
| `history_days` | int | Durable history retention | retention job |
| `agent_minutes_month` | int\|null | Metered agent time | usage pipeline |
| `tokens_month` | int\|null | Metered tokens (reported by clients) | usage pipeline |
| `queue_items_month` | int\|null | Queue submissions | relay |
| `audit_log_days` | int | Audit retention; 0 = feature off | API |
| `webhooks_max` | int | Webhook endpoints | API |
| `api_keys_max` | int | API keys | API |

New keys are *additive* (minor). Clients treat an unknown key as "unrestricted unless documented" **only for display**; they never use unknown keys to unlock features.

## 3. Default plans (reference values)

| Key | free | pro | team |
|---|---|---|---|
| `relay_access` | false | true | true |
| `max_seats` | 1 | 1 | 5 (+ add-on seats) |
| `max_session_members` | 8 (LAN) | 4 | 12 |
| `max_concurrent_sessions` | 0 | 2 | 10 |
| `max_parallel_agents` | 4 | 8 | 16 |
| `history_days` | 0 | 7 | 30 |
| `agent_minutes_month` | 0 hosted | 6 000 | 30 000 (pooled) |
| `audit_log_days` | 0 | 0 | 90 |
| `webhooks_max` | 0 | 2 | 20 |
| `api_keys_max` | 1 | 5 | 50 |

These are defaults in the seed data; product can change them without a contract change (only keys and semantics are the contract).

**Retention override:** a workspace policy (`history_retention_days`) may only *shorten* retention below `history_days`, never extend it.

## 4. Status behaviour

| `status` | Behaviour |
|---|---|
| `active` | Full entitlements |
| `trialing` | Same as the trial plan; trial end shown via `period.end` |
| `past_due` | **Grace**: entitlements unchanged for 7 days (`grace_until`); banners in clients; after grace → treated as `none` |
| `canceled` | Entitlements remain until `period.end`, then `none` |
| `none` | Free defaults. Live hosted sessions get `sys.notice plan_changed` and end after 10 min |

## 5. Quota behaviour

- At **80 %** of a metered limit the server adds a `warnings[]` entry, sends `sys.notice usage_warning {pct:80}` to live sessions and a notification (CT-NOTIF-PAYLOAD) to owners.
- At **100 %**: `sys.notice quota_reached`; the relay **pauses new queue approvals and new agents on hosted sessions** (running work finishes), REST creates return `quota_exceeded` (429, `retry_after_s` to period end). **LAN and local use are never blocked.**
- Metered usage is reported by clients via `POST /v1/usage/events` and deduped by event id (CT-API-USAGE); the relay also records relay-side counters (`relay_bytes`, `queue_items`).

## 6. Cache and freshness rules

- Clients cache entitlements for **5 minutes** and refetch when the access token's `ent` claim changes, on `sys.notice plan_changed`, and on relevant `403/429 entitlement_*` errors.
- The relay/API cache entitlements ≤ 30 s and invalidate on change via pub/sub.
- Offline clients keep using the last known entitlements for up to 24 h for **display**; hosted actions are still checked server-side.

## 7. Downgrade rules

On downgrade: no data is deleted immediately; live sessions over the new limits are asked to reduce (members first removed in reverse join order after a warning), history older than the new `history_days` is purged by the nightly retention job after 7 days' notice.
