# session client (lane C057)

`createSessionClient({ http, crypto, deviceId, clientInfo, ... })` gives one handle per session that ties REST, the relay socket (C054), reliable delivery (C055) and the end-to-end crypto (C056) together. Nothing touches the network when it is constructed.

## What it does

- **Create / join / leave / end / claim host / list / share links** over REST. A create sends one `POST /v1/sessions` (the HTTP client keeps the `Idempotency-Key` across its own retries); a plan without relay access gives `SessionError('relay_not_included')` and no socket is opened. Every connection attempt mints a new join token; a ticket is never reused or logged.
- **Sending:** `sendEvent(kind, { p, secret })`. Clear kinds go as they are; encrypted and hybrid kinds are encrypted under the current epoch and signed with the device key (hybrid frames sign `p` too). A guest still waiting for a key gets `SessionError('waiting_for_key')`; a view-only guest gets `view_only`.
- **Receiving:** every frame with a `ct` is checked first (known sender, trusted device, Ed25519 signature) and then decrypted; failures are dropped with a `protocol-warning` and the session stays live. Subscribers only ever see verified events (`verified: true`). Unknown event kinds are ignored. Server-only control frames (`member_joined`, `member_left`, `roster`, `host_changed`, `session_state`, `rotate_key`) are honoured only when `from` is `srv`.
- **Keys, host side:** the host creates epoch `k1`, gives each new device a `key.grant` sealed to its X25519 key (everything, or only the current epoch when `share_history` is off), and answers the relay's `control.rotate_key` by making exactly that epoch and granting it to every remaining device. It asks for a scheduled rotation after 7 days or 100,000 frames (once). It never grants to a device that is unknown, revoked, a viewer or whose keys changed.
- **Keys, guest side:** `waiting_for_key` until a grant addressed to this device arrives from a host or editor; frames it could not read yet are kept and shown when the key comes. Epochs older than the first one it holds are reported once as `unreadable_earlier_history`. Keys can be kept between runs with `crypto.keyringStore` and a keychain.
- **Trust:** first use is remembered; a device whose keys change raises `key-changed`, its frames are held, and `trustDevice(deviceId)` accepts the new keys and delivers them.
- **Snapshots:** the host builds a checkpoint (the `buildSnapshot` option) every 500 frames or 5 minutes and when it ends the session: `POST .../snapshot`, `PUT` to the pre-signed address, `POST .../commit {seq, sha256, size, kid}`. A member whose position is too old fetches the newest snapshot (size and checksum checked, decrypted, `fmt` and `v` checked), fills the gap from REST history and asks the relay for the rest. If the snapshot is bad it says `earlier_history_unavailable` and rebuilds from the earliest retained history.

## Choices the contracts leave open

- **`key.grant` frame encryption.** The contract says the sealed keys are in `ct`, but the recipient has no key yet. The grants are already sealed boxes, so the frame's own AEAD key is derived from public values (`BLAKE2b-256("centcom.keygrant.v1|<sid>|<to_device>")`); the signature and the AAD still bind it to sender, session and recipient. A contract note is needed.
- **Snapshot blob:** `{"v":1,"cts":[{alg,kid,n,c},...]}`, the document cut into parts below the 192 KiB limit, each encrypted under the epoch key with AAD `{t:'event', id:'<snp>:<part>', from_dev:'snapshot', k:'snapshot'}`.
- **Share links:** the fragment is `#k=<key>&kid=<kid>` (the key of the current epoch; `kid` defaults to `k1`).

## Not done yet

- Re-encrypting frames that were queued but never sent when an epoch changes (CT-CRYPTO section 5.3): they go out under the epoch that is current when they are sent.
- Splitting a message larger than 192 KiB into chunks (it is refused with `too_large`).
- Share-link guests end to end (parsing and view-only checks are tested; the mock has no share-link relay path).
- Host hand-over key transfer: a new host that never held the older epochs cannot grant them.
- `control.policy` and `control.role` changes are applied to the local policy only.

Tests run two or more clients against the mock backend's relay, with a small REST overlay for the member and snapshot calls the mock only generates (`packages/net/test/session/rig.ts`).
