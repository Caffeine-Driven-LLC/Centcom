# Proposal: the id of a `queue.submit` frame (C058)

Status: proposal for a Contract PR. Nothing here changes `contracts/`.

## The contradiction

`CT-WS-QUEUE` (`contracts/04-session-events.md`, "Model") says the queue item id is the client-generated `que_` ULID "carried as the frame `id` of `queue.submit`", so a retry of the same frame is the same item.

Two other places say a frame id is a `msg_` ULID:

- `contracts/schemas/envelope.schema.json`: `id` has the pattern `^msg_[0-9A-HJKMNP-TV-Z]{26}$`.
- `contracts/03-ws-envelope.md`: "`id` is the client-generated `msg_` ULID. Idempotency key: the server de-duplicates by `(sid, from, id)` for 24 h".

Everything that refers to an item afterwards (`queue.state.items[].item`, `queue.approve`, `queue.cancel`, `queue.claim`, the `queue_item` field of prompts in `events.schema.json`) requires `^que_...$`.

So a frame with a `que_` id breaks the envelope schema, and a frame with a `msg_` id cannot be the item id the other events name.

## What the client does now

`packages/net/src/queue/client.ts` (C058) makes the item id (`que_<ULID>`) and sends `queue.submit` with the frame id `msg_<same ULID>` (`frameIdOf`), so the envelope validates and the relay de-duplicates a retry by frame id. The client then expects the relay to name the item `que_<same ULID>` in `queue.state` and in the later `queue.*` events. Nothing in the contract says the relay derives the item id that way, so this works against the mock only because the mock follows the same convention.

## Options

A. **Item id travels in the payload.** The frame `id` stays `msg_` (envelope unchanged, de-duplication unchanged). `queue.submit` gets a required clear field `item` (`^que_...$`), the client-generated item id. The relay de-duplicates the item by `(sid, from, item)` too. A retry reuses both ids.
B. **Envelope allows `que_` for this kind.** `id` becomes `^(msg|que)_...$` and only `queue.submit` may use `que_`. Smallest text change, but it makes the envelope schema depend on the kind.
C. **Item id is server generated.** The relay answers with `queue.state` and the client matches its submit by `msg_` id. Needs a field in `queue.state` that echoes the submit frame id, and retries stay idempotent by `msg_`.

D. **Write the convention down.** The item id is `que_` followed by the ULID part of the `queue.submit` frame id (`msg_<ULID>`). No schema change, one sentence in `04-session-events.md` and one in `03-ws-envelope.md`, a fixture pair, and the backend derives the item id instead of generating one. This is what the client already does.

Recommended: A if the team wants each id in one pattern and an explicit field; D if the smallest change wins (the client already behaves that way). Either way the client change is small: A moves the item id into `p.item` and sends a fresh `msg_`; D needs none.

## Text to change if A is chosen

- `04-session-events.md`: `queue.submit` row gets `item` in its clear fields; "Model" says the item id is `p.item`.
- `events.schema.json`: `p_queue_submit` gains required `item` (`^que_...$`).
- `fixtures/events/queue.submit.json`: add the field.
- `03-ws-envelope.md`: add the sentence that a queue item id is never a frame id.
- Backend: de-duplicate items by `(sid, from, item)` and copy `item` into `queue.state`.

For D the text change is only the two sentences above and the backend rule.
