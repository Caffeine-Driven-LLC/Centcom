# Contract changelog

## 1.1.0 (before first implementation; resolves the open questions found while writing the 200 lane cards)
Additive or clarifying only; no breaking change.

- **Sessions:** state values fixed to `pending|live|paused|ended|expired`; `welcome.p.session {mode, state}`; `relay_url` from join-token is authoritative; `last_seq: null` semantics.
- **Frames:** server-originated frames use `from: "srv"`; `sys.slow_down.p.reason`; documented `welcome.limits` keys.
- **Events:** new `agent.handoff`, `presence.nudge`, `control.rotate_request`, `key.grant`; `control.policy` gains `auto_failover`, `trusted`, `approvers`; bounds table (lock TTL, approval expiry, mute, cursor size, reaction/comment caps); object shapes for `queue.state` and `control.roster`.
- **Auth:** web app registers device keys; redirect URIs; verification URI; 60 s authorization code; API key display prefix; who may assign which workspace role; guest read fields; `admin` scope is internal.
- **Crypto:** share-link guests decrypt with a view key in the URL fragment (CT-CRYPTO §4a); `path_hmac`/fingerprint derivations fixed; key bundle is returned once.
- **REST:** `POST /v1/me/restore`; `use_` usage-event ids; project body; share-link body; audit action names; flags semantics; telemetry idempotency optional; invoices readable by owner/admin/billing.
- **Foundations:** `use`, `inc`, `exp`, `psh` id prefixes; `cursor_invalid` error; idempotency in-flight behaviour; incident statuses.
- **Billing:** only owner/admin/member consume seats; retention override may only shorten.
- **Integrations:** `webhook.test` event; notification `trial_ending` category and per-category `params`; webhook event id header.
- **State map:** explicit list of agent-level states; the rest are client-local.

## 1.0.0
First frozen set (31 contracts).
