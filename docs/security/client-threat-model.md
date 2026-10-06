# Client threat model

What Centcom's client protects, who might attack it, and which part of the code stops them. Every asset has at least one mitigation and an owning lane. "Lane" means the plan card under `plan/client/`.

## Assets

| Asset | Where it lives | Mitigations | Lane |
|---|---|---|---|
| Device private keys (Ed25519 signing, X25519 key agreement) | OS keychain, never a file | `DeviceKeyStore` writes only to the keychain; the keystore scan (`tools/security/keystore.ts`) checks the config and state folders after a login; keys are never logged (`redact`) | C056, C004, C099 |
| Refresh and access tokens | OS keychain (refresh), memory (access) | tokens are never written to config or logs; the HTTP client reads them through `getAccessToken`; log redaction removes JWTs and `Authorization` values | C052, C051, C005 |
| Session keys (per-session symmetric keys, one per epoch) | memory; sealed to each member's device key when granted | XChaCha20-Poly1305 with the frame header as AAD; key rotation on member removal; grants are sealed boxes | C056 |
| Decrypted transcripts and approvals | the user's screen and the local session log | the relay only ever sees ciphertext (a canary marker test in the gate scripts); the local log is redacted and kept at 0600 | C056, C026, C100 |
| Provider credentials (Claude, Codex) | the provider's own files | Centcom never reads them; the Codex guide and tests forbid it | C013, C103 |
| Source code in the user's project | the user's disk | the agent runs under the permission engine and the command sandbox; nothing is uploaded unless the user shares it into a session | C015, C016 |
| Release artifacts and the update channel | the release store | artifacts are signed with Ed25519 over their SHA-256; the update client refuses anything unverified; SBOM per artifact | C012, C068, C099 |

## Actors

| Actor | What they can do | What stops them |
|---|---|---|
| Malicious guest in a shared session | send crafted messages, queue items, huge or odd frames | the host's approval gate (nothing runs without a yes), role checks, frame size limits, tolerant readers that ignore unknown data without executing it |
| Malicious or compromised relay | read and change traffic, drop or replay frames, lie about who sent what | end-to-end encryption and per-frame signatures; sequence numbers and ack/resume detect gaps and replays; a changed device key shows a fingerprint warning |
| Compromised update channel | serve a tampered binary | hash and signature are checked against keys embedded in the client; two keys for rotation; no key means no update |
| Local malware on the user's computer | read files and the environment | secrets are only in the OS keychain; the config folder holds no tokens; (a fully compromised user account is out of scope) |
| Malicious repository content (prompt injection) | text in files that tells the agent to run commands or leak data | the permission engine decides by the real command, not by what the model says; risky commands always ask; `curl | sh` and similar are classified high risk; hooks and MCP servers need explicit setup |
| Malicious dependency | run code at install or build time | no install scripts, exact versions, a frozen lockfile with integrity hashes, a licence allow-list and `pnpm audit` in the security check |
| Malicious pull request | steal CI secrets | workflows have least-privilege `permissions`, actions are pinned by SHA and allow-listed, `pull_request_target` never checks out PR code |

## What `pnpm security:check` covers

secret scan (Centcom keys, JWTs, private keys) · install-script ban · exact-version pinning · lockfile integrity · workflow lint · licence allow-list · `pnpm audit --prod --audit-level=high`. A check that cannot run fails; it never passes. Waivers need an issue URL and expire within 90 days (`tools/security/waivers.json`).

## Known gaps (tracked in `review-log.md`)

- the shared secret-pattern list (`contracts/fixtures/providers/secret-patterns.json`) does not cover Centcom's own `cen_live_` / `cen_test_` keys, GitHub, Slack, Stripe or npm tokens; the net logger adds the Centcom ones itself, the agent-side redaction does not yet;
- exact pinning is waived until C001 lands;
- the SBOM is validated against a subset of the CycloneDX 1.5 schema, not the full one.
