# 08 · Webhooks, notifications, telemetry, deep links

Contracts in this file: **CT-WEBHOOKS · CT-NOTIF-PAYLOAD · CT-TELEMETRY · CT-DEEPLINK**

---

## CT-WEBHOOKS · Outgoing webhook payloads

Management endpoints: CT-API-WEBHOOKS. Schema: `schemas/webhook.schema.json`.

### Delivery
`POST <endpoint url>` · `Content-Type: application/json` · timeout 10 s · HTTPS only (except `localhost` in test mode) · no redirects followed.

```json
{
  "id": "dlv_…", "type": "member.joined", "created_at": "2026-10-05T18:07:41.123Z",
  "workspace": "wsp_…", "api_version": "2026-10-01",
  "data": { }
}
```
Headers: `Centcom-Event-Id` (equals the body `id`; the same delivery keeps its id across retries), `Centcom-Event-Type`, `Centcom-Delivery-Attempt`, `Centcom-Signature: t=<unix>,v1=<hex hmac-sha256>`.

### Signing
`v1 = HMAC_SHA256(secret, t + "." + raw_body)`. Receivers reject if `|now − t| > 300 s`. Secrets are per endpoint, shown once, rotatable with a 24 h overlap (both `v1` signatures sent during overlap).

### Retries
Any non-2xx or timeout → retry with exponential backoff: 1 m, 5 m, 30 m, 2 h, 6 h, 12 h, 24 h (7 attempts, ~45 h). After the last failure the endpoint is marked `failing`; after 3 consecutive days of failure it is disabled and owners are notified. The test endpoint sends a `webhook.test` event. Deliveries may arrive **out of order and more than once**; receivers dedupe on `id`.

### Event types (v1)
| Type | `data` |
|---|---|
| `workspace.member.joined` / `.left` / `.role_changed` | `{member, user, role}` |
| `workspace.invite.created` / `.accepted` / `.revoked` | `{invite, email?, role}` |
| `session.created` / `.started` / `.ended` | `{session, host, name, state}` |
| `session.member.joined` / `.left` | `{session, member}` |
| `agent.completed` | `{session, agent, outcome, minutes}` (no content) |
| `billing.subscription.updated` | `{plan, status, seats}` |
| `billing.invoice.paid` / `.payment_failed` | `{invoice, amount, currency}` |
| `usage.threshold` | `{limit, pct}` |
| `api_key.created` / `.revoked` | `{key, scopes}` |
| `webhook.test` | `{endpoint}` (sent by `POST /v1/webhooks/{id}/test`) |

No webhook payload ever contains session content, paths, branch names, or keys.

---

## CT-NOTIF-PAYLOAD · Notifications

Schema: `schemas/notification.schema.json`. One shape serves the in-app inbox, OS notifications, web-push and email digests.

```json
{
  "id": "ntf_…", "created_at": "…", "read_at": null,
  "category": "approval_needed",
  "title_key": "notif.approval_needed.title",
  "body_key": "notif.approval_needed.body",
  "params": { "agent": "agt_…", "session": "ses_…", "risk": "medium" },
  "action": { "type": "open_session", "deeplink": "centcom://session/ses_…?focus=approval" },
  "priority": "high"
}
```
- **No display text on the wire**: `title_key` / `body_key` are looked up in each client's message table (so copy, language and tone live in the client). `params` carries only ids and enums (nothing from `ct`).
- Categories: `trial_ending`, `approval_needed`, `queue_turn`, `mention`, `member_joined`, `member_left`, `agent_done`, `ci_failed`, `pr_merged`, `usage_warning`, `quota_reached`, `billing_issue`, `invite_received`, `update_available`, `security_alert`.
- `params` keys per category (ids and enums only): `approval_needed {agent, session, risk}` · `queue_turn {session, item}` · `mention {session, from}` · `member_joined|member_left {session, member}` · `agent_done {session, agent, outcome}` · `ci_failed|pr_merged {session, agent}` · `usage_warning {limit, pct}` · `quota_reached {limit}` · `billing_issue {kind: payment_failed\|card_expiring}` · `trial_ending {days}` · `invite_received {workspace}` · `update_available {version, channel}` · `security_alert {kind}`. `action.type` ∈ `open_session | open_billing | open_invite | open_update | none`.
- Channels per category (user-configurable, CT-API-NOTIFY): `inbox`, `push`, `email`, `os` (client-local). Defaults: approval_needed → inbox+push+os; billing_issue → inbox+email; others → inbox.
- Quiet hours suppress `push` and `os`, never `security_alert` or `billing_issue`.
- Priority: `low|normal|high`. High may bypass quiet hours only for `approval_needed` if the user opted in.
- Email digests batch `low`/`normal` items hourly.

---

## CT-TELEMETRY · Opt-in telemetry

**Off by default.** On only when the user opts in (`PATCH /v1/me {telemetry:true}` or local setting). Schema: `schemas/telemetry.schema.json`.

Allowed event types (v1): `app.start`, `app.exit`, `command.run {name}`, `session.created {mode, transport}`, `session.joined {transport}`, `agent.state_change {from,to}` (state enums only), `feature.used {key}`, `error.shown {code}`, `perf.startup {ms}`, `perf.frame {p95_ms}`, `update.result {from, to, ok}`.

Rules:
1. **Never** include: message/code/diff text, paths, branch names, repo names, prompts, model output, IPs (server drops them), hostnames, usernames, emails, keys, ciphertext.
2. Identifier: a random per-install `install_id` (ULID) that resets when the user runs `centcom telemetry reset`. Not linkable to `usr_` by the client payload; the server MUST NOT join them.
3. Batch ≤ 100 events, ≤ 64 KiB, sent at most once per 60 s, buffered locally (bounded 1 000 events, dropped oldest first).
4. Server returns `204` unconditionally; failures are silent to the user.
5. Retention 90 days raw, aggregates kept.
6. Honour `DO_NOT_TRACK=1` and `CENTCOM_TELEMETRY=off` unconditionally.

---

## CT-DEEPLINK · Deep links and join URLs

| Purpose | Web URL | App URL |
|---|---|---|
| Join a session | `https://centcom.dev/j/<invite_token>` | `centcom://join/<invite_token>` |
| Open a session | `https://centcom.dev/s/<ses_id>` | `centcom://session/<ses_id>[?focus=approval|queue]` |
| Auth callback (PKCE desktop) | — | `centcom://auth/callback?code=…&state=…` |
| Upgrade / billing | `https://centcom.dev/billing` | `centcom://billing` |
| Accept workspace invite | `https://centcom.dev/i/<invite_token>` | `centcom://invite/<invite_token>` |
| Join as viewer guest (share link) | `https://centcom.dev/g/<share_token>` | `centcom://share/<share_token>` |

Rules:
- The `#k=…` fragment is preserved when the web page hands off to the app URL (`centcom://join/<token>#k=…`); the OS delivers the full URL to the app, which reads the fragment locally and never transmits it.
- Tokens are single-purpose, URL-safe, 160-bit, expiring (invites 7 days; share links ≤ 24 h).
- E2E key material for an invite lives only in the URL **fragment**: `https://centcom.dev/j/<token>#k=<base64url>`. Fragments are never sent to servers; web code strips them from history after reading.
- The `centcom://` scheme handler MUST show a confirmation before acting ("Join *Name*'s session?") and never perform destructive actions from a link.
- Unknown parameters are ignored. All parameters are validated; invalid links show a neutral error, not details.
- The web page at `/j/<token>` calls `GET /v1/invites/{token}` for the preview, then offers "Open in Centcom" (app URL) or "Continue in browser".
