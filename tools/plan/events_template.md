# 04 · Session events, presence, queue, control

Contracts in this file: **CT-WS-SESSION-EVENTS · CT-WS-PRESENCE · CT-WS-QUEUE · CT-WS-CONTROL**

> This file is **generated** by `tools/plan/gen_events.py` together with `schemas/events.schema.json` and `fixtures/events/*.json`. Edit the generator, never this file.

All frames use the envelope from CT-WS-ENVELOPE. This file defines what goes in `t`, `k`, `p` and `ct`.

---

## CT-WS-SESSION-EVENTS · The event catalogue

### Three payload modes
| Mode | Carries | Why |
|---|---|---|
| **clear** | `p` only | The relay must read it to do its job (ordering, authorisation, queueing, locks, notifications) and it reveals little |
| **encrypted** | `ct` only | Work content. The relay routes ciphertext and cannot read it |
| **hybrid** | `p` (small routing metadata) **and** `ct` (detail) | The relay needs a little (e.g. "an approval is needed, by whom, how risky") but not the details |

A frame validates only if it matches the mode of its kind. A decrypted `ct` is a JSON object validated against the kind's **secret** schema (`$defs.s_*`). Hybrid frames are signed over *both* parts (CT-CRYPTO).

### What the relay may read (the privacy budget)
Allowed: frame type/kind, ids, timestamps, sizes, queue item ids/states/positions, approval ids + risk + expiry, agent ids + state enum, lock `path_hmac`, presence status/activity, member slot/role. **Nothing else.** Message text, code, diffs, file paths, branch names, worktree paths, model names, command lines, and comment text are always inside `ct`. A relay lane that logs or stores any other field fails review.

### Catalogue
{{TABLE}}

`*` = in command-post mode only the host emits; in branch mode the agent's owner emits for their own agents. `?` = optional field.

### Descriptions
{{DETAILS}}

### Agent states
`agent.state.state` is exactly one of: {{STATES}}.
These names are the integration point with the UI (mascot and status line), defined in `state-map.json` (CT-STATE-MAP). Backend lanes may validate the enum; they never invent states. Unknown states received by a client are shown as `thinking`-class "working" and logged.

### Member slots and colours
The protocol carries a **slot** (integer ≥ 0), not a colour: the server assigns the lowest free slot at first join in a session; slots are stable for the session's life and are never reused by a different member. How slots become colours is a **client presentation rule** (design system §3.2): self is always violet; others take red, yellow, green, brown in slot order skipping self; a sixth participant gets violet-outlined. Two clients may therefore show the same person in different colours; that is intended. Identity is always name + initial.

### Notices (server → client, not sequenced)
Frame `t: "sys.notice"`, body `p: {code, level, params}`; levels `info|warn|error`.

| `code` | `params` |
|---|---|
{{NOTICES}}

Clients render notices from a local message table keyed by `code`; the server never sends display text.

### Shared object shapes
Where the catalogue says `list:obj`, the objects are:

| Where | Object |
|---|---|
| `queue.state.items[]` | `{item: que_, submitter: mem_, state: queued\|approved\|running\|held, position: int\|null, size: int, kind: message\|command, ts, agent_id?: agt_}` |
| `control.roster.members[]` | `{id: mem_, name, slot: int, role: host\|editor\|viewer, device: dev_, connected: bool}` |
| `diff.share.files[]` / `message.user.attachments[]` (secret) | `{name, size, blob?: blb_, sha256?}` |

### Server identity
Frames stamped by the server carry `from: "srv"` (the literal string). Clients accept `control.member_joined`, `control.member_left`, `control.roster`, `control.host_changed`, `control.session_state`, `control.rotate_key`, `queue.state` and `sys.*` **only** when `from` is `srv`, and ignore them otherwise. On LAN the host stamps `srv` as well. Member-originated frames always carry a `mem_` id.

### Size and rate rules
- `message.assistant.delta` ≤ 4 KiB plaintext per frame, ≤ 10/s per agent.
- Senders SHOULD coalesce `branch.update` to ≤ 1 per 2 s per agent and `agent.state` to ≤ 2 per second; the relay MUST NOT drop or merge sequenced frames (every sequenced frame is delivered).
- Any single `ct` ≤ 192 KiB; larger content is split with `chunk: {i, n, group}` inside the secret payload, or uploaded as a blob (`blb_`) and referenced.
- Events are idempotent by frame `id`.

### Unknown kinds
A client or relay that receives an unknown `k` MUST still sequence/ack/forward it (relay) or ignore it (client). Never close the connection for it.

---

## CT-WS-PRESENCE · Presence, typing, cursors

- Presence is **ephemeral**: carried in `t:"presence"` frames, never sequenced, never replayed, never stored durably.
- Connection state is authoritative for online/offline: the relay derives `offline` when the socket closes (after a 10 s grace to absorb reconnects) and emits `control.member_left` only for real leaves.
- `presence.update` is sent by the client on change (status/activity) and at most once per second; the relay coalesces to the latest per member and fans out at most once per 500 ms.
- `away` is set by the client after 5 min without input; `busy` is user-chosen.
- `presence.cursor` (encrypted): at most 10/s per member; the relay keeps only the **latest per member** and drops older ones under load. Cursors disappear for others after 10 s without update.
- A newly joined client receives the current presence of every member (one coalesced frame each) right after `welcome`.
- Typing indicators are `presence.update` with `activity:"typing"`, auto-cleared by the relay after 5 s with no refresh.
- There is no `offline` status on the wire: a member is offline when the roster says `connected:false` (CT-WS-CONTROL `control.roster`) or after `control.member_left`. `presence.update.status` is only `online|away|busy`.
- Presence is best-effort. No feature may depend on a presence frame being delivered.

---

## CT-WS-QUEUE · Command-post queue

### Model
An **item** is one submitted message or command waiting for the host. The item id is the client-generated `que_` ULID carried as the frame `id` of `queue.submit` (so retries are idempotent).

### States
```
              submit                approve              claim              done
 (none) ─────────────► queued ─────────────► approved ─────────► running ─────────► done | failed
                         │  ▲                   │                  │
              cancel/    │  │ (policy auto)     │ drop/cancel      │ host cancels the run
              reject/drop▼  │                   ▼                  ▼
                       canceled|rejected     dropped            canceled
```
`failed`/`done` are reported by `queue.done {outcome}`. `queue.state` carries the authoritative state of every live item.

### Rules
1. **Only the relay assigns order**: `position` is derived from the sequence of `approve`/`reorder` frames, so every client reconstructs the same queue by replaying frames.
2. **Submit:** allowed for `editor` and `host`; denied for `viewer`, muted members, locked sessions (`control.policy.locked`). Per-member cap: 5 live items; per-session cap: `control.policy.queue_limit` (default 20). Over cap → `sys.error` `queue_full`.
3. **Auto-approval:** governed by `control.policy.auto_approve` (and, for `trusted`, the `control.policy.trusted` member list). `ask` (default): nothing runs until the host approves. `trusted`: editors on the workspace's trusted list auto-approve. `everyone`: all editors. When auto-approving, the **relay** emits the `queue.approve` frame with `from` = server and the policy as reason (so auditing shows it).
4. **Approve / reject / reorder / drop / claim / done:** host only. Non-host attempt → `forbidden`, audited.
5. **Cancel:** only the submitter, and only while `queued` or `approved`.
6. **Claim** is the host client declaring "I am running this now". Exactly one item per agent can be `running`; the host may run several items concurrently on different agents (branch/worktree isolation) but each item at most once.
7. **Host loss:** if the host disconnects, `approved`/`running` items are marked `held`; on host return they resume; on host failover (CT-WS-CONTROL) the new host sees them as `approved`.
8. **Size:** `queue.submit.p.size` is the ciphertext size in bytes; the relay rejects > 192 KiB.
9. **Visibility:** the clear metadata (id, submitter, state, position, size, ts) is visible to all members; the body is visible to all members too (it is encrypted with the session key), but **UI** hides non-host items' bodies from other editors unless the host allows (`control.policy` extension in v1.1). Do not rely on this for confidentiality between members.
10. Idempotency: replayed `queue.submit` with an existing `(sid, from, id)` is a no-op returning the existing sequence.

### Failure behaviour
- `approve` for an unknown/finished item: ignored (idempotent) and a `sys.error` `queue_item_gone` goes only to the sender.
- Concurrent `reorder` frames: last by `seq` wins.

---

## CT-WS-CONTROL · Authority actions

`t:"control"` frames change who is in the session and how it behaves. They are **cleartext, sequenced, and enforced by the relay**, not just displayed.

### Authority
| `k` | Sender | Relay enforcement |
|---|---|---|
| `control.kick` | host | Close target's connection with 4403, revoke ticket, rotate key epoch (CT-CRYPTO), emit `member_left` + `rotate_key` |
| `control.mute` / `unmute` | host | Drop the target's `queue`/`event` frames except `presence`; store mute state in session |
| `control.role` | host | Update the session role immediately; take effect from the next frame |
| `control.transfer_host` | host → editor | Atomic: new host set, old host becomes `editor`, `host_changed` emitted |
| `control.end` | host | Session → `ended`, all connections closed 1000, history retention clock starts |
| `control.policy` | host | Stored on the session; applied to subsequent frames |
| `control.rotate_request` | host | Relay emits `control.rotate_key` with the next epoch id and increments the epoch counter; the host then publishes the new key via `key.grant` |
| `control.member_joined/left`, `roster`, `host_changed`, `session_state`, `rotate_key` | **server only** | Clients MUST ignore these if `from` is not the server |

### Ordering and atomicity
- Control frames are sequenced with everything else; a control frame takes effect for **all frames with a higher `seq`**.
- `kick` + `rotate_key` are emitted back-to-back with consecutive `seq` numbers.
- The relay checks the **sender's live role** at sequencing time. A control frame from a member whose role changed concurrently is rejected.

### Host failover
If the host is disconnected beyond the grace period (default 120 s) and **auto-failover** is enabled in policy (`control.policy.auto_failover`, default off), the relay promotes the longest-connected `editor` and emits `control.host_changed {code:"failover"}`. Otherwise the session becomes `paused` (queue frozen) until the host returns or the owner/admin claims host via REST (`POST /v1/sessions/{id}/claim-host`, workspace admins only).

### Audit
Every control frame, accepted or rejected, writes an audit event (CT-API-AUDIT) with actor, target, outcome.
