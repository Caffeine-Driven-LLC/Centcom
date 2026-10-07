# @centcom/lan (lanes C071 and C073)

LAN direct mode: finding sessions on the same network, and pairing a guest with a host. No account and no backend.

## Discovery (C071)

- **`LanAdvertiser`** announces a session as `_centcom._tcp.local.` with an instance name `<session-name>-<4 hex>` (re-rolled on a conflict), SRV, TXT (`v p sid name host fp n pair`) and addresses. It probes first, announces twice, answers queries, updates the TXT when the member count changes, and says goodbye (TTL 0) on stop. `--no-announce` sends nothing but still reports the port; `--bind` limits the interfaces.
- **`LanBrowser`** queries at 0, 1, 2, 4 and 8 s and then every minute, merges the answers into `LanHost` entries, expires them on TTL, and emits `up`, `update` and `down`. Every record from the network is untrusted: size caps, TXT validation, bounded tables. The fingerprint in a record is only a hint to compare during pairing.
- Nothing secret is ever announced: only the fingerprint's display form, never keys, codes or tokens (a test scans the packets).
- If UDP 5353 cannot be used, `MdnsUnavailableError` says to join with `centcom join <ip>:<port>`.
- `centcom lan scan [--timeout s] [--json]` lists hosts; it exits 0 even when none are found.

## Pairing (C073)

- A short pairing code on the host and a password-authenticated key exchange (CPace) over the connection: a wrong code never reveals anything useful, and the host and guest prove to each other that they know the same code.
- Five wrong tries lock the source address for 10 minutes. The guest checks the host's fingerprint against the announced one (a mismatch stops the pairing); after pairing the guest holds a reconnect token in its keychain and the host a record of the guest's device keys.
- Secrets never appear in logs or errors (a test checks).

Built against an in-memory multicast bus and in-memory channels with a virtual clock; the real UDP socket is a thin wrapper.
