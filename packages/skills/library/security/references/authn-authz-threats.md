# Authentication and authorization: the threat side

How login, sessions, tokens, OAuth, and permission checks get attacked, and
the design choices that make the attacks fail. This file is the threat and
testing view; how to *implement* sessions, password reset, OAuth clients
and middleware is `backend/references/auth-implementation.md`. Read both
when building anything with a login.

## Contents

1. Threat map: what attackers do to auth
2. Account enumeration
3. Brute force, credential stuffing, and rate limiting that works
4. Passwords per NIST 800-63B (what to require and what to stop requiring)
5. Sessions: fixation, hijacking, lifetime, and storage trade-offs
6. JWT pitfalls and the validation checklist
7. OAuth 2.0 / OIDC misconfigurations
8. Password reset and magic links
9. MFA threats
10. Authorization: object-level (IDOR) and how to hunt it
11. Authorization: function-level, roles, and deny-by-default
12. Mass assignment
13. Race conditions and TOCTOU in authz-sensitive flows
14. Multi-tenant isolation
15. The authorization test matrix
16. Detection commands

## 1. Threat map

| Attacker wants | Common technique | Primary control |
|---|---|---|
| Valid credentials | Credential stuffing (leaked pairs), password spraying, phishing | Rate limiting per account and IP, breached-password check, MFA, WebAuthn |
| To know who has an account | Different responses for existing vs unknown email on login/reset/signup | Uniform responses and timing |
| A session without credentials | Session fixation, XSS stealing tokens, token in URL/logs/referer, CSRF | HttpOnly cookies, regenerate on login, SameSite, no tokens in URLs |
| Someone else's data | IDOR (change the id), missing tenant scope, GraphQL node lookups | Object-level authz in a shared layer; scoped repositories |
| Higher privilege | Role in request body (mass assignment), admin routes unprotected, JWT claim tampering, confused deputy via OAuth | Allowlisted writable fields, deny-by-default routes, signature + claims validation |
| To stay in after revocation | Long-lived JWTs with no revocation, refresh tokens that never rotate | Short access tokens, rotating refresh tokens, server-side session state |
| To take over via reset | Guessable reset tokens, host header poisoning in reset link, token reuse | 128-bit random single-use tokens, canonical host, expiry, invalidate on password change |
| To abuse OAuth | Open redirect_uri, missing `state`, code interception, token swap across clients | Exact redirect URI match, `state` + PKCE, `aud`/`iss` validation |

## 2. Account enumeration

The bug: the app answers differently depending on whether an account
exists. Login says "wrong password" vs "no such user"; signup says "email
already registered"; reset says "we sent an email" vs "no account". The
response body, status code, *timing* (a bcrypt check runs only when the
user exists), and side effects (an email is sent only when the user exists)
all leak.

```python
# VULNERABLE
user = User.query.filter_by(email=email).first()
if not user:
    return jsonify(error="No account with that email"), 404
if not bcrypt.checkpw(password, user.pw_hash):
    return jsonify(error="Incorrect password"), 401

# FIXED: same message, same status, same work
user = User.query.filter_by(email=email).first()
pw_hash = user.pw_hash if user else DUMMY_HASH          # precomputed bcrypt hash of a random string
ok = bcrypt.checkpw(password, pw_hash) and user is not None
if not ok:
    return jsonify(error="Invalid email or password"), 401
```

Signup is the hard case: the user needs to know the email is taken. Options
that do not leak to an attacker but work for a legitimate user: always
respond "check your email to continue", and send either a verification
link (new account) or a "you already have an account, here is a login
link" email (existing). Rate limit by IP and by email regardless.

Password reset: always "If an account exists, we sent instructions."
Enforce the same response time; do the user lookup and the (possible)
send asynchronously.

Severity is usually low-medium on its own, but enumeration feeds credential
stuffing and targeted phishing, and for some products (health, dating,
anything where membership is sensitive) existence itself is the secret.

## 3. Brute force, credential stuffing, and rate limiting

Credential stuffing (trying leaked email:password pairs across sites) is
the most common attack on consumer login endpoints. Pure IP-based rate
limiting fails because the attacker has thousands of IPs; pure account-
based lockout turns into a denial-of-service against your users.

Layered design:

1. **Per-account throttle** with exponential backoff, not hard lockout: after
   5 failures, each further attempt waits 2^n seconds (cap at a few minutes).
   Reset on success. Store the counter server-side keyed by normalized
   username.
2. **Per-IP / per-subnet throttle** at the edge (nginx `limit_req`, Cloud
   Armor, Cloudflare rules, API gateway) with generous limits for a human
   (say 20/min) and alerting on sustained volume.
3. **Global anomaly detection**: failures across all accounts jump 10× →
   require a CAPTCHA/proof-of-work on login for a while, or step up to MFA
   challenge for logins from new devices.
4. **Breached-password check** at signup and password change (Have I Been
   Pwned k-anonymity API, or a local list). Rejecting known-leaked
   passwords does more against stuffing than any complexity rule.
5. **Device/session signals**: new device + new country → email
   notification and, if MFA is enrolled, a challenge.
6. **MFA**, ideally phishing-resistant (WebAuthn/passkeys). TOTP is still
   worth it; SMS is better than nothing and worse than everything else.

Implementation of the throttle store (Redis `INCR` + `EXPIRE`, or a
`login_attempts` table) is in the backend auth reference. The threat-side
requirements: the counter must be keyed by the *normalized* identifier
(lowercase, trimmed, unicode-normalized), the response for throttled must
be uniform (429 with the same body for existing and non-existing
accounts), and the limiter must sit in front of the password check so a
throttled request costs you nothing.

Do not: lock accounts permanently after N failures (the attacker locks
your users out); limit by IP only; apply the limiter after a successful
login path only; forget the mobile/API login endpoint when protecting the
web form.

## 4. Passwords per NIST 800-63B

NIST SP 800-63B (and its 2024 revision) changed the advice most teams still
follow. What to do:

- **Minimum length 8** for user-chosen passwords (15 if the password is the
  only factor); **maximum at least 64**; allow all printable characters
  including spaces and unicode. Normalize (NFKC) before hashing so the
  same password from different keyboards matches.
- **No composition rules** (no "one uppercase, one digit, one symbol").
  They push users to `Password1!` and provide negligible entropy.
- **No periodic rotation.** Force a change only on evidence of compromise.
- **Check against a blocklist** of breached and common passwords, and
  reject context-specific ones (the username, the site name).
- **Show a strength meter** that reflects real estimated entropy (zxcvbn)
  rather than rule compliance; allow paste; offer a "show password"
  toggle.
- **No password hints or knowledge-based questions** ("mother's maiden
  name").
- Hash with argon2id or bcrypt (parameters in `cryptography.md`), never
  with a fast hash, never reversible.

Telling a user "your password must contain a special character" is not
only outdated; it is a signal the rest of the auth stack is probably
outdated too.

## 5. Sessions: fixation, hijacking, lifetime, storage

**Fixation**: the attacker sets a session id in the victim's browser (via a
URL parameter, a cookie injected from a subdomain, or a pre-login visit),
the victim logs in, and the attacker now holds an authenticated session.
Fix: issue a *new* session id on every privilege change (login, role
change, step-up MFA) and never accept session ids from URLs.

```ruby
# Rails: reset_session before sign-in (Devise does this; hand-rolled auth often forgets)
def create
  user = User.authenticate(params[:email], params[:password])
  if user
    reset_session                       # new id, drops anything the attacker fixed
    session[:user_id] = user.id
    ...
```

```python
# Django: login() rotates the session key by default (cycle_key). If using a custom
# session mechanism, call request.session.cycle_key() after authentication.
```

**Hijacking**: stealing the token. Vectors: XSS reading a non-HttpOnly
cookie or localStorage; token in a URL (ends up in logs, history, Referer);
network interception without TLS; malware. Controls: `HttpOnly; Secure;
SameSite=Lax` (or `Strict`) cookies; HSTS; never put tokens in URLs; bind
sessions loosely to client properties (alert, do not hard-fail, on IP/UA
change, because mobile networks change IPs constantly).

**Lifetime**: an idle timeout (15 min for sensitive apps, hours for consumer
apps) and an absolute timeout (8-24 hours, or days with "remember me" via a
separate long-lived token that can only mint sessions, not act). Logout
must invalidate server-side, not just delete the cookie. Password change
and "log out everywhere" must invalidate all other sessions.

**Storage trade-offs (browser):**

| Where | XSS can steal it | CSRF applies | Notes |
|---|---|---|---|
| Cookie `HttpOnly; Secure; SameSite=Lax/Strict` | No (cannot read it) but can *use* it via same-origin requests from injected script | Yes (needs CSRF defense), largely mitigated by SameSite | Default choice for web apps |
| `localStorage` / `sessionStorage` | Yes, fully | No | Any XSS = token theft and offline use. Only acceptable when there is no cookie option (some cross-origin SPA setups), and then with short-lived tokens |
| In-memory JS variable | Yes while the page lives, not persisted | No | Good for access tokens with a refresh token in an HttpOnly cookie (BFF pattern) |
| Authorization header from a native app | n/a (secure storage, see `mobile-security.md`) | No | Keychain/Keystore |

The common AI-generated mistake is "JWT in localStorage, sent as Bearer, to
avoid CSRF". That trades a solved problem (CSRF, see
`csrf-cors-headers.md`) for an unsolved one (XSS steals a bearer token with
hours of validity). Prefer the cookie, or the backend-for-frontend pattern
where the browser only ever holds an HttpOnly session cookie and the BFF
holds the tokens.

## 6. JWT pitfalls and the validation checklist

JWTs are fine as short-lived, signed access tokens between services, and
a frequent source of bugs when used as sessions. Every one of these has
shipped in real products:

| Pitfall | What happens | Fix |
|---|---|---|
| Accepting `alg: none` | Unsigned token accepted | Pin the algorithm server-side; never read `alg` from the token to choose verification |
| Algorithm confusion (RS256 key used as HS256 secret) | Attacker signs with the public key | Pin the algorithm per key; use libraries that take an explicit `algorithms=[...]` |
| Weak HMAC secret (`secret`, `changeme`, a short string) | Offline brute force | 256-bit random secret from a secret manager; prefer asymmetric (RS256/ES256/EdDSA) so verifiers never hold a signing key |
| No `exp` or multi-day `exp` | Stolen token works forever | 5-15 min access tokens; refresh tokens rotate |
| No `aud`/`iss` check | Token for service A accepted by service B | Validate `iss` and `aud` exactly; one audience per API |
| Trusting `kid`/`jku`/`x5u` headers blindly | Key fetched from attacker URL, or path traversal in `kid` | Allowlist key ids to a local JWKS; fetch JWKS only from the configured issuer URL |
| Sensitive data in payload | Payload is base64, not encrypted; anyone with the token reads it | Put identifiers in, not PII; use JWE if you truly need encryption (you probably want a session instead) |
| No revocation | Logout and "deleted user" do nothing until expiry | Short expiry + a denylist for the rare early revoke, or just use server-side sessions |
| Verifying with `decode` instead of `verify` | Signature never checked | `jwt.verify` / `jwt.decode(verify=True)`; grep for `decode(` with `verify: false` / `verify_signature=False` / `algorithms` missing |
| Clock skew intolerance or too much tolerance | Random failures, or expired tokens accepted | Allow ~30-60 s leeway, no more |

```js
// VULNERABLE: decode() does not verify; alg taken from token
const payload = jwt.decode(token);                       // anyone can forge this
const payload2 = jwt.verify(token, secret);              // alg not pinned; HS/RS confusion possible with a public key as `secret`

// FIXED (jose)
import { jwtVerify, createRemoteJWKSet } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://issuer.example/.well-known/jwks.json'));
const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://issuer.example',
  audience: 'api://orders',
  algorithms: ['ES256'],
  clockTolerance: 30,
});
```

```python
# PyJWT: always pass algorithms explicitly and verify aud/iss
payload = jwt.decode(token, key, algorithms=["RS256"], audience="api://orders", issuer="https://issuer.example")
```

```go
// golang-jwt: check the signing method inside the key func
tok, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
    if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok { return nil, fmt.Errorf("unexpected alg") }
    return pubKey, nil
}, jwt.WithAudience("api://orders"), jwt.WithIssuer("https://issuer.example"), jwt.WithExpirationRequired())
```

## 7. OAuth 2.0 / OIDC misconfigurations

Use authorization code flow with PKCE for every client type (public and
confidential). Implicit flow and resource-owner password flow are
deprecated. The misconfigurations:

- **Loose `redirect_uri` matching** (prefix match, wildcard subdomains,
  ignoring path/query). The authorization code is sent to the attacker's
  URL. Register exact URIs; compare byte-for-byte on the server.
- **Open redirect on your own domain** combined with a registered
  `redirect_uri` on that domain: `https://app.example/redirect?to=evil`
  leaks the code via the Referer or the redirect itself. Fix the open
  redirect (`ssrf-and-server-side.md`).
- **Missing or unvalidated `state`**: CSRF on the callback logs the victim
  into the attacker's account (login CSRF) or binds the attacker's
  external account to the victim's. Generate `state` per flow, store it in
  the session, compare on callback.
- **No PKCE on public clients** (SPAs, mobile): code interception via
  custom URL schemes or malicious apps. Use `S256`.
- **Not validating `iss`/`aud`/`nonce` on the ID token**: token substitution
  across clients, replay. Use a certified OIDC library; do not parse
  tokens by hand.
- **Using the access token as proof of identity** ("the Facebook access
  token works, so this is user X"). Access tokens are for the resource
  server; identity comes from the ID token or the userinfo endpoint with
  `sub`, and the token must have been issued to *your* client (`aud`).
- **Account linking by email without verification**: provider returns an
  unverified email; attacker registers at the IdP with the victim's email
  and logs into the victim's account. Check `email_verified`, and link
  only to existing accounts after the user re-authenticates.
- **Long-lived refresh tokens stored in the browser**: see storage table.
  Rotate refresh tokens and detect reuse (a reused rotated token = theft;
  revoke the family).
- **Scope creep**: requesting `offline_access` and broad scopes by
  default. Ask for the minimum; let the user grant more when the feature
  needs it.

The client wiring (library selection, callback handler, token storage on
the server) is in the backend reference.

## 8. Password reset and magic links

The reset token is a credential. Threats and controls:

- Token must be ≥128 bits from a CSPRNG, stored **hashed** (if the DB
  leaks, the tokens are useless), single-use, expiring in 15-60 minutes,
  and invalidated when a new one is requested or the password changes.
- The link's host must come from configuration, never from the `Host`
  header (host header poisoning sends the victim's token to the
  attacker's domain).
- The reset page must not leak the token to third parties: no analytics
  or external scripts on it, `Referrer-Policy: no-referrer`, and ideally
  exchange the URL token for a short-lived session cookie on first load
  and redirect to a clean URL.
- After reset: log out all other sessions, notify the old email, require
  re-authentication for sensitive actions for a while.
- Rate limit reset requests per email and per IP; keep the response
  uniform (§2).

Magic links (passwordless) are the same control set plus: the link should
require a click, not just a fetch (email scanners pre-fetch links and would
consume single-use tokens; use a confirmation page with a POST), and the
login should complete in the browser that requested it if possible (bind
the token to a cookie set at request time).

## 9. MFA threats

- **Enrollment without re-authentication**: an attacker with a stolen
  session enrolls their own device. Require password (or existing factor)
  to add or remove a factor, and notify.
- **Recovery codes** displayed once, stored hashed, single-use.
- **TOTP replay**: accept each code once per time step; store the last
  used counter.
- **Rate limit the second factor** (6 digits is 10^6; without a limit it is
  a brute force in minutes).
- **MFA fatigue / push bombing**: number matching or limited prompts.
- **Phishing**: TOTP and SMS are phishable by real-time relay; WebAuthn is
  not because the signature is origin-bound. Offer passkeys.
- **Account recovery as the weak link**: support staff resetting MFA with
  a phone call is the real bypass. Define the recovery process as part of
  the threat model.

## 10. Object-level authorization (IDOR) and how to hunt it

Insecure Direct Object Reference: the handler takes an identifier and
returns or modifies the object without checking the caller may access
*that* object. It is the top finding in most real-world assessments
because it is invisible to scanners and trivially exploitable with a
browser.

```ts
// VULNERABLE: authenticated, but any invoice id works
router.get('/invoices/:id', requireAuth, async (req, res) => {
  const inv = await Invoice.findByPk(req.params.id);
  res.json(inv);
});

// FIXED: scope the lookup to the caller; 404 if not theirs
router.get('/invoices/:id', requireAuth, async (req, res) => {
  const inv = await Invoice.findOne({ where: { id: req.params.id, accountId: req.user.accountId } });
  if (!inv) return res.sendStatus(404);
  res.json(inv);
});
```

Better than per-handler: a scoped repository or policy layer so the
handler cannot forget.

```python
# Django: a manager that is always scoped
class InvoiceQuerySet(models.QuerySet):
    def for_user(self, user):
        return self.filter(account=user.account)

inv = get_object_or_404(Invoice.objects.for_user(request.user), pk=pk)
```

```ruby
# Rails with Pundit: the policy scope *is* the query
def show
  @invoice = policy_scope(Invoice).find(params[:id])   # raises RecordNotFound → 404 for foreign ids
end
```

Where IDOR hides:

- **Any parameter that is an id**: path, query, body, header
  (`X-Account-Id`), cookie, GraphQL argument, websocket message.
- **Indirect references**: file names, S3 keys, email addresses as ids,
  "slug" fields, order numbers, invoice PDF URLs.
- **Write operations more than reads**: `PUT /users/:id` with `req.body` is
  often both IDOR and mass assignment.
- **Nested resources**: `GET /projects/1/tasks/99` checks project 1 is
  yours but not that task 99 belongs to project 1.
- **Bulk/export endpoints**: `POST /export {ids: [...]}` filters by
  nothing.
- **GraphQL `node(id)`** and dataloaders that fetch by id with no viewer
  context.
- **Background jobs** that take an id from a queue message produced by a
  user action.
- **Unguessable ids are not authorization.** UUIDs reduce enumeration;
  they do not stop an attacker who obtains an id from a shared link, a
  log, an email, or another endpoint.
- **"Sequential ids leak counts"** is a separate, minor concern; fix IDOR
  first.

To hunt it: list every route with a parameter; for each, read the handler
down to the query and ask "where does the caller's identity constrain
this query?" If the answer is "nowhere" or "in the UI", it is a finding.
Then prove it: create two users, create an object as A, request it as B,
expect 403/404.

## 11. Function-level authorization, roles, deny-by-default

The bug: an admin endpoint protected only by not being linked from the UI,
or a role check in the controller that a new route forgot.

```java
// VULNERABLE (Spring): permitAll default with per-method annotations that are easy to forget
http.authorizeHttpRequests(a -> a.anyRequest().permitAll());
@PreAuthorize("hasRole('ADMIN')") @GetMapping("/admin/users") ...   // the one someone forgot has no annotation

// FIXED: deny by default; opt routes in
http.authorizeHttpRequests(a -> a
    .requestMatchers("/", "/login", "/public/**", "/health").permitAll()
    .requestMatchers("/admin/**").hasRole("ADMIN")
    .anyRequest().authenticated());
```

```ts
// Express: mount role middleware on the router, not per route
const admin = Router();
admin.use(requireAuth, requireRole('admin'));
admin.get('/users', listUsers);        // every route here inherits the check
app.use('/admin', admin);
```

Principles: the default for an unmatched route is deny; role checks live
in middleware on route groups, not in handler bodies; the set of public
routes is an explicit, short allowlist you can read in one place; HTTP
method matters (`GET /users/:id` may be allowed where `DELETE` is not;
check that the framework's "any method" routes are not wider than you
think); internal/debug endpoints (`/metrics`, `/actuator`, `/graphql`
playground, `/_debug`) are behind auth or network restrictions.

Role models: keep them simple (RBAC with a handful of roles) until the
product demands relationship-based or attribute-based rules; when it does,
centralize in a policy engine (Casbin, OPA, Oso, Cedar, Pundit/CanCanCan,
CASL) rather than scattering `if (user.role === 'admin' || user.id ===
doc.ownerId || ...)`. Test the policy, not the handlers.

## 12. Mass assignment

The bug: the handler writes request body fields straight into the model,
so a client adds `role: "admin"`, `isVerified: true`, `balance: 10000`, or
`accountId: <other tenant>`.

```js
// VULNERABLE
const user = await User.findByPk(req.user.id);
Object.assign(user, req.body);           // body: { "role": "admin" }
await user.save();

// FIXED: explicit allowlist via a schema
const UpdateProfile = z.object({ displayName: z.string().max(80), bio: z.string().max(2000) }).strict();
const data = UpdateProfile.parse(req.body);   // .strict() rejects unknown keys with a 400
await user.update(data);
```

Per stack: Rails strong parameters (`params.require(:user).permit(:name,
:bio)`), Django `ModelForm`/serializer `fields = [...]` (never
`fields = '__all__'` on user-editable models), Spring `@JsonIgnore`/DTOs
instead of binding entities, Laravel `$fillable` (not `$guarded = []`),
Go struct binding into a dedicated input type, GraphQL input types that
omit privileged fields. Separate "what the user may set" from "what the
system sets" at the type level and the bug cannot occur.

## 13. Race conditions and TOCTOU in authz-sensitive flows

Check-then-act across two requests: "has the coupon been used? no →
apply", "balance ≥ amount? yes → withdraw", "invite still valid? yes →
accept". Two concurrent requests both pass the check. Attackers send 20
requests in the same millisecond.

```sql
-- VULNERABLE (two statements, no lock)
SELECT used FROM coupons WHERE code = $1;     -- false
UPDATE coupons SET used = true WHERE code = $1;

-- FIXED: one atomic conditional update; the row count tells you who won
UPDATE coupons SET used = true, used_by = $2 WHERE code = $1 AND used = false;
-- rows affected = 1 → success; 0 → already used

-- Balance: constraint + atomic decrement
ALTER TABLE accounts ADD CONSTRAINT balance_nonneg CHECK (balance >= 0);
UPDATE accounts SET balance = balance - $1 WHERE id = $2;   -- fails under the constraint if overdrawn
```

Other tools: `SELECT ... FOR UPDATE` inside a transaction; unique
constraints (one redemption per user: `UNIQUE (coupon_id, user_id)`);
idempotency keys on payment endpoints; optimistic locking with a version
column. Application-level mutexes do not work across instances. Rate
limiting reduces but does not fix the window.

Also TOCTOU in files (check path then open; use `O_NOFOLLOW`, open by
descriptor), and in MFA/OTP ("is code valid? → mark used" must be atomic).

## 14. Multi-tenant isolation

Every row that belongs to a tenant carries `tenant_id`; every query is
scoped by it; the scope comes from the authenticated session, never from
the request body. Enforce in a layer the handler cannot skip:

- ORM default scopes / query managers that require a tenant
  (`Invoice.objects.for_tenant(t)`; a repository constructor that takes
  the tenant so an unscoped query is not expressible).
- Postgres row-level security as a backstop: `SET LOCAL app.tenant_id =
  ...` per transaction and `CREATE POLICY ... USING (tenant_id =
  current_setting('app.tenant_id')::uuid)`. The `database` skill covers
  RLS mechanics; the threat point is that RLS catches the handler that
  forgot.
- Separate schemas or databases per tenant for high-isolation needs;
  costs in migrations and connection pooling.

Failure modes to test: joins that pull in another tenant's rows through a
foreign key (`task.project.owner`), search indexes (Elasticsearch,
Algolia) that are not tenant-filtered, caches keyed by object id without
tenant, background jobs and webhooks that resolve ids globally, admin
"impersonate" features that do not scope, file storage paths that do not
include the tenant, and `tenant_id` accepted from the body on create
(mass assignment variant: use the session's tenant).

## 15. The authorization test matrix

For every endpoint, test every row. Write it as a table-driven test so
adding a route means adding a line.

| Principal | Expected on own resource | Expected on other tenant's resource | Expected on admin action |
|---|---|---|---|
| Anonymous | 401 | 401 | 401 |
| User (same tenant, member) | 200 | 404 (or 403, consistently) | 403 |
| User (same tenant, viewer role) | 200 read / 403 write | 404 | 403 |
| Admin of tenant A | 200 | 404 | 200 within tenant A |
| Super admin (if exists) | 200 | 200 with audit log entry | 200 |

```ts
const cases = [
  { who: 'anon',      path: () => `/invoices/${invA.id}`, method: 'get',    expect: 401 },
  { who: 'userB',     path: () => `/invoices/${invA.id}`, method: 'get',    expect: 404 },
  { who: 'userB',     path: () => `/invoices/${invA.id}`, method: 'delete', expect: 404 },
  { who: 'viewerA',   path: () => `/invoices/${invA.id}`, method: 'delete', expect: 403 },
  { who: 'userA',     path: () => `/invoices/${invA.id}`, method: 'get',    expect: 200 },
  { who: 'userA',     path: () => `/admin/users`,         method: 'get',    expect: 403 },
];
for (const c of cases) {
  test(`${c.who} ${c.method.toUpperCase()} ${c.path()} → ${c.expect}`, async () => {
    const res = await as(c.who)[c.method](c.path());
    expect(res.status).toBe(c.expect);
    if (c.expect >= 400) expect(JSON.stringify(res.body)).not.toContain(invA.secretField);
  });
}
```

Also test: ids that exist in another tenant return the same status and
body as ids that do not exist at all (no existence leak); role changes
take effect without re-login if that is the product expectation; a
removed member's existing session cannot act.

## 16. Detection commands

```bash
# Routes with ids: candidates for IDOR review
rg -n "(get|post|put|patch|delete)\(['\"][^'\"]*:(id|[a-zA-Z]+Id)" --type js --type ts
rg -n "path\(.*<(int|uuid|slug):" --type py            # Django
rg -n "@(Get|Post|Put|Delete)Mapping\(.*\{" --type java
# Lookups by id with no second condition
rg -n "findByPk\(|findById\(|find\(params\[:id\]\)|get_object_or_404\([A-Z][A-Za-z]+,\s*pk|\.objects\.get\(pk|First\(&[a-z]+, .*id\)"
# Mass assignment
rg -n "Object\.assign\([a-z]+, req\.body|\.update\(req\.body|params\.permit!|fields\s*=\s*['\"]__all__['\"]|\$guarded\s*=\s*\[\]|\.create\(req\.body"
# JWT misuse
rg -n "jwt\.decode\(|verify:\s*false|verify_signature['\"]?\s*[:=]\s*False|algorithms?\s*[:=]\s*\[?\s*['\"]none"
# Role checks in handlers (should be middleware)
rg -n "role\s*===?\s*['\"]admin['\"]|is_admin|isAdmin\b" | rg -v "middleware|policy|guard"
# Routes that skip auth
rg -n "csrf_exempt|AllowAny|permitAll|skip_before_action :authenticate|@public|allowAnonymous|@SkipAuth"
```

Then run the matrix. A grep finds candidates; only the test confirms.

Cross-references: implementation of sessions, reset flows, OAuth clients
and middleware in `backend/references/auth-implementation.md`; cookie
flags, SameSite and CSRF in `csrf-cors-headers.md`; password hashing
parameters and constant-time comparison in `cryptography.md`; token
storage on mobile in `mobile-security.md`.
