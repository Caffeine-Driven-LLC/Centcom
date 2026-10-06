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
| Kind | `t` | Mode | Who may send | Seq | Cleartext `p` | Secret (inside `ct`) |
|---|---|---|---|:-:|---|---|
| `message.user` | `event` | encrypted | host, editor* | yes | — | `text`, `agent_id`?, `queue_item`?, `attachments`?, `reply_to`? |
| `message.assistant.delta` | `event` | encrypted | host, editor* | yes | — | `agent_id`, `message_id`, `index`, `delta` |
| `message.assistant.done` | `event` | encrypted | host, editor* | yes | — | `agent_id`, `message_id`, `input_tokens`?, `output_tokens`? |
| `message.system` | `event` | encrypted | host, editor* | yes | — | `level`, `text` |
| `tool.request` | `event` | encrypted | host, editor* | yes | — | `agent_id`, `tool_id`, `name`, `input_summary`, `risk` |
| `approval.request` | `event` | hybrid | host, editor* | yes | `approval_id`, `agent_id`, `risk`, `expires_at`, `approver` | `summary`, `command`?, `cwd`? |
| `approval.decision` | `event` | hybrid | host (and delegated approvers) | yes | `approval_id`, `decision`, `scope` | `reason`? |
| `tool.result` | `event` | encrypted | host, editor* | yes | — | `agent_id`, `tool_id`, `status`, `summary` |
| `agent.spawn` | `event` | hybrid | host, editor* | yes | `agent_id`, `owner`, `mode`, `runs_on`?, `provider`? | `label`?, `branch`?, `worktree`?, `model`? |
| `agent.state` | `event` | clear | host, editor* | yes | `agent_id`, `state`, `since` | — |
| `agent.exit` | `event` | hybrid | host, editor* | yes | `agent_id`, `outcome`, `error_code`? | `detail`? |
| `branch.update` | `event` | encrypted | host, editor* | yes | — | `agent_id`, `branch`, `head`, `ahead`, `behind`, `dirty` |
| `file.lock` | `event` | hybrid | host, editor* | yes | `action`, `path_hmac`, `agent_id`, `ttl_ms`? | `path`? |
| `agent.handoff` | `event` | hybrid | host, editor* | yes | `handoff`, `agent_id`, `to`, `op` | `note`? |
| `conflict.detected` | `event` | hybrid | host, editor* | yes | `agent_ids`, `path_hmacs` | `paths`? |
| `diff.share` | `event` | encrypted | host, editor* | yes | — | `agent_id`, `files`, `blob`? |
| `reaction` | `event` | clear | host, editor, viewer | yes | `target`, `code`, `op` | — |
| `comment.add` | `event` | encrypted | host, editor, viewer | yes | — | `target`, `text` |
| `key.grant` | `event` | hybrid | host, editor (key holders) | yes | `to_device`, `kids` | `grants` |
| `queue.submit` | `queue` | hybrid | editor (host may also) | yes | `item`, `size`, `kind` | `body`, `attachments`? |
| `queue.cancel` | `queue` | clear | the submitter | yes | `item` | — |
| `queue.approve` | `queue` | clear | host | yes | `item` | — |
| `queue.reject` | `queue` | clear | host | yes | `item`, `code` | `note`? |
| `queue.reorder` | `queue` | clear | host | yes | `order` | — |
| `queue.drop` | `queue` | clear | host | yes | `item` | — |
| `queue.claim` | `queue` | clear | host | yes | `item`, `agent_id` | — |
| `queue.done` | `queue` | clear | host | yes | `item`, `outcome` | — |
| `queue.state` | `queue` | clear | server | yes | `version`, `items` | — |
| `control.kick` | `control` | clear | host | yes | `member`, `code` | — |
| `control.mute` | `control` | clear | host | yes | `member`, `until`? | — |
| `control.unmute` | `control` | clear | host | yes | `member` | — |
| `control.role` | `control` | clear | host | yes | `member`, `role` | — |
| `control.transfer_host` | `control` | clear | host | yes | `to` | — |
| `control.end` | `control` | clear | host | yes | `code` | — |
| `control.policy` | `control` | clear | host | yes | `auto_approve`, `share_history`, `queue_limit`, `locked`?, `auto_failover`?, `trusted`?, `approvers`?, `queue_paused`? | — |
| `control.member_joined` | `control` | clear | server | yes | `member`, `name`, `slot`, `role`, `device` | — |
| `control.member_left` | `control` | clear | server | yes | `member`, `code` | — |
| `control.roster` | `control` | clear | server | yes | `version`, `members` | — |
| `control.host_changed` | `control` | clear | server | yes | `host`, `code` | — |
| `control.session_state` | `control` | clear | server | yes | `state` | — |
| `control.rotate_request` | `control` | clear | host | yes | `reason` | — |
| `control.rotate_key` | `control` | clear | server | yes | `kid`, `reason` | — |
| `presence.update` | `presence` | clear | any member | no | `status`, `activity`, `agent_count`? | — |
| `presence.nudge` | `presence` | clear | editor, host | no | `to` | — |
| `presence.cursor` | `presence` | encrypted | any member | no | — | `path`?, `line`?, `col`?, `sel_end_line`?, `sel_end_col`? |

`*` = in command-post mode only the host emits; in branch mode the agent's owner emits for their own agents. `?` = optional field.

### Descriptions
- **`message.user`**: A user prompt entering an agent. In a command post only the host emits it (after approving a queue item, with `queue_item`); in branch mode the agent owner emits it.
- **`message.assistant.delta`**: Streaming chunk of an assistant reply. Senders SHOULD coalesce to ≤ 10 frames/s.
- **`message.assistant.done`**: End of an assistant reply.
- **`message.system`**: Notices from the runner (compaction, model switch).
- **`tool.request`**: An agent wants to run a tool (display copy).
- **`approval.request`**: A human decision is needed. Clear part lets the relay route notifications; detail is encrypted.
- **`approval.decision`**: Answer to an approval request.
- **`tool.result`**: Outcome of a tool call (display copy).
- **`agent.spawn`**: A new agent exists. Clear part: id, owner, mode, `runs_on` (the member whose account/machine runs it) and `provider` (CT-PROVIDER §5). Secret: label, branch, worktree, model.
- **`agent.state`**: Product state of an agent. `state` MUST be one of the names in `state-map.json` (CT-STATE-MAP).
- **`agent.exit`**: An agent finished.
- **`branch.update`**: Git state of an agent branch.
- **`file.lock`**: Advisory file lock traffic. `path_hmac` = BLAKE2b-MAC(session key, path); the relay arbitrates on the hash only.
- **`agent.handoff`**: Offer, accept or decline handing an agent/task to another member. Clear part drives notifications; the note is encrypted.
- **`conflict.detected`**: Two agents touch the same file or merge conflicts.
- **`diff.share`**: A diff shared for review.
- **`reaction`**: Emoji-style reaction to a frame. Codes map to pixel animations in the client.
- **`comment.add`**: A comment attached to a frame.
- **`key.grant`**: Sealed session-key grant for one device (CT-CRYPTO §4). `p.kids` says which epochs; the sealed keys are in `ct`.
- **`queue.submit`**: Add an item to the command-post queue. `id` of the frame is the queue item id (que_).
- **`queue.cancel`**: Submitter withdraws a queued item.
- **`queue.approve`**: Host approves an item (moves to `approved`).
- **`queue.reject`**: Host rejects an item.
- **`queue.reorder`**: Host sets the order of approved/queued items.
- **`queue.drop`**: Host removes an item.
- **`queue.claim`**: Host starts running an approved item.
- **`queue.done`**: Item finished.
- **`queue.state`**: Authoritative queue snapshot, sent after every change and on join.
- **`control.kick`**: Remove a member from the session.
- **`control.mute`**: Silence a member (their queue/message frames are dropped).
- **`control.unmute`**: Lift a mute.
- **`control.role`**: Change a member's session role.
- **`control.transfer_host`**: Hand the host role to another editor.
- **`control.end`**: End the session.
- **`control.policy`**: Session policy.
- **`control.member_joined`**: A member connected for the first time in this session.
- **`control.member_left`**: A member left, was kicked, or timed out.
- **`control.roster`**: Full roster, sent on join and after bulk changes.
- **`control.host_changed`**: The host changed (transfer or failover).
- **`control.session_state`**: Lifecycle change.
- **`control.rotate_request`**: Host asks the relay to announce a new key epoch (scheduled or on request). The relay answers with `control.rotate_key`; keys are chosen by the host (CT-CRYPTO §5).
- **`control.rotate_key`**: Key epoch changed (CT-CRYPTO). Members must switch to `kid` for new frames.
- **`presence.update`**: Coarse presence. Server coalesces; never replayed.
- **`presence.nudge`**: Poke a member. At most 1 per target per 60 s per sender; the relay drops extras silently.
- **`presence.cursor`**: Cursor / selection in a shared file or transcript. Server throttles to the latest per member every 100 ms.

### Agent states
`agent.state.state` is exactly one of: `approved`, `asking-question`, `auth-required`, `awaiting-approval`, `away`, `background-task`, `celebrate`, `ci-fail`, `ci-pass`, `ci-running`, `compacting`, `context-full`, `cost-alert`, `crash`, `creating-file`, `deleting-file`, `denied`, `deploying`, `editing-file`, `empty`, `error`, `first-run`, `handoff`, `high-five`, `host-session`, `idle`, `listening`, `merge-conflict`, `message-queued`, `no-results`, `offline`, `online`, `pair-working`, `planning`, `pr-merged`, `pr-open`, `prompt-received`, `provider-auth-required`, `provider-cap-reached`, `provider-policy-blocked`, `quota-reached`, `rate-limited`, `reading-file`, `ready`, `reconnecting`, `running-command`, `saving`, `searching`, `session-expired`, `sleeping`, `streaming`, `sub-agent`, `success`, `teammate-joins`, `teammate-leaves`, `teammate-typing`, `tests-fail`, `tests-pass`, `thinking`, `thinking-hard`, `tool-running`, `update-available`, `warning`, `welcome-teammate`.
These names are the integration point with the UI (mascot and status line), defined in `state-map.json` (CT-STATE-MAP). Backend lanes may validate the enum; they never invent states. Unknown states received by a client are shown as `thinking`-class "working" and logged.

### Member slots and colours
The protocol carries a **slot** (integer ≥ 0), not a colour: the server assigns the lowest free slot at first join in a session; slots are stable for the session's life and are never reused by a different member. How slots become colours is a **client presentation rule** (design system §3.2): self is always violet; others take red, yellow, green, brown in slot order skipping self; a sixth participant gets violet-outlined. Two clients may therefore show the same person in different colours; that is intended. Identity is always name + initial.

### Notices (server → client, not sequenced)
Frame `t: "sys.notice"`, body `p: {code, level, params}`; levels `info|warn|error`.

| `code` | `params` |
|---|---|
| `usage_warning` | `{pct, resets_at}` |
| `quota_reached` | `{resets_at}` |
| `plan_changed` | `{plan}` |
| `member_limit_near` | `{limit, count}` |
| `maintenance_soon` | `{starts_at, minutes}` |
| `client_update_available` | `{version, channel}` |
| `history_retention_changed` | `{days}` |

Clients render notices from a local message table keyed by `code`; the server never sends display text.

### Shared object shapes
Where the catalogue says `list:obj`, the objects are:

| Where | Object |
|---|---|
| `queue.state.items[]` | `{item: que_, submitter: mem_, state: queued\|approved\|running\|held, position: int\|null, size: int, kind: message\|command, ts, agent_id?: agt_}` |
| `control.roster.members[]` | `{id: mem_, name, slot: int, role: host\|editor\|viewer, device: dev_, connected: bool}` |
| `diff.share.files[]` (secret) | `{name, size, patch?: unified diff ≤ 64 KiB, blob?: blb_, sha256?}` |
| `message.user.attachments[]` (secret) | `{name, size, blob?: blb_, sha256?}` |

### Server identity
Frames stamped by the server carry `from: "srv"` (the literal string). Clients accept `control.member_joined`, `control.member_left`, `control.roster`, `control.host_changed`, `control.session_state`, `control.rotate_key`, `queue.state` and `sys.*` **only** when `from` is `srv`, and ignore them otherwise. On LAN the host stamps `srv` as well. Member-originated frames always carry a `mem_` id.

### Limits and bounds (normative)
| Thing | Bound |
|---|---|
| `file.lock.ttl_ms` | default 300 000 (5 min); min 5 000; max 3 600 000; the relay clamps |
| `approval.request.expires_at` | at most 24 h after the frame `ts`; default 10 min when the client omits it (clients SHOULD always send it) |
| `approver` meaning | `host`: the host; `owner`: workspace owner/admin members present in the session; `any_editor`: any editor |
| Who may send `approval.decision` | the host always; members listed in `control.policy.approvers`; the roles named by the request's `approver` |
| `control.mute.until` | at most 7 days after the frame `ts` (longer is clamped) |
| `presence.cursor` `ct` | ≤ 4 KiB |
| reactions | ≤ 20 per member per target frame; comments ≤ 200 per target frame |
| `queue.reject` / auto-approve reason | auto-approval is recorded in the audit event (actor `srv`, reason = policy), not on the frame |
| `sys.slow_down.p` | `{for_ms, reason: "rate" \| "outbound"}` |
| `sys.notice` levels | `usage_warning`→`warn`, `quota_reached`→`error`, `plan_changed`→`info`, `member_limit_near`→`warn`, `maintenance_soon`→`warn`, `client_update_available`→`info`, `history_retention_changed`→`info` |

`control.policy.queue_paused` (host): while true the relay keeps accepting `queue.submit` but does not auto-approve and refuses `queue.approve`/`queue.claim`; the host's own prompts are unaffected. It is what the "pause guest spending" control uses (CT-PROVIDER 5).

### Slots with several devices
Slots belong to the **member**, not the device. The same member connecting from two devices shares one slot (the newer connection supersedes the older, CT-WS-ENVELOPE).

### Session lifecycle states
`pending` (created, host not yet connected) → `live` → `paused` (host away beyond grace / key rotation needed) → `ended` (host ended) or `expired` (idle 24 h). REST `Session.state` uses the same five values. A session with a LAN origin never has a backend state.

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
