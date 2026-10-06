# End-to-end crypto (CT-CRYPTO)

Exactly the primitives and encodings of `contracts/05-crypto.md`, proved by `contracts/fixtures/crypto/vectors.json` (ciphertext, signature, path MAC and fingerprint match bit for bit).

- `initCrypto()` loads libsodium once (pinned `libsodium-wrappers`); every other call needs it first.
- **Frames**: `encryptPayload` (XChaCha20-Poly1305-IETF, a fresh random 24-byte nonce every time, AAD = JCS of `v t id sid from_dev k kid`), `decryptPayload` (`unknown_kid`, `aead_failed`, `too_large` over 192 KiB), `signFrame` / `verifyFrame` (Ed25519 over JCS of the header, `kid n c` and `p` for hybrid frames only; verify before decrypting), `splitChunks` / `joinChunks` (`{ chunk: { i, n, group }, part }`). `canonicalJson` is RFC 8785.
- **Device keys** (`DeviceKeyStore`): X25519 and Ed25519 key pairs whose private halves live only in the OS keychain (`@napi-rs/keyring`, account `device-keys:<device id>`); public halves as base64url; `rebindDeviceId` after login.
- **Session keys** (`KeyRing`): one 32-byte key per epoch, `kid = "k" + epoch`; `rotate` (member removed, scheduled every 7 days or 100,000 frames, requested); persisted only encrypted under a wrapping key kept in the keychain.
- **Grants**: `sealGrants` / `openGrants` (`crypto_box_seal` per kid to one device; only that device can open them; `grantKids` leaves out older epochs when history is not shared), offline invite bundles sealed to a one-time key carried in the link fragment `#k=` (`generateInviteSecret`, `sealInviteBundle`, `openInviteBundle`).
- **Fingerprints and trust**: `fingerprint` (`ABCD-EFGH-IJKL`), `TrustStore` (trust on first use: `new`, `match`, `changed`, never a silent accept; only public keys are stored).
- **Path MACs** for file locks: `pathHmac(ring, kid, path)`.

Nothing here sends anything, logs key material or writes a private or session key to a file.
