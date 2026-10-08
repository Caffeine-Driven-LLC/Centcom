# Cryptography usage

How to use cryptography correctly as an application developer, which means
choosing the right high-level primitive from a maintained library and
feeding it correctly. Not how to implement primitives. Covers the use/never
table, authenticated encryption and nonce rules, the difference between
hashing, MACs and signatures, password hashing parameters, key derivation,
randomness, constant-time comparison, key management, TLS baselines, and
the misuses that show up in real code with their fixes.

## Contents

1. The decision table: which primitive for which job
2. Use these, never these
3. Libraries per language
4. Authenticated encryption: AES-GCM, ChaCha20-Poly1305, nonce rules
5. Hashing vs MAC vs signature
6. Password hashing: argon2id and bcrypt parameters
7. Key derivation (KDFs) and when you need one
8. Randomness: tokens, ids, and what is not random
9. Constant-time comparison and timing side channels
10. Key management: generation, storage, rotation, envelope encryption
11. TLS configuration baselines
12. Common misuse with fixes
13. Tests and detection

## 1. The decision table

| You need to... | Use | Not |
|---|---|---|
| Keep data confidential and detect tampering (at rest or in a token) | AEAD: AES-256-GCM or XChaCha20-Poly1305, via a high-level API (libsodium `secretbox`/`aead`, Tink, `cryptography.Fernet`, Go `crypto/cipher` AEAD, Web Crypto `AES-GCM`) | AES-CBC/ECB/CTR alone, RC4, DES/3DES, Blowfish, "encrypt-then-hope" |
| Verify a message came from someone holding a shared key | HMAC-SHA-256 (or Poly1305 inside an AEAD) | Plain hash of (key + message), CRC |
| Verify a message came from a specific party without sharing a key | Ed25519 signatures (or ECDSA P-256, RSA-PSS 3072+ when interop demands) | RSA PKCS#1 v1.5 signatures for new designs, DSA, raw RSA |
| Store passwords | argon2id (preferred) or bcrypt; scrypt acceptable | SHA-*, MD5, PBKDF2 unless compliance requires (then ≥600k iterations) |
| Derive keys from a password | argon2id / scrypt → key | SHA-256(password) |
| Derive multiple keys from one strong key | HKDF-SHA-256 with distinct `info` strings | Truncating/concatenating the key, reusing one key for two purposes |
| Fingerprint/dedupe data (no adversary) | SHA-256, BLAKE2/3 | MD5, SHA-1 (collisions exist) |
| Generate tokens, session ids, nonces, salts | OS CSPRNG (`crypto.randomBytes`, `secrets`, `crypto/rand`, `SecureRandom`, `random_bytes`) | `Math.random`, `random.random`, `rand()`, `java.util.Random`, timestamps, UUIDv1 |
| Agree on a key over a network | X25519 (ECDH) inside a vetted protocol (TLS, Noise, libsodium `box`) | Rolling your own handshake |
| Encrypt for a recipient's public key | libsodium `sealed_box` / age / HPKE (RFC 9180) | Raw RSA encryption of the data |
| Transport security | TLS 1.2+ (prefer 1.3) with the baselines in §11 | Custom encrypted channels, TLS with verification disabled |
| Integrity of a URL parameter or cookie value you issued | HMAC with a server key (or a signed/AEAD token) | Base64, "obfuscation", MD5 of the value |

If the task does not appear here, the answer is probably a protocol or
library (JWT with proper validation, TLS, age, libsodium, Tink, Fernet,
PASETO), not a primitive.

## 2. Use these, never these

**Use**: AES-GCM (with the nonce discipline in §4), ChaCha20-Poly1305 /
XChaCha20-Poly1305, HMAC-SHA-256/512, SHA-256/384/512, SHA-3, BLAKE2/3,
Ed25519, X25519, ECDSA P-256/P-384 (with deterministic or well-sourced
randomness), RSA-OAEP and RSA-PSS at 3072+ bits, argon2id, bcrypt, scrypt,
HKDF, TLS 1.3, AES-KW (key wrap) when wrapping keys for interop.

**Never (for new code; migrate when found)**: MD5 and SHA-1 for anything
security-relevant; DES, 3DES, RC4, Blowfish, IDEA; AES in ECB (identical
blocks → identical ciphertext, the penguin picture) or in CBC/CTR without a
MAC (padding oracles, malleability); RSA PKCS#1 v1.5 encryption
(Bleichenbacher) and RSA < 2048; DSA; custom key schedules; XOR with a
repeating key; "encryption" with `base64`; hashing a password with a fast
hash plus a salt; any construction where you combine primitives yourself
(encrypt-and-MAC with a shared key, hash(secret || message) as a MAC: length
extension); hard-coded IVs, zero IVs, IV derived from the key; `Math.random`
for anything secret; `java.util.Random`, Python `random`, PHP `rand`/`mt_rand`
for tokens; comparing MACs/tokens with `==`.

Also never: implementing a primitive yourself (AES, SHA, RSA, bignum) in
production code; "obfuscating" a key in the client and calling it
encryption; storing the key next to the ciphertext; trusting a library
because it is on the first page of search results (check maintenance and
audits).

## 3. Libraries per language

| Language | Recommended high-level | Notes |
|---|---|---|
| JavaScript / Node | `node:crypto` (AES-GCM, HMAC, randomBytes, scrypt, hkdf, timingSafeEqual); `libsodium-wrappers` or `tweetnacl` for secretbox/box/sign; `@noble/*` (audited pure-JS) for browsers; Web Crypto in browsers | Avoid `crypto-js` for new code (unmaintained, foot-guns); avoid `createCipher` (removed in Node 22; it derived keys with MD5) |
| Python | `cryptography` (Fernet for simple symmetric; `hazmat` AEAD, HKDF, signatures); `PyNaCl` (libsodium); `argon2-cffi`; `bcrypt`; `secrets` | Avoid `pycrypto` (dead); `pycryptodome` is maintained but lower-level |
| Go | `crypto/*` stdlib (`cipher.NewGCM`, `chacha20poly1305` in `golang.org/x/crypto`, `hmac`, `ed25519`, `rand`), `x/crypto/argon2`, `x/crypto/bcrypt`, `x/crypto/hkdf`, `x/crypto/nacl` | Stdlib is excellent; `age` for file encryption |
| Java / Kotlin | Google Tink (opinionated, safe defaults); JCA `Cipher.getInstance("AES/GCM/NoPadding")`; Bouncy Castle for argon2 and modern algorithms; `SecureRandom` | JCA strings are easy to get wrong (`"AES"` alone = ECB); Spring Security `Argon2PasswordEncoder`/`BCryptPasswordEncoder` |
| Ruby | `OpenSSL::Cipher.new('aes-256-gcm')` with auth tag handling; `RbNaCl` (libsodium); `bcrypt` gem; `argon2` gem; `SecureRandom`; Rails `ActiveSupport::MessageEncryptor` (AES-GCM), `MessageVerifier`, `has_secure_password` | |
| PHP | `sodium_*` functions (built in since 7.2; `sodium_crypto_secretbox`, `sodium_crypto_aead_xchacha20poly1305_ietf_*`, `sodium_crypto_sign`); `password_hash(PASSWORD_ARGON2ID)`; `random_bytes`; `hash_equals` | Avoid `mcrypt` (removed), `openssl_encrypt` without a MAC |
| Rust | `ring`, `RustCrypto` crates (`aes-gcm`, `chacha20poly1305`, `argon2`, `hkdf`), `ed25519-dalek`, `rand` with `OsRng` | |
| .NET | `AesGcm`, `ChaCha20Poly1305`, `HMACSHA256`, `RandomNumberGenerator`, `Rfc2898DeriveBytes` (PBKDF2), `Konscious.Security.Cryptography` for argon2, `CryptographicOperations.FixedTimeEquals` | Avoid `RijndaelManaged`, `TripleDES`, `MD5CryptoServiceProvider` |
| Swift / iOS | CryptoKit (`AES.GCM`, `ChaChaPoly`, `HMAC`, `Curve25519`, `SHA256`), `SecRandomCopyBytes`, Keychain | See `mobile-security.md` |
| Android | Jetpack Security (`EncryptedSharedPreferences`, `EncryptedFile`), Tink, Android Keystore | See `mobile-security.md` |

The "high-level" designation matters: Fernet, libsodium `secretbox`, Tink
`Aead`, Rails `MessageEncryptor` choose the algorithm, generate the nonce,
and authenticate; you supply key and plaintext. Prefer those unless you
have an interop requirement that forces the raw AEAD API.

## 4. Authenticated encryption and nonce rules

Encryption without authentication lets an attacker flip bits in the
ciphertext and have them flip in the plaintext (CBC/CTR malleability), and
enables padding-oracle attacks against CBC. Always use an AEAD mode, which
produces a tag that verifies the ciphertext (and optional associated data)
before decryption yields anything.

**AES-256-GCM**: nonce is 96 bits. The nonce must **never repeat for the
same key**: a repeat leaks the XOR of plaintexts *and* the authentication
key, breaking integrity for every message. With random 96-bit nonces, the
birthday bound means you should rotate the key before roughly 2^32
messages (NIST suggests far fewer for random nonces; use a counter or
rotate at ~2^32 ÷ a safety factor). For high-volume or multi-node systems
where nonce uniqueness is hard to guarantee, use **XChaCha20-Poly1305**
(192-bit nonce; random nonces are safe indefinitely) or **AES-GCM-SIV**
(nonce-misuse resistant). Store the nonce alongside the ciphertext (it is
not secret).

```ts
// Node: AES-256-GCM, correct
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export function encrypt(key: Buffer /* 32 bytes from KMS/KDF */, plaintext: Buffer, aad = Buffer.alloc(0)) {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([Buffer.from([1]) /* version */, nonce, tag, ct]);   // version byte allows future migration
}
export function decrypt(key: Buffer, blob: Buffer, aad = Buffer.alloc(0)) {
  if (blob[0] !== 1) throw new Error('unknown version');
  const nonce = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = createDecipheriv('aes-256-gcm', key, nonce);
  d.setAAD(aad); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);                          // throws on tampering
}
```

```python
# Python: XChaCha20-Poly1305 via PyNaCl (random nonce is safe), or Fernet for the simplest API
from nacl.secret import Aead
box = Aead(key)                              # 32-byte key
ct = box.encrypt(plaintext, aad=b"user:42")  # nonce generated and prepended
pt = box.decrypt(ct, aad=b"user:42")

from cryptography.fernet import Fernet       # AES-128-CBC + HMAC-SHA256, timestamped; fine for most app needs
f = Fernet(Fernet.generate_key()); tok = f.encrypt(b"data"); f.decrypt(tok, ttl=3600)
```

```go
// Go: ChaCha20-Poly1305 with the X variant
aead, _ := chacha20poly1305.NewX(key)
nonce := make([]byte, aead.NonceSize()); rand.Read(nonce)
ct := aead.Seal(nonce, nonce, plaintext, aad)   // prepend nonce
```

**Associated data (AAD)**: bind the ciphertext to its context (user id,
record id, purpose) so a ciphertext copied from one row to another fails
to decrypt. Cheap and often forgotten.

**Versioning**: prefix ciphertexts with a version/key-id byte so you can
rotate keys and algorithms without a flag day.

## 5. Hashing vs MAC vs signature

- **Hash** (SHA-256): anyone can compute it; proves nothing about origin.
  Use for integrity against *accidental* change, content addressing,
  dedupe, commitment schemes (with a random salt).
- **MAC** (HMAC-SHA-256): needs the shared key to compute *and* verify.
  Proves the message came from someone with the key and was not changed.
  Use for signed cookies, webhook signatures, API request signing between
  parties that share a secret, CSRF tokens.
- **Signature** (Ed25519): private key signs, public key verifies. Proves
  origin to parties who do not hold the secret. Use for JWTs verified by
  many services, software releases, audit logs, anything where verifiers
  should not be able to forge.

Misuses: `sha256(secret + message)` as a MAC (length-extension attacks on
Merkle-Damgård hashes; use HMAC); using a MAC where the verifier is
untrusted (they can forge, since they hold the key: JWTs with HS256 shared
to many services); using a hash of a token as "authentication" of the
token (fine for *storing* tokens like password reset tokens, since the
database then never holds the live token: `store sha256(token)`, compare
`sha256(presented)`; that is a legitimate pattern because the token itself
is high-entropy).

Webhook verification example (the HMAC pattern done right):

```python
import hmac, hashlib, time
def verify_webhook(secret: bytes, payload: bytes, sig_header: str, tolerance=300) -> bool:
    # header like "t=1700000000,v1=hexdigest"
    parts = dict(p.split("=", 1) for p in sig_header.split(","))
    ts = int(parts["t"])
    if abs(time.time() - ts) > tolerance:            # replay window
        return False
    expected = hmac.new(secret, f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])   # constant-time
```

Sign the *raw* body bytes, not a re-serialized JSON (key order and
whitespace differ). Include a timestamp to bound replay.

## 6. Password hashing parameters

Passwords are low-entropy; the hash must be deliberately slow and memory-
hard so offline guessing after a database leak is expensive. Never
reversible, never a fast hash, always salted (the libraries salt for you).

**argon2id** (preferred; winner of the Password Hashing Competition):
memory 19-64 MiB, iterations 2-3, parallelism 1 (OWASP's minimum
suggestion: m=19456 KiB, t=2, p=1; a server with headroom can use m=65536,
t=3). Target ~100-250 ms per hash on your production hardware; tune memory
up first.

**bcrypt**: cost 12 as the floor in 2026 (cost 10 was the 2015 default and
is now too fast); 13 if the hardware allows. Inputs longer than 72 bytes
are truncated silently; either reject longer passwords, or pre-hash with
SHA-256 and base64 (and know that this changes the scheme). Most teams
just enforce a 64-char maximum, which NIST permits.

**scrypt**: N=2^17, r=8, p=1 (~128 MiB) is reasonable; less common in new
code since argon2 exists.

**PBKDF2-HMAC-SHA-256**: only when FIPS compliance forbids the others;
≥600,000 iterations (OWASP 2023); not memory-hard, so GPUs love it.

```python
from argon2 import PasswordHasher
ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)   # argon2id by default
h = ph.hash(password)
try:
    ph.verify(h, attempt)
    if ph.check_needs_rehash(h): user.pw_hash = ph.hash(attempt)       # upgrade parameters on login
except VerifyMismatchError: ...
```

```ts
import argon2 from 'argon2';
const hash = await argon2.hash(pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
const ok = await argon2.verify(hash, attempt);
// bcrypt alternative: bcrypt.hash(pw, 12)
```

```go
hash, _ := bcrypt.GenerateFromPassword([]byte(pw), 12)
err := bcrypt.CompareHashAndPassword(hash, []byte(attempt))   // constant-time inside
```

```java
PasswordEncoder enc = new Argon2PasswordEncoder(16, 32, 1, 65536, 3);   // Spring Security
// or DelegatingPasswordEncoder to migrate from older schemes transparently
```

```php
$h = password_hash($pw, PASSWORD_ARGON2ID, ['memory_cost' => 65536, 'time_cost' => 3, 'threads' => 1]);
if (password_verify($attempt, $h) && password_needs_rehash($h, PASSWORD_ARGON2ID, $opts)) { ... }
```

Migration from a weak scheme (MD5, SHA-1, unsalted): wrap the old hash
inside the new one immediately for all users (`argon2id(md5(pw))`), then
on each successful login replace with `argon2id(pw)`. This protects the
whole table on day one rather than waiting for everyone to log in.

Also hash **API keys and tokens** you store server-side, but with plain
SHA-256 (they are high-entropy, so slow hashing is unnecessary and would
hurt request latency); keep a short prefix in cleartext for lookup and
display (`sk_live_abc1...`).

## 7. Key derivation

- **From a password**: argon2id or scrypt (same parameters as §6) with a
  stored random salt, output length = key length. PBKDF2 if forced.
- **From a strong key to several keys**: HKDF-SHA-256 with a distinct
  `info` per purpose (`"encryption-v1"`, `"mac-v1"`) and optionally a salt.
  Never reuse one key for both encryption and MAC, or for two different
  systems.
- **From a shared secret (ECDH output)**: always HKDF; raw ECDH output is
  not uniformly random.

```ts
import { hkdfSync } from 'node:crypto';
const encKey = Buffer.from(hkdfSync('sha256', masterKey, salt, 'app/enc/v1', 32));
const macKey = Buffer.from(hkdfSync('sha256', masterKey, salt, 'app/mac/v1', 32));
```

## 8. Randomness

Anything secret or unguessable (session ids, tokens, nonces, salts, CSRF
tokens, password reset codes, API keys, OTP seeds) comes from the OS
CSPRNG:

| Language | Use | Never |
|---|---|---|
| Node | `crypto.randomBytes(32)`, `crypto.randomUUID()`, `crypto.randomInt(min, max)` | `Math.random()` |
| Browser | `crypto.getRandomValues()`, `crypto.randomUUID()` | `Math.random()` |
| Python | `secrets.token_bytes/token_hex/token_urlsafe(32)`, `secrets.choice`, `os.urandom` | `random.*`, `uuid.uuid1()` |
| Go | `crypto/rand` | `math/rand` (even seeded) |
| Java | `SecureRandom` (default constructor; do not seed it with a constant) | `java.util.Random`, `Math.random()` |
| Ruby | `SecureRandom.hex/base64/urlsafe_base64/uuid` | `rand`, `Random.new` |
| PHP | `random_bytes`, `random_int`, `bin2hex(random_bytes(32))` | `rand`, `mt_rand`, `uniqid`, `md5(microtime())` |
| Rust | `rand::rngs::OsRng`, `getrandom` | `thread_rng` is fine (CSPRNG) but `SmallRng`/`StdRng` seeded deterministically is not |
| .NET | `RandomNumberGenerator.GetBytes/GetInt32` | `System.Random`, `Guid.NewGuid()` for secrets (v4 GUIDs in .NET *are* CSPRNG-backed, but treat as identifiers, not tokens) |

Sizes: 128 bits (16 bytes) minimum for tokens; 256 bits (32 bytes) for
anything long-lived. Encode as base64url or hex; do not truncate. UUIDv4
has 122 random bits, acceptable as a token in a pinch but prefer explicit
`token_urlsafe(32)`. Numeric codes (6-digit OTP) are guessable by design
and must be rate-limited and short-lived.

Not random enough: timestamps, auto-increment ids, `uniqid()`, `hash(time
+ user_id)`, `Math.random` reseeded, anything derived from the request.

## 9. Constant-time comparison and timing side channels

`==` on strings returns at the first differing byte; an attacker measuring
response time can recover a MAC or token byte by byte over the network.
Use the constant-time comparison every library provides:

- Node `crypto.timingSafeEqual(a, b)` (buffers of equal length; check
  length first, or hash both sides to equalize).
- Python `hmac.compare_digest(a, b)`; `secrets.compare_digest`.
- Go `crypto/subtle.ConstantTimeCompare(a, b)` (returns 1/0).
- Java `MessageDigest.isEqual(a, b)`.
- Ruby `ActiveSupport::SecurityUtils.secure_compare`, `OpenSSL.fixed_length_secure_compare`.
- PHP `hash_equals($known, $user)`.
- .NET `CryptographicOperations.FixedTimeEquals`.

```php
// VULNERABLE
if ($computedSig == $_SERVER['HTTP_X_SIGNATURE']) { ... }    // also: loose == with "0e..." magic hashes
// FIXED
if (hash_equals($computedSig, (string) $_SERVER['HTTP_X_SIGNATURE'])) { ... }
```

Apply to: webhook signatures, API key checks (compare hashes), CSRF tokens,
password reset tokens, HMACs of any kind. Do not apply to passwords
(verified by the password hashing library, which handles it) or to
public values.

Related timing leaks: login that returns faster for unknown users (see
`authn-authz-threats.md` §2); cache hits vs misses revealing existence;
decryption errors that distinguish "bad padding" from "bad MAC" (why AEAD
exists).

## 10. Key management

- **Generation**: CSPRNG, full length (32 bytes for AES-256/HMAC/ChaCha);
  never derived from a passphrase a developer typed unless through
  argon2id/scrypt with a stored salt.
- **Storage**: a KMS or secret manager (AWS KMS, GCP Cloud KMS, Azure Key
  Vault, HashiCorp Vault transit) for root keys; the application never
  sees the root key with KMS-backed envelope encryption. Otherwise, the
  secret manager per `secrets.md`. Never in code, config files, or next
  to the data.
- **Envelope encryption**: generate a random data encryption key (DEK) per
  record or per batch; encrypt the data with the DEK (AEAD); encrypt the
  DEK with the key encryption key (KEK) in KMS; store the wrapped DEK with
  the ciphertext. Rotating the KEK means re-wrapping DEKs (cheap), not
  re-encrypting data. This is what every cloud SDK's "encryption client"
  does; Tink's `KmsEnvelopeAead` is a clean implementation.
- **Separation**: one key per purpose and environment. Signing key ≠
  encryption key ≠ MAC key. Prod ≠ staging.
- **Rotation**: key ids in ciphertext/token headers; a key ring where the
  newest encrypts and all still-valid ones decrypt; schedule and on
  compromise. See the rotation table in `secrets.md`.
- **Access**: IAM policies limiting which workloads can `Decrypt` with
  which key; audit logs on every use (CloudTrail for KMS is on by
  default).
- **Backup**: a lost KEK is lost data. KMS handles durability; a self-
  managed key needs an offline, access-controlled backup.
- **Destruction**: crypto-shredding (destroy the key) is how you "delete"
  encrypted data from backups you cannot rewrite; design for it if you
  have retention obligations (see `logging-privacy.md`).

## 11. TLS configuration baselines

Use Mozilla's SSL Configuration Generator ("Intermediate" profile) for
the server you run; the principles:

- TLS 1.2 and 1.3 only (1.3 preferred; 1.0/1.1 off). Drop 1.2 when your
  clients allow.
- 1.2 cipher suites: ECDHE with AES-GCM or ChaCha20-Poly1305 only; no RSA
  key exchange (no forward secrecy), no CBC suites, no 3DES/RC4/NULL/export.
- Certificates: 2048-bit RSA minimum (3072 better) or ECDSA P-256; SHA-256
  signatures; automated issuance and renewal (ACME/Let's Encrypt or your
  CA's automation) so expiry never bites.
- HSTS per `csrf-cors-headers.md`; OCSP stapling on.
- Verify certificates in every client. `verify=False`, `rejectUnauthorized:
  false`, `InsecureSkipVerify: true`, `CURLOPT_SSL_VERIFYPEER => false`, a
  trust-all `X509TrustManager`, `NSAllowsArbitraryLoads` are all the same
  bug: they make TLS decorative. When a dev environment has a self-signed
  cert, add *that* CA to the client's trust store (`NODE_EXTRA_CA_CERTS`,
  `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE`) instead of disabling verification.
- Internal service-to-service: still TLS, ideally mTLS via a mesh or
  SPIFFE; "it is inside the VPC" has been the preamble to many incidents.
- Test with `testssl.sh https://host`, `sslyze`, or SSL Labs.

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_tickets off;
ssl_stapling on; ssl_stapling_verify on;
```

## 12. Common misuse with fixes

| Misuse seen in the wild | Why it is broken | Fix |
|---|---|---|
| `crypto.createCipher('aes-256-cbc', 'password')` (Node) | Key derived from password via MD5, no IV control, no auth | `createCipheriv('aes-256-gcm', key32, randomNonce)`; key from KMS/KDF |
| `Cipher.getInstance("AES")` (Java) | Defaults to ECB with PKCS5 padding | `"AES/GCM/NoPadding"` with `GCMParameterSpec(128, nonce)`; or Tink |
| `openssl_encrypt($d, 'aes-256-cbc', $k, 0, $iv)` with static `$iv` and no HMAC | IV reuse, malleable | `sodium_crypto_secretbox` / `sodium_crypto_aead_xchacha20poly1305_ietf_encrypt` |
| `AES.new(key, AES.MODE_ECB)` (pycryptodome) | ECB | `cryptography` `AESGCM(key).encrypt(nonce, pt, aad)` or Fernet |
| `md5(password + salt)` / `sha256(password)` | Fast hash; GPU cracks billions/s | argon2id / bcrypt (§6); migrate by wrapping |
| `hashlib.sha256(secret + msg)` as a signature | Length extension; not a MAC | `hmac.new(secret, msg, sha256)` |
| `if token == stored_token` | Timing leak | `hmac.compare_digest` |
| `Math.random().toString(36)` for a reset token | Predictable | `crypto.randomBytes(32).toString('base64url')` |
| `new SecureRandom(seed)` with a fixed seed, or `SecureRandom.getInstance("SHA1PRNG")` seeded | Deterministic output | `new SecureRandom()` |
| JWT `HS256` with a human-typed secret, shared with 5 services | Brute-forceable; every verifier can forge | 256-bit random secret from a manager, or switch to `ES256`/`EdDSA` |
| Nonce = counter stored in memory across restarts, or nonce = first 12 bytes of the key | Reuse after restart; fixed nonce | Random nonce per message (XChaCha for volume) or durable counter |
| Encrypting each field with the same key and no AAD | Ciphertexts swappable between rows | AAD = table/column/row id; or per-record DEK |
| `verify=False` to "fix" a cert error in dev, committed | TLS disabled in prod | Trust the dev CA via env var; never commit the flag |
| Storing the KEK in the same database as the DEKs | One leak = everything | KEK in KMS; DEKs wrapped |
| Hashing API keys with bcrypt | 100 ms per request for no benefit | SHA-256 (keys are high-entropy) |
| `uuid.uuid1()` as a token | MAC address + timestamp | `secrets.token_urlsafe(32)` |
| Custom "encryption" with XOR/base64/Caesar | Not encryption | Any AEAD |
| Home-grown JWT parsing (`split('.')`, `JSON.parse(atob(...))`) | Skips signature | `jose`/`PyJWT`/`golang-jwt` with pinned algorithms |

## 13. Tests and detection

```bash
# Weak or misused primitives
rg -n "createCipher\(|MODE_ECB|\"AES\"\)|/ECB/|DES|RC4|Blowfish|MD5|md5\(|sha1\(|SHA1|SHA-1|Rijndael|TripleDES|mcrypt_"
# Weak randomness in security contexts
rg -n "Math\.random\(\)|random\.(random|randint|choice)\(|java\.util\.Random|mt_rand\(|\brand\(\)|uniqid\(|math/rand" | rg -i "token|secret|key|nonce|salt|session|password|otp|code"
# Non-constant-time compares near secrets
rg -n "(token|signature|sig|hmac|digest|secret|api_key|apiKey)\s*(===?|!==?|\.equals\()" 
# TLS verification disabled
rg -n "verify\s*=\s*False|rejectUnauthorized:\s*false|InsecureSkipVerify:\s*true|CURLOPT_SSL_VERIFYPEER.*false|TrustAllCerts|NSAllowsArbitraryLoads|ALLOW_ALL_HOSTNAME_VERIFIER|check_hostname\s*=\s*False"
# Hard-coded keys/IVs
rg -n "(iv|nonce|key|secret)\s*=\s*(b?['\"][A-Za-z0-9+/=]{8,}['\"]|Buffer\.from\(['\"]|new byte\[\]\s*\{|bytes\.fromhex)"
```

Semgrep rulesets: `p/secure-defaults`, `p/insecure-transport`, `p/jwt`,
plus the language packs (they include weak-crypto and weak-random rules).
`bandit` (B303-B311 weak hashes/random, B413 pycrypto), `gosec` (G401-G405,
G501-G505), `find-sec-bugs` (CIPHER_INTEGRITY, ECB_MODE, STATIC_IV,
PREDICTABLE_RANDOM, WEAK_MESSAGE_DIGEST), `brakeman`, `psalm` taint rules.

Tests worth writing: encrypt-then-tamper-one-byte must throw; two
encryptions of the same plaintext must differ (nonce randomness); a
ciphertext decrypted with wrong AAD must throw; password hash output
starts with `$argon2id$` / `$2b$12$`; the token generator produces
distinct 32-byte outputs over 10k iterations; the webhook verifier
rejects a signature off by one byte and a timestamp outside the window.

Cross-references: password policy and credential-stuffing in
`authn-authz-threats.md`; JWT validation in the same file; secret storage
and rotation in `secrets.md`; TLS headers in `csrf-cors-headers.md`;
mobile Keychain/Keystore in `mobile-security.md`.
