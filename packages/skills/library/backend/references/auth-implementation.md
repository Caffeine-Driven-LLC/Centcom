# Auth implementation

How to implement authentication and authorization correctly: sessions vs
JWTs with the honest trade-offs, refresh token rotation, OAuth2/OIDC with
PKCE, password hashing with argon2id parameters, magic links, TOTP MFA,
API keys, service-to-service auth, and where authorization checks live
with policy code in several languages. The threat model (credential
stuffing, session fixation, token theft, IDOR) and the audit checklist
live in `security/references/`; this file is the flow and the code.

## Contents

1. First: use what exists
2. Sessions vs JWT, honestly
3. Cookie-based sessions done right
4. JWT access tokens with refresh rotation
5. OAuth2 / OIDC login with PKCE
6. Password storage: argon2id
7. Signup, login, reset flows
8. Magic links and passwordless
9. MFA with TOTP
10. API keys
11. Service-to-service auth
12. Authorization models: RBAC, ABAC, ReBAC
13. Where the check lives, with code
14. Anti-patterns with fixes

## 1. First: use what exists

If the repo has Devise, Django's auth, Spring Security, Laravel Sanctum/
Fortify, NextAuth/Auth.js, Lucia, Better Auth, Passport, Rodauth, or an
external provider (Auth0, Clerk, Cognito, Keycloak, Supabase Auth,
Firebase), extend it. Hand-rolling a second auth system next to the first
is the single most damaging thing an agent can do in this area. If
nothing exists and the framework has a blessed path (Rails 8 `generate
authentication`, Django `contrib.auth`, Laravel Fortify, Spring Security),
use the blessed path. Only when neither exists do you implement the flows
below by hand, with the libraries named here for the cryptographic parts.

## 2. Sessions vs JWT, honestly

| | Server-side sessions | Stateless JWT access tokens |
|---|---|---|
| Revocation | Immediate: delete the row | Not possible until expiry; needs a denylist (which is state) or very short TTL + refresh |
| Scaling | Needs a shared store (Redis/DB); one lookup per request (fast) | No lookup per request; verification is a signature check |
| Payload | Server holds everything | Claims travel with the token; cannot change until refresh |
| Browser storage | Cookie (httpOnly) | Cookie (httpOnly) or memory; localStorage is XSS-readable |
| Cross-domain / mobile / third parties | Cookies are awkward across domains | Bearer header works everywhere |
| Complexity | Low | Medium (refresh flow, rotation, key management) |
| Typical fit | Monolith or BFF serving a browser app | APIs consumed by mobile apps, SPAs across domains, many services verifying the same identity |

Default for a web app served by its own backend: **cookie sessions**. They
are simpler, revocable, and the framework usually provides them. Default
for an API consumed by mobile clients or multiple services: **short-lived
JWT access tokens (5-15 min) + rotating refresh tokens stored server-side**.
That hybrid gives you stateless verification on the hot path and
revocation via the refresh token table.

Where to keep tokens in a browser: an `httpOnly; Secure; SameSite=Lax`
(or `Strict`) cookie. `localStorage` is readable by any script that runs
on the page (XSS), and the "but CSRF" objection to cookies is answered by
SameSite plus a CSRF token for state-changing requests on `Lax`. Memory-
only (a JS variable) is acceptable for an SPA that refreshes via a cookie-
bound refresh endpoint. The agent-shaped advice "store the JWT in
localStorage" is wrong often enough that you should not give it without
stating the XSS trade-off.

## 3. Cookie-based sessions done right

Session ID: 128+ bits from a CSPRNG (`crypto.randomBytes(32)`,
`secrets.token_urlsafe(32)`, `SecureRandom.hex(32)`), stored as a hash
(SHA-256) in the session table so a database leak does not yield live
sessions. The row: `id_hash, user_id, created_at, last_seen_at,
expires_at, ip, user_agent, revoked_at`.

Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=` (or
session cookie that dies with the browser). `__Host-` prefix if you can
(forces Secure, no Domain, Path=/). Set `Domain` only when subdomains must
share it.

Lifetimes: idle timeout (e.g. 14 days of inactivity, refreshed on use
with a write at most every few minutes to avoid a write per request) plus
absolute timeout (e.g. 90 days). Shorter for admin surfaces.

On login: rotate the session ID (create a new one, delete the anonymous
one) to defeat fixation. On logout: delete the row, clear the cookie. On
password change or "log out everywhere": delete all rows for the user.
Expose "active sessions" to users if the product warrants it; the table
already supports it.

CSRF: with `SameSite=Lax`, top-level cross-site POSTs are blocked by
modern browsers; still add a CSRF token (synchronizer or double-submit)
for state-changing form posts if any older clients or `Strict`-incompatible
flows exist, and check `Origin`/`Sec-Fetch-Site` headers on mutations. For
a JSON API consumed by the same origin with a custom header
(`X-Requested-With` or `Content-Type: application/json` that cannot be
sent by a plain form), the custom-header check is a cheap second line.
Framework middleware exists for all of this; use it.

Sketch (framework-agnostic TS):

```ts
export async function createSession(userId: string, meta: { ip: string; ua: string }) {
  const raw = base64url(crypto.randomBytes(32));
  await db.sessions.insert({ idHash: sha256(raw), userId, expiresAt: addDays(now(), 14), ...meta });
  return raw;   // goes into the cookie; never stored
}
export async function readSession(cookie: string | undefined) {
  if (!cookie) return null;
  const s = await db.sessions.findOne({ idHash: sha256(cookie), revokedAt: null });
  if (!s || s.expiresAt < now()) return null;
  if (s.lastSeenAt < addMinutes(now(), -5)) await db.sessions.update(s.id, { lastSeenAt: now(), expiresAt: addDays(now(), 14) });
  return s;
}
```

## 4. JWT access tokens with refresh rotation

Access token: short-lived (5-15 min), signed with an asymmetric key
(`RS256`/`ES256`/`EdDSA`) when more than one service verifies it (they
only need the public key, published at `/.well-known/jwks.json` with a
`kid` for rotation); `HS256` is acceptable when one service both issues
and verifies. Claims: `iss`, `aud`, `sub`, `exp`, `iat`, `jti`, plus the
minimum needed for authorization (role or tenant). Verify `iss`, `aud`,
`exp`, and the algorithm allowlist on every request; never accept `alg:
none` or let the token choose the algorithm. Use a maintained library
(`jose`, `PyJWT`/`authlib`, `golang-jwt` v5, `nimbus-jose-jwt`,
`jsonwebtoken` crate) and pin the expected algorithm in code.

Refresh token: opaque random string (not a JWT), stored hashed server-
side with `user_id, family_id, expires_at, used_at, revoked_at`, delivered
in an httpOnly cookie scoped to the refresh path (`Path=/auth/refresh`)
for browsers or in the response body for native apps that have secure
storage.

Rotation with reuse detection:

```ts
export async function refresh(presented: string) {
  const row = await db.refreshTokens.findOne({ tokenHash: sha256(presented) });
  if (!row || row.revokedAt) throw unauthenticated();
  if (row.usedAt) {
    // reuse: a stolen token or a race. Revoke the whole family and force re-login.
    await db.refreshTokens.updateMany({ familyId: row.familyId }, { revokedAt: now() });
    throw unauthenticated();
  }
  if (row.expiresAt < now()) throw unauthenticated();
  return db.transaction(async (tx) => {
    await tx.refreshTokens.update(row.id, { usedAt: now() });
    const next = base64url(crypto.randomBytes(32));
    await tx.refreshTokens.insert({ tokenHash: sha256(next), userId: row.userId, familyId: row.familyId, expiresAt: addDays(now(), 30) });
    const access = await signAccessToken({ sub: row.userId, aud: "api", exp: minutesFromNow(10) });
    return { access, refresh: next };
  });
}
```

Allow a small grace window (a few seconds) for the "two tabs refreshed at
once" race if your clients cannot serialize refreshes, or make the client
serialize them. Logout revokes the family. Absolute lifetime per family
(e.g. 30-90 days) forces periodic re-login.

## 5. OAuth2 / OIDC login with PKCE

Use the Authorization Code flow with PKCE for every client type (the
implicit flow and the password grant are deprecated). Use a library
(`openid-client`, `authlib`, `coreos/go-oidc`, Spring Security OAuth2
client, `omniauth`, Socialite, `openidconnect` crate); the sketch is for
understanding and for reviewing what a library does.

```
1. Client generates code_verifier (43-128 chars, CSPRNG) and
   code_challenge = base64url(sha256(code_verifier)); generates state and nonce.
2. Store {state, nonce, code_verifier, redirect_to} server-side keyed by a
   short-lived cookie (or in an encrypted cookie).
3. Redirect to the provider's authorization_endpoint:
   ?response_type=code&client_id=...&redirect_uri=...&scope=openid email profile
   &state=...&nonce=...&code_challenge=...&code_challenge_method=S256
4. Provider redirects back to redirect_uri?code=...&state=...
5. Verify state matches the stored one (CSRF). Exchange code at token_endpoint
   with code_verifier (and client_secret for confidential clients).
6. Validate the ID token: signature against the provider's JWKS, iss, aud,
   exp, nonce matches. Read sub (stable user ID), email, email_verified.
7. Look up or create the local user by (provider, sub), never by email alone
   unless email_verified is true and your policy allows linking.
8. Create your own session (section 3) or issue your own tokens (section 4).
   Do not reuse the provider's access token as your session.
```

Discovery (`/.well-known/openid-configuration`) gives you the endpoints
and JWKS URL; cache JWKS and refetch on unknown `kid`. Store provider
refresh tokens encrypted if you need ongoing API access to the provider
(calendar sync), with the scopes you asked for, and nothing more.

Being an OAuth2 provider yourself (issuing tokens to third-party apps) is
a different project: use Doorkeeper, django-oauth-toolkit, Spring
Authorization Server, Passport, ory/hydra, or a hosted IdP.

## 6. Password storage: argon2id

Use argon2id. Parameters (OWASP 2024 guidance, pick one):
`m=19456 KiB (19 MiB), t=2, p=1` as the minimum; `m=65536 (64 MiB), t=3,
p=4` if you can afford it. Target ~100-500 ms per hash on your server
hardware; measure. Alternatives when argon2 is unavailable: scrypt
(`N=2^17, r=8, p=1`) or bcrypt with cost 12+ (bcrypt truncates at 72
bytes; pre-hash with SHA-256 only if you must accept longer passwords,
and know the pitfalls).

```python
from argon2 import PasswordHasher, exceptions
ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)   # argon2id by default

def hash_password(pw: str) -> str: return ph.hash(pw)

def verify_password(stored: str, pw: str) -> tuple[bool, str | None]:
    try:
        ph.verify(stored, pw)
    except exceptions.VerifyMismatchError:
        return False, None
    rehash = ph.check_needs_rehash(stored)          # params were raised since this was stored
    return True, (ph.hash(pw) if rehash else None)  # caller stores the new hash
```

Node: `argon2` package (`argon2.hash(pw, { type: argon2.argon2id,
memoryCost: 65536, timeCost: 3, parallelism: 4 })`), or `@node-rs/argon2`.
Go: `golang.org/x/crypto/argon2.IDKey` plus your own PHC-string encoding
or `alexedwards/argon2id`. Rust: `argon2` crate with `PasswordHasher`,
run inside `spawn_blocking`. Java: `spring-security-crypto` `Argon2PasswordEncoder`
or `BouncyCastle`. Ruby: `argon2` gem; Devise defaults to bcrypt, which is
fine.

Hash on a worker thread in event-loop runtimes; a 300 ms hash on the main
thread blocks everything. Never truncate, never lowercase, never reject
long passwords below 128 chars (cap at ~1 KB to stop DoS). Check new
passwords against a breach list (haveibeenpwned k-anonymity API) and a
minimum length of 8-12; do not impose composition rules.

Verify with constant-time comparison (the libraries do). Always run the
verify even when the user does not exist (hash a dummy) so timing does
not reveal account existence, and return the same error for "no such
user" and "wrong password".

## 7. Signup, login, reset flows

Signup: validate, hash, insert in a transaction; on unique violation on
email, return the same 200/201 you would otherwise and send an "account
already exists" email instead of a 409 if enumeration matters to you
(consumer products); return 409 if it does not (internal tools). Send the
verification email as a job. Verification token: random 32 bytes, stored
hashed, single-use, 24h expiry.

Login: rate limit per account and per IP (e.g. 5 failures then exponential
delay or temporary lock); verify password (constant time, dummy hash on
unknown user); check MFA (section 9); rotate the session; log the event
with IP and UA; notify on new-device login if the product warrants it.

Password reset: `POST /auth/password-reset` with email always returns 202
regardless; enqueue a job that, if the user exists, generates a random
32-byte token, stores its hash with 15-60 min expiry and single-use flag,
emails a link. `POST /auth/password-reset/confirm` with token + new
password: look up by hash, check expiry and unused, set password,
invalidate all sessions and refresh tokens, mark token used, notify the
user. Never put the user ID in the link; never accept the token via GET
for the state change (GET renders the form, POST submits).

## 8. Magic links and passwordless

Same machinery as reset: random token, hashed at rest, short expiry
(10-15 min), single use, bound to the email it was sent to. On click,
GET renders a confirmation page that POSTs (email scanners follow GET
links and would consume the token). Create the session in the browser
that submitted the POST. Rate limit sends per email and per IP. Passkeys
(WebAuthn) are the stronger passwordless option; use a library
(`@simplewebauthn/server`, `py_webauthn`, `go-webauthn`, `webauthn4j`,
`webauthn-rs`) and never implement the ceremony yourself.

## 9. MFA with TOTP

Enrollment: generate a 20-byte secret, show as `otpauth://totp/Issuer:
user@example.com?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&
period=30` QR code, require one valid code before marking MFA enabled,
store the secret encrypted at rest. Generate 8-10 recovery codes (random,
hashed at rest, single use) and show them once.

Verification: accept the current window and ±1 step (clock drift), reject
a code that was already used in that window (store last used counter),
rate limit attempts (5 per 5 minutes). Libraries: `otplib`, `pyotp`,
`pquerna/otp`, `rotp`, `totp-rs`, `java-otp`. Login becomes two steps:
password → short-lived "MFA pending" state (a server-side flag on a
pre-session, not a full session) → TOTP → full session. Offer WebAuthn as
the stronger second factor when the product allows.

## 10. API keys

Format: a prefix for identification plus a random body, e.g. `sk_live_` +
32 random bytes base62. Store only the SHA-256 of the key; store the first
8 chars in clear for display ("sk_live_a1b2…"). Columns: `key_hash,
prefix, owner_id, scopes[], name, created_at, last_used_at, expires_at,
revoked_at`.

Verification per request: constant-time lookup by hash (the hash itself
makes the DB index lookup safe), check revoked/expired, load scopes,
update `last_used_at` asynchronously or at most once a minute. Scopes are
your authorization input. Send keys in `Authorization: Bearer` (or a
custom header), never in query strings (they end up in logs). Support
rotation: allow two active keys per owner so clients can swap without
downtime. Rate limit per key. Show the full key exactly once at creation.

## 11. Service-to-service auth

Options from simplest to most robust:

- **Network trust** (private network, service mesh with mTLS such as
  Istio/Linkerd/Consul): identity is the certificate; your code does
  nothing. Good when the platform provides it.
- **Shared secret per caller** in a header, compared in constant time.
  Fine for two services, rotation is manual, leaks are wide.
- **OAuth2 client credentials**: each service has a client ID/secret,
  gets a short-lived JWT from the IdP, presents it as Bearer; the callee
  verifies with the IdP's JWKS and checks `aud` and scopes. Standard,
  rotatable, auditable.
- **Cloud-native identity**: AWS SigV4 with IAM roles, GCP service account
  ID tokens, Azure managed identity. No secrets to manage at all; use it
  when both sides are in the same cloud.
- **SPIFFE/SPIRE** for workload identity across clouds.

Whichever you choose, propagate the end-user identity separately (a
signed user token or an `X-On-Behalf-Of` claim inside the service token)
so downstream services can authorize per user, not just per caller.
Secret storage and rotation mechanics: `security/references/`.

## 12. Authorization models: RBAC, ABAC, ReBAC

- **RBAC** (roles → permissions): `admin`, `editor`, `viewer`; a role grants
  a set of permissions; check `can(actor, "order:cancel")`. Simple,
  auditable, fits most B2B apps. Breaks when access depends on the
  resource ("editors can edit *their team's* documents"), which is almost
  immediately.
- **ABAC** (attributes of actor, resource, environment → policy): `allow
  if actor.team == resource.team and resource.status != "locked" and
  time.hour in business_hours`. Expressive; policies as code (OPA/Rego,
  Cedar, Casbin, Oso). Harder to answer "who can access X" without
  evaluating everything.
- **ReBAC** (relationships: actor -member-> team -owns-> folder -contains->
  doc): Google Zanzibar model (SpiceDB, OpenFGA, Ory Keto, Oso/Polar).
  Natural for sharing, hierarchies, Google-Docs-style permissions; answers
  "list everything Alice can see" efficiently via the graph. Overkill for
  a three-role admin panel.

Most apps: RBAC for coarse permissions plus ownership/tenancy checks on
the resource (a small slice of ABAC/ReBAC) written as plain policy
functions. Reach for a policy engine when the rules change independently
of code, span services, or need "list what I can see" at scale. Always
enforce tenancy at the query level too (`WHERE tenant_id = $1`), not only
in the policy; a missed policy call must still not leak another tenant's
rows.

## 13. Where the check lives, with code

Identity is established in middleware (session/token → `actor`). The
authorization decision happens in the application layer, per use case,
after loading the resource, via a policy function that is pure and
unit-tested. Controllers do not decide; repositories do not decide (but
they scope by tenant). Lists are filtered by a policy scope at the query.

TypeScript policy module:

```ts
type Actor = { userId: string; tenantId: string; roles: Role[] };
type Order = { id: string; tenantId: string; customerId: string; status: OrderStatus };

export const orderPolicy = {
  view: (a: Actor, o: Order) => o.tenantId === a.tenantId && (o.customerId === a.userId || hasRole(a, "support", "admin")),
  cancel: (a: Actor, o: Order) => orderPolicy.view(a, o) && ["pending", "paid"].includes(o.status) && (o.customerId === a.userId || hasRole(a, "admin")),
  listScope: (a: Actor) => hasRole(a, "support", "admin") ? { tenantId: a.tenantId } : { tenantId: a.tenantId, customerId: a.userId },
};

export function authorize<T>(allowed: boolean): asserts allowed { if (!allowed) throw errors.forbidden(); }

// use case
export async function cancelOrder(deps: Deps, actor: Actor, orderId: string) {
  const order = await deps.orders.findById(actor.tenantId, orderId);   // tenant-scoped query
  if (!order) throw errors.notFound("order");                           // or 403 → 404 to hide existence
  authorize(orderPolicy.cancel(actor, order));
  return deps.db.transaction(async (tx) => { /* ... */ });
}
```

Python (same shape, Django flavored):

```python
class OrderPolicy:
    @staticmethod
    def can_cancel(actor: User, order: Order) -> bool:
        return order.tenant_id == actor.tenant_id and order.status in {Order.Status.PENDING, Order.Status.PAID} \
            and (order.customer_id == actor.id or actor.has_role("admin"))

    @staticmethod
    def scope(actor: User) -> QuerySet[Order]:
        qs = Order.objects.filter(tenant_id=actor.tenant_id)
        return qs if actor.has_role("support", "admin") else qs.filter(customer=actor)

def order_cancel(*, actor: User, order_id: UUID) -> Order:
    order = get_object_or_404(OrderPolicy.scope(actor), pk=order_id)
    if not OrderPolicy.can_cancel(actor, order):
        raise PermissionDenied
    ...
```

Go:

```go
func (p OrderPolicy) CanCancel(a Actor, o Order) bool {
    return o.TenantID == a.TenantID && (o.Status == StatusPending || o.Status == StatusPaid) && (o.CustomerID == a.UserID || a.HasRole(RoleAdmin))
}

func (s *Service) Cancel(ctx context.Context, a Actor, id string) (*Order, error) {
    o, err := s.store.Get(ctx, a.TenantID, id)
    if err != nil { return nil, err }                      // wraps ErrNotFound
    if !s.policy.CanCancel(a, *o) { return nil, ErrForbidden }
    ...
}
```

Rails with Pundit, Laravel with policies, Spring with `@PreAuthorize
("@orderPolicy.canCancel(authentication, #id)")` or a plain method call in
the service, all follow the same rule: load, check with the loaded
resource, then act. Test the policy directly (table of actor × resource ×
expected) and test one forbidden case through HTTP per endpoint.

Fail closed: an unknown role, a missing tenant, a policy that throws, all
deny. Log denials at `warn` with actor and resource IDs (no PII) so an
attack or a bug is visible.

## 14. Anti-patterns with fixes

- **Hand-rolled session IDs** (`userId + ":" + Date.now()`), MD5 passwords,
  homemade JWT parsing. Fix: sections 3, 4, 6 with the named libraries.
- **JWT in localStorage with no discussion.** Fix: httpOnly cookie or
  memory + cookie-bound refresh; state the trade-off.
- **Long-lived JWTs (24h+) with no refresh or revocation.** Fix: 5-15 min
  access + rotating refresh.
- **Accepting `alg` from the token.** Fix: pin the algorithm in the
  verifier.
- **Refresh tokens that never rotate**, or rotation without reuse
  detection. Fix: section 4.
- **OAuth without `state` or PKCE**, or trusting the provider's email to
  link accounts. Fix: section 5.
- **bcrypt cost 4, or SHA-256 of the password.** Fix: argon2id with the
  parameters above.
- **Different error messages for "no user" vs "bad password"**, or
  returning 404 on login for unknown emails. Fix: one message, dummy hash.
- **Password reset token in a GET that performs the change**, or the user
  ID in the link. Fix: random token, hashed, POST to confirm.
- **Authorization in the controller via `if (user.role === "admin")`
  scattered everywhere**, and the new endpoint forgets it. Fix: policy
  module, check in use case, forbidden test per endpoint.
- **Checking permission before loading the resource** (can't check
  ownership). Fix: load, then check.
- **Lists filtered in memory after fetching everything.** Fix: policy
  scope at the query.
- **API keys stored in clear, or sent in query strings.** Fix: hash at
  rest, Bearer header.
- **Service-to-service with a hardcoded shared secret in the repo.** Fix:
  env/secret manager (see `security`), or client credentials / platform
  identity.
- **MFA verified but the pre-MFA state is already a full session.** Fix:
  pending state, promote on success.
