# Proposal: device keys for web sign-in (C082, C083)

Status: proposal for a Contract PR. Nothing here changes `contracts/`; the client work that depends on it is listed at the end.

## What does not work today

A person who signs in on the web app and joins a shared session stays in `waiting_for_key`. The host seals the session key to the public X25519 key of every device on the roster (`key.grant`, CT-CRYPTO section 3), and the web app has no device on the roster.

The web app does its part of the PKCE flow: `apps/web/src/auth/runtime.ts` makes the two WebCrypto keypairs (`devicekeys.ts`) and `startLogin` adds `device_pubkeys` and `device_name` to the authorize URL. The backend then ignores both: its own test says `ignores parameters it does not know (device_name, device_pubkeys)` (Centcom-backend `apps/api/test/modules/auth/pkce/authorize.test.ts`). The token that comes back has no `dev_` id, so the roster never lists a web device.

## Why this needs a contract change

- `contracts/01-auth-rbac.md` ("Devices for the web app") says the public halves are passed "on `GET /v1/auth/authorize`", but `contracts/openapi.yaml` lists no such query parameters for `authorize` (only `response_type`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `scope`, `state`). A server built from the OpenAPI file has nothing to read.
- The encoding is not written down anywhere. The web app currently sends `base64url(JSON.stringify({x25519, ed25519}))`; the device flow sends the same two keys as a JSON object in a request body.
- Nothing says where the new `dev_` id comes back. `POST /v1/auth/token` returns the RFC 6749 body only.
- There is no other way to add a device to an account: `GET /v1/devices` and `DELETE /v1/devices/{id}` exist, `POST` does not.

## Proposed change

1. `GET /v1/auth/authorize` gets two optional query parameters:
   - `device_name`: 1 to 80 characters, same rule as `DeviceCodeRequest.device_name`.
   - `device_pubkeys`: base64url (no padding) of the UTF-8 JSON `{"x25519":"<43 chars>","ed25519":"<43 chars>"}`, same key format as `DeviceCodeRequest.device_pubkeys`. At most 256 bytes after decoding.
   Both are bound to the authorization code. A client that sends `device_pubkeys` must send `device_name`.
2. `POST /v1/auth/token` (authorization-code grant) registers the device when the code carries keys, exactly as the device flow does at approval, and adds `device_id` (`dev_...`) to the success body. The access token then carries the `dev` claim. A code without keys keeps today's behaviour (no device, viewer-only in sessions).
3. The refresh grant keeps the same device. Revoking the device (`DELETE /v1/devices/{id}`) kills the web tokens, as for a CLI device.
4. `authorize` answers `400 invalid_request` for malformed keys (wrong length, not base64url, not JSON), with the JSON Pointer `/device_pubkeys` as in the device flow.
5. Fixtures: one authorize request with keys and one malformed, plus a token response with `device_id`. Both conformance suites run them.

The backend side already has `checkDevicePublicKeys` (`apps/api/src/modules/auth/device/keys.ts`), so the validation is reused.

## What the web app does once this lands

All of this is in `apps/web`, none of it touches a contract:

1. **Keep the registered keys.** `ensureDeviceKeys` already stores non-extractable keys in IndexedDB. After the token exchange the app keeps `device_id` next to them and passes it to the session engine (`ConnectOptions.deviceId` already exists).
2. **Use those keys in the session engine.** Today `apps/web/src/session/engine.ts` makes a throw-away in-memory libsodium keypair at every page load (`memoryKeychain` plus `DeviceKeyStore.getOrCreatePublicKeys`). That keypair is not registered, so it must go. Two parts:
   - **Signing.** WebCrypto Ed25519 `sign` with the non-extractable key; the verified signature format is the same as libsodium's detached signature.
   - **Opening `key.grant`.** The grant is a libsodium `crypto_box_seal` to the device's X25519 key, and `crypto_box_seal_open` needs the raw secret key, which a non-extractable key never gives. The sealed box can be opened without it: derive the shared secret with `subtle.deriveBits({name:'X25519', public: ephemeralPublic}, secretKey, 256)`, run it through `crypto_core_hsalsa20` (as `crypto_box_beforenm` does), take the nonce as `blake2b(epk || recipientPk, 24 bytes)`, and `crypto_secretbox_open_easy`. The result is checked against the sealed-box known-answer vectors in `contracts/fixtures/crypto/vectors.json`.
3. **Browsers without Ed25519 or X25519 in WebCrypto** keep the current viewer-only path and say so (the contract already allows this).
4. **Device list and sign-out.** The web device appears in Settings, Devices (C090) with its name, and signing out on the web revokes it.

## Risks and abuse cases

- A page script that can run code in the origin can use the keys but not read them (non-extractable). That is the reason for WebCrypto; a script injection is already game over for the access token.
- Registration on every login would pile up devices. The web app reuses its stored keys, so the backend should treat an already registered `x25519` public key of the same user as the same device and return its `device_id`.
- Rate limits: `authorize` is already rate limited per IP; the proposal adds no new endpoint.

## Order of work

1. Contract PR with ADR (both sides approve): sections 1 to 5 above.
2. Backend: read the parameters, register at token exchange, add `device_id`.
3. Client: web session engine on the registered keys (section "What the web app does"), then C083's join test against the live backend with two accounts.
