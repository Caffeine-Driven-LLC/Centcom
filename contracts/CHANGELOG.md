# Contract changelog

## 1.2.0 (providers)
- **New contract CT-PROVIDER** (`10-providers.md`): Anthropic and OpenAI models are used by driving the user's **own** `claude` and `codex` CLIs. Centcom never handles provider credentials, never uses the vendor SDKs or model APIs in v1, never pays for or pools usage; the backend never sees a credential. Defines the command-post "who pays" rule, kill-switch flags, login handoff, client-local error vocabulary, risk register, and shared fixtures (`fixtures/providers/`).
- `agent.spawn` clear part gains optional `runs_on` and `provider`.
- **Entitlements:** `agent_minutes_month` is now `hosted_minutes_month` (minutes a hosted session is `live`, measured by the relay); `tokens_month` removed. Model usage is never metered or sold; client-reported tokens/agent minutes are informational.
- New client-local states `provider-auth-required`, `provider-cap-reached`, `provider-policy-blocked`; schema `provider-policy.schema.json`.

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
