# ADR 0001: how a share-link guest learns who signed a frame

Status: proposed (contract PR, needs one approver from each side) · Lane: B104 (backend), client follow-up in `packages/net`

## Context
Every frame is signed by its sender's device key. Members read those keys from `GET /v1/sessions/{id}/members` (a member route). A share-link guest has no account, no device and no token, so it cannot call it: against the local backend a guest reaches `live` as a viewer but logs `unknown_sender` for every frame and shows nothing. CT-CRYPTO §4a gave guests the view key but not the sender keys.

## Options
a. **A public members route keyed by the link token** (`GET /v1/share-links/{token}/members`). No change to the relay or the ticket.
b. The relay puts device keys in the roster it sends guests. A wire change to `control.roster` / `sys.welcome` and a relay change.
c. View-only guests skip signature checks and rely on the view key. Nothing to build, but any link holder (or the server) could forge frames to another guest.

## Decision
(a). It is the smallest change, it reuses the capability the guest already holds (the link token, as `join` does), it needs no new wire frame, and the secrecy of the room is unchanged (the view key). The privacy cost is that a link holder can list the live members' display names and public device keys without joining; the keys are public by design and the link already grants the view key. Responses carry no user ids and no e-mail, and the route has `join`'s rate limit and error behaviour.

## Consequences
Guests trust the server's key list (no out-of-band fingerprint check), which CT-CRYPTO §4a now says. Clients re-read the list once on an unknown sender, as members do. Option (b) stays open if guests ever need to work without a REST call.
