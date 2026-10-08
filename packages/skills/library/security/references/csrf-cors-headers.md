# CSRF, CORS, and security headers

Three topics that get confused with each other and disabled together when a
request fails. CSRF is about a browser sending your cookies on a request the
user did not intend. CORS is about which other origins may *read* responses
from your API. Security headers tell the browser how to treat your pages.
This file explains each mechanism, the correct configurations, the common
wrong ones, and builds a Content Security Policy step by step with nonces,
hashes, and reporting.

## Contents

1. CSRF: how it works and what actually stops it
2. SameSite: the nuances that matter
3. CSRF defenses by framework, and when you can skip them
4. CORS: the mental model
5. CORS configurations: right and wrong
6. Security headers: the full set with working examples
7. Building a CSP step by step
8. Nonce plumbing per framework
9. CSP reporting and rollout
10. Clickjacking and frame protections
11. Cookies: every flag and prefix
12. Testing headers

## 1. CSRF: how it works and what stops it

A user is logged into `bank.example` (session cookie). They visit
`evil.example`, which contains `<form action="https://bank.example/transfer"
method="POST">` and auto-submits it. The browser attaches the bank's
cookies because cookies are sent by *destination*, not by *origin of the
page*. The bank sees an authenticated POST and performs the transfer.

What stops it, in combination:

1. **Same-site cookies** (`SameSite=Lax` or `Strict`): the browser does not
   attach the cookie to cross-site POSTs. This is the modern first line.
2. **A token the attacker cannot read**: synchronizer token (per-session
   random value embedded in the form and checked on submit) or signed
   double-submit cookie (token in a cookie *and* in the body/header; the
   attacker can make the browser send the cookie but cannot read it to
   copy into the body). Cross-origin pages cannot read your responses or
   your cookies (that is the same-origin policy), so they cannot obtain the
   token.
3. **Origin checks**: compare `Origin` (or `Referer`) header to your own
   origin, or check `Sec-Fetch-Site` (`same-origin`/`none` are fine,
   `cross-site` is not). Browsers set these; a cross-site form post has
   `Origin: https://evil.example` and `Sec-Fetch-Site: cross-site`.
4. **Custom header requirement for APIs**: a cross-site form cannot set
   `X-Requested-With` or `Content-Type: application/json`; a cross-site
   `fetch` that tries triggers a CORS preflight that you do not approve.
   This only protects endpoints that *require* the header or JSON content
   type; endpoints that also accept form-encoded bodies are not covered.
5. **No state change on GET.** `<img src="https://bank.example/delete?id=1">`
   is a GET the browser makes with cookies. If GET mutates, nothing above
   fully saves you.

Who is at risk: anything authenticated by a cookie (or HTTP Basic auth, or
client certificates), which is every traditional web app and every SPA that
uses a session cookie. Who is not: an API authenticated *only* by an
`Authorization: Bearer` header that the browser does not attach
automatically. If you accept both cookies and bearer tokens on the same
endpoint, you are at risk.

## 2. SameSite: the nuances

- **`Strict`**: cookie never sent on cross-site requests, including when the
  user clicks a link from another site to yours. The user arrives logged
  out on that first navigation. Good for the session cookie of a sensitive
  app that is not entered via external links; often used for a second
  "sensitive action" cookie.
- **`Lax`**: cookie sent on cross-site *top-level navigations* with safe
  methods (GET link clicks, redirects), not on POSTs, iframes, images,
  fetch. Default in Chromium when the attribute is missing ("Lax by
  default"), but **with a 2-minute exception**: cookies set without
  SameSite in the last 2 minutes are sent on cross-site POSTs (for the
  OAuth/SSO redirect-POST dance). Set it explicitly to get real `Lax`.
- **`None`**: sent cross-site; requires `Secure`. Needed for cookies used in
  cross-site iframes (embedded widgets, some payment flows) and for
  cross-site API calls with `credentials: 'include'`.
- "Site" means registrable domain + scheme (`https://app.example.com` and
  `https://api.example.com` are *same site*; `http://` vs `https://` are
  not, since "schemeful same-site"). So SameSite does **not** protect
  against an attacker who controls another subdomain of yours (XSS on
  `blog.example.com` can CSRF `app.example.com`), nor against subdomain
  takeover.
- `Lax` does not cover: GET requests that change state (see §1 point 5),
  the 2-minute window, and attacks launched from your own site (XSS, open
  redirect chains, or a sibling subdomain).
- Safari and Firefox do not default to Lax; set it explicitly.

Conclusion: SameSite is a strong layer, not the only one. For cookie-
authenticated state changes, keep a token or an origin check as well.
The cost is low in every framework.

## 3. CSRF defenses by framework

| Framework | Built-in | Enable / verify | Escape hatch to audit |
|---|---|---|---|
| Django | `CsrfViewMiddleware` on by default; `{% csrf_token %}`; `X-CSRFToken` header for AJAX | Check `MIDDLEWARE` still has it; `CSRF_COOKIE_SECURE`, `CSRF_TRUSTED_ORIGINS` for cross-origin forms | `@csrf_exempt` |
| Rails | `protect_from_forgery with: :exception` default in `ApplicationController`; `csrf_meta_tags` for JS | Confirm not overridden; `config.action_controller.forgery_protection_origin_check` (default true) | `skip_before_action :verify_authenticity_token`, `protect_from_forgery with: :null_session` on cookie-authed controllers |
| Laravel | `VerifyCsrfToken` middleware in `web` group; `@csrf` blade directive | API group has no CSRF (uses token auth); do not put cookie-authed routes there | `$except` array in the middleware |
| Spring Security | CSRF on by default for non-GET; `CookieCsrfTokenRepository.withHttpOnlyFalse()` for SPAs | 6.x requires the `XorCsrfTokenRequestAttributeHandler` for SPA setups; follow the docs | `.csrf(csrf -> csrf.disable())` |
| ASP.NET Core | `[ValidateAntiForgeryToken]`, `AutoValidateAntiforgeryToken` filter | Add the global filter | `[IgnoreAntiforgeryToken]` |
| Express / Node | Nothing built in; `csurf` is deprecated | Use `csrf-csrf` (double submit), `@fastify/csrf-protection`, or framework-level (Next.js server actions have origin checks built in; Remix/SvelteKit check `Origin` on form actions by default) | Any route accepting cookie auth without the middleware |
| Flask | Nothing built in | `Flask-WTF` `CSRFProtect(app)` | `@csrf.exempt` |
| FastAPI / Starlette | Nothing built in | Use bearer tokens for APIs; if cookie sessions, add `starlette-csrf` or an `Origin`/`Sec-Fetch-Site` check middleware | |
| Go (net/http, chi, gin, echo) | Nothing built in | `gorilla/csrf`, `justinas/nosurf`, or echo/gin CSRF middleware; or a `Sec-Fetch-Site` check | |
| Phoenix | `protect_from_forgery` plug in the browser pipeline | Confirm pipeline membership | Routes in `:api` pipeline with session auth |
| SvelteKit | `csrf.checkOrigin: true` default for form actions | Keep it | `csrf: { checkOrigin: false }` |
| Next.js | Server Actions check `Origin` vs `Host`; API routes do not | For `pages/api` or route handlers with cookie auth, check `Origin`/`Sec-Fetch-Site` yourself | |

A minimal origin-check middleware when the framework has none:

```ts
// Reject cookie-authenticated state changes that did not come from our origin.
const ALLOWED = new Set(['https://app.example.com']);
export function csrfOriginCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sfs = req.get('Sec-Fetch-Site');
  if (sfs && (sfs === 'same-origin' || sfs === 'none')) return next();
  const origin = req.get('Origin') ?? (req.get('Referer') && new URL(req.get('Referer')).origin);
  if (origin && ALLOWED.has(origin)) return next();
  return res.status(403).json({ error: 'cross-site request rejected' });
}
```

Browsers send `Sec-Fetch-Site` on all requests (not available to attackers
to forge); `Origin` is sent on POST and on all CORS requests; `Referer`
may be stripped by privacy settings, which is why it is the last fallback
and a missing header should fail closed on sensitive endpoints.

When you can skip CSRF tokens: the endpoint accepts *only* `Authorization`
header auth and rejects cookie-based requests. Not "mostly", not "the SPA
uses bearer", but the server refuses to authenticate via cookie on that
route. Write that decision down next to the route.

Login CSRF is also real: the attacker submits *their* credentials into
your login form from their site, the victim ends up logged into the
attacker's account and later enters data into it. Protect the login form
too.

## 4. CORS: the mental model

The same-origin policy stops `evil.example`'s JavaScript from *reading*
responses from `api.example.com`. CORS is the mechanism by which
`api.example.com` relaxes that for specific origins. Three facts clear up
most confusion:

1. CORS is enforced by the browser and only matters for browser-based
   callers. `curl`, mobile apps and servers ignore it. CORS is not an
   authentication or access-control mechanism.
2. CORS does not stop the request from *arriving* (for "simple" requests,
   like a form POST or a GET); it stops the attacker's page from reading
   the response. Blocking the request requires a preflight, which only
   happens for non-simple requests (custom headers, JSON content type,
   PUT/DELETE).
3. The dangerous combination is `Access-Control-Allow-Origin` echoing an
   arbitrary `Origin` **plus** `Access-Control-Allow-Credentials: true`.
   That means any website can make authenticated requests as the user and
   read the results: it is CSRF plus data theft in one.

`*` with credentials is forbidden by the spec, so people "fix" the error
by reflecting the request origin, which is worse because it looks
deliberate.

## 5. CORS configurations: right and wrong

```ts
// WRONG: reflect any origin with credentials
app.use(cors({ origin: true, credentials: true }));            // `origin: true` reflects the request Origin
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', req.headers.origin); res.set('Access-Control-Allow-Credentials', 'true'); next(); });

// WRONG: regex that is too loose
cors({ origin: /example\.com$/ })                               // matches notexample.com
cors({ origin: /^https:\/\/.*\.example\.com/ })                 // matches https://evil.example.com.attacker.net

// WRONG: null origin allowed (sandboxed iframes, file://, redirects send Origin: null)
cors({ origin: ['null', ...] })

// RIGHT: exact allowlist, Vary, credentials only if needed, limited methods/headers
const ALLOWED = new Set(['https://app.example.com', 'https://admin.example.com']);
app.use(cors({
  origin: (origin, cb) => cb(null, origin !== undefined && ALLOWED.has(origin)),   // false → no CORS headers → browser blocks
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
}));
```

```python
# Django (django-cors-headers)
CORS_ALLOWED_ORIGINS = ["https://app.example.com"]
CORS_ALLOW_CREDENTIALS = True
# never: CORS_ALLOW_ALL_ORIGINS = True together with CORS_ALLOW_CREDENTIALS = True
# CORS_ALLOWED_ORIGIN_REGEXES: anchor them: r"^https://[a-z0-9-]+\.example\.com$"

# FastAPI
app.add_middleware(CORSMiddleware, allow_origins=["https://app.example.com"],
                   allow_credentials=True, allow_methods=["GET","POST","PUT","DELETE"],
                   allow_headers=["Authorization","Content-Type"])
# allow_origins=["*"] with allow_credentials=True is rejected by Starlette; do not work around it
```

```go
// Go (rs/cors)
c := cors.New(cors.Options{
    AllowedOrigins:   []string{"https://app.example.com"},   // no "*" with credentials
    AllowCredentials: true,
    AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE"},
    AllowedHeaders:   []string{"Authorization", "Content-Type"},
    MaxAge:           600,
})
```

```java
// Spring
@Bean CorsConfigurationSource corsConfigurationSource() {
    var cfg = new CorsConfiguration();
    cfg.setAllowedOrigins(List.of("https://app.example.com"));   // not setAllowedOriginPatterns("*")
    cfg.setAllowCredentials(true);
    cfg.setAllowedMethods(List.of("GET","POST","PUT","DELETE"));
    cfg.setAllowedHeaders(List.of("Authorization","Content-Type"));
    var src = new UrlBasedCorsConfigurationSource();
    src.registerCorsConfiguration("/api/**", cfg);
    return src;
}
```

```nginx
# nginx: do not blindly `add_header Access-Control-Allow-Origin $http_origin`
map $http_origin $cors_origin {
    default "";
    "https://app.example.com" $http_origin;
}
add_header Access-Control-Allow-Origin $cors_origin always;
add_header Vary Origin always;
```

When `*` is fine: a truly public, unauthenticated, read-only API (no
cookies, no auth header, nothing user-specific in the response). Then
`Access-Control-Allow-Origin: *` without credentials is correct and
simpler than an allowlist.

Dev convenience: use a dev proxy (Vite `server.proxy`, Next rewrites, CRA
`proxy`) so the browser talks to one origin and no CORS is needed in dev;
do not add `localhost` to the production allowlist. If you must allow
localhost in dev, gate it by environment and make sure the production
config path cannot include it.

## 6. Security headers: the full set

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: <see §7>
X-Content-Type-Options: nosniff
X-Frame-Options: DENY                       (legacy; CSP frame-ancestors supersedes but keep both)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin   (or same-site; cross-origin only for public assets/CDN)
Cross-Origin-Embedder-Policy: require-corp  (only if you need SharedArrayBuffer; it breaks third-party embeds)
Cache-Control: no-store                     (on authenticated/personalized responses)
```

And headers to **remove**: `Server` with version, `X-Powered-By`,
`X-AspNet-Version`, `X-Generator`. Information, not vulnerability, but it
makes targeting easier and shows up in every scan.

What each does and the trap:

- **HSTS**: forces HTTPS for `max-age` after the first visit; `preload`
  gets you into browser lists so even the first visit is HTTPS. Trap: set
  `includeSubDomains` only if every subdomain serves HTTPS; once a browser
  has it, an HTTP-only internal subdomain is unreachable for that user for
  a year. Start with a short `max-age` (e.g. 300) in staging.
- **nosniff**: stops the browser from guessing a content type, so a JSON
  or upload is not treated as HTML/script. Always set it.
- **Referrer-Policy**: `strict-origin-when-cross-origin` (now the browser
  default) sends only the origin cross-site and nothing on HTTPS→HTTP. Use
  `no-referrer` on pages whose URL contains secrets (reset tokens, share
  links).
- **Permissions-Policy**: disable browser features you do not use so an
  XSS or a third-party script cannot use them. Trap: breaks a feature you
  do use (payment request API, camera for QR scanning); list what you need.
- **COOP `same-origin`**: your window is isolated from cross-origin
  openers; defeats some cross-window attacks (XS-Leaks, tabnabbing). Trap:
  breaks OAuth popups that rely on `window.opener` unless you use
  `same-origin-allow-popups`.
- **CORP**: prevents other origins from embedding your resources
  (`<img>`, `<script>` from your API). `same-site` lets your own
  subdomains embed; set `cross-origin` only on assets meant for others.

Framework one-liners that set most of this:

```ts
// Node/Express: helmet sets sensible defaults; configure CSP explicitly (see §7)
import helmet from 'helmet';
app.use(helmet({ contentSecurityPolicy: false /* set separately with nonces */, crossOriginEmbedderPolicy: false }));
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true, preload: true }));
```

```python
# Django settings
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_SSL_REDIRECT = True
SECURE_CONTENT_TYPE_NOSNIFF = True       # default True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
# CSP: django-csp package
```

```ruby
# Rails: config/initializers/content_security_policy.rb for CSP; headers via
config.force_ssl = true                          # HSTS + redirect + secure cookies
config.action_dispatch.default_headers.merge!(
  "X-Frame-Options" => "DENY",
  "Referrer-Policy" => "strict-origin-when-cross-origin",
  "Permissions-Policy" => "camera=(), microphone=(), geolocation=()"
)
```

```java
// Spring Security
http.headers(h -> h
    .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true).preload(true).maxAgeInSeconds(31536000))
    .contentTypeOptions(Customizer.withDefaults())
    .frameOptions(f -> f.deny())
    .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
    .permissionsPolicy(p -> p.policy("camera=(), microphone=(), geolocation=()"))
    .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'; ...")));
```

```nginx
# nginx (or Caddy's `header` directive): set once at the edge; do not also set in the app with different values
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header X-Frame-Options DENY always;
server_tokens off;
```

Set each header in exactly one place. Duplicate CSP headers are
*intersected* by the browser (both must allow), which produces baffling
breakage; duplicate HSTS with different ages is undefined.

## 7. Building a CSP step by step

A CSP that works is built from the app's actual needs, not copied. Steps:

**Step 1. Start strict, report-only.**

```http
Content-Security-Policy-Report-Only:
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self';
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  object-src 'none';
  report-to csp;
  report-uri /csp-report
```

**Step 2. Browse the app and read the reports.** Each violation is either
a legitimate need (add it) or a smell (inline handler `onclick=`, inline
`<script>`, `eval` in a dependency, a third-party you did not know about).

**Step 3. Replace inline scripts with nonces.** Generate a random nonce per
response, put it on every `<script>` tag you emit, and in the header.
Inline event handlers (`onclick="..."`) cannot be nonced; move them to
`addEventListener` in a nonced script.

```http
script-src 'self' 'nonce-R4nd0m...' 'strict-dynamic';
```

`'strict-dynamic'` means: scripts loaded by a nonced script are trusted
(so bundlers' dynamic `import()` and legitimate loaders work) and host
allowlists in `script-src` are ignored. This is what makes the policy
maintainable: you stop chasing CDN hostnames.

**Step 4. Styles.** Many frameworks inject inline styles (CSS-in-JS,
component libraries). Options: nonce them if the library supports it
(Emotion and styled-components accept a nonce); use hashes for a fixed set;
or accept `style-src 'self' 'unsafe-inline'`, which is far less dangerous
than `unsafe-inline` for scripts (CSS injection is a real but much smaller
risk). Do not let the styles problem block shipping a strict `script-src`.

**Step 5. Third parties.** Analytics, payments, chat widgets. Each needs
`script-src` (via strict-dynamic + nonced loader), `connect-src` for its
API, `frame-src` for its iframes, `img-src` for pixels. Prefer loading
them via a nonced loader script you control; if a vendor requires
`unsafe-inline` or `unsafe-eval`, that is information about the vendor.

**Step 6. Hashes for the stubborn few.** A static inline script you cannot
nonce (e.g. a theme-flash preventer in the `<head>` of a static site):
`'sha256-<base64 of the script content>'`. Browsers print the expected
hash in the console on violation. Hashes break on any whitespace change
in the script.

**Step 7. Enforce.** Switch the header name to `Content-Security-Policy`,
keep `report-to`. Keep the report-only header too for a stricter next
version you are testing.

A realistic final policy for an SPA with an API on another origin, a
payment iframe, and an analytics vendor:

```http
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'nonce-{nonce}' 'strict-dynamic';
  style-src 'self' 'nonce-{nonce}';
  img-src 'self' data: https://images.example-cdn.com;
  font-src 'self';
  connect-src 'self' https://api.example.com https://analytics.vendor.example;
  frame-src https://js.payment-vendor.example;
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests;
  report-to csp
```

Things that quietly make a CSP useless: `script-src` containing
`'unsafe-inline'` (nonces are ignored by old browsers only if present
alongside; in modern browsers `unsafe-inline` is ignored when a nonce or
hash is present, but then it protects nothing on old ones either, so drop
it); `data:` or `blob:` in `script-src`; a host allowlist including a CDN
that hosts user content or AngularJS (CSP bypass gadgets); `*.example.com`
when one subdomain has an open redirect or JSONP; missing `object-src` and
`base-uri`.

## 8. Nonce plumbing per framework

```ts
// Express: generate per request, expose to templates, set header
import { randomBytes } from 'node:crypto';
app.use((req, res, next) => {
  res.locals.nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; script-src 'self' 'nonce-${res.locals.nonce}' 'strict-dynamic'; ...`);
  next();
});
// template: <script nonce="<%= nonce %>" src="/app.js"></script>
```

```ts
// Next.js (App Router): middleware sets the nonce in a request header; layout reads it
// middleware.ts
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
// Next reads x-nonce and applies it to its own scripts; for your own <Script>, pass nonce={headers().get('x-nonce')}
```

```python
# Django with django-csp 4.x
CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        "default-src": ["'none'"],
        "script-src": ["'self'", csp.NONCE, "'strict-dynamic'"],
        "style-src": ["'self'", csp.NONCE],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"], "base-uri": ["'none'"], "form-action": ["'self'"], "object-src": ["'none'"],
        "report-uri": ["/csp-report/"],
    }
}
# template: <script nonce="{{ request.csp_nonce }}" src="..."></script>
```

```ruby
# Rails: config/initializers/content_security_policy.rb
Rails.application.configure do
  config.content_security_policy do |p|
    p.default_src :none
    p.script_src  :self, :strict_dynamic
    p.style_src   :self
    p.img_src     :self, :data
    p.connect_src :self
    p.frame_ancestors :none
    p.base_uri :none
    p.form_action :self
    p.object_src :none
    p.report_uri "/csp-report"
  end
  config.content_security_policy_nonce_generator = ->(_req) { SecureRandom.base64(16) }
  config.content_security_policy_nonce_directives = %w[script-src style-src]
end
# javascript_include_tag and javascript_tag nonce: true add the nonce; Turbo/importmaps are supported
```

```go
// Go: generate in middleware, store in context, read in templates
nonce := base64.StdEncoding.EncodeToString(randBytes(16))
w.Header().Set("Content-Security-Policy", fmt.Sprintf("default-src 'none'; script-src 'self' 'nonce-%s' 'strict-dynamic'; ...", nonce))
ctx := context.WithValue(r.Context(), nonceKey, nonce)
// html/template: <script nonce="{{ .Nonce }}" src="/app.js"></script>
```

Nonces must be unpredictable, per response, and never cached: a CDN
caching a page with a fixed nonce makes the nonce public. For statically
generated pages served from a CDN, use hashes instead of nonces.

## 9. CSP reporting and rollout

```http
Reporting-Endpoints: csp="https://app.example.com/csp-report"
Content-Security-Policy: ...; report-to csp; report-uri /csp-report
```

(`report-uri` is deprecated but still the one Firefox honors; send both.)
The endpoint receives JSON (`csp-report` or the Reporting API batch
format). Store, dedupe by `blocked-uri` + `violated-directive` +
`source-file`, and ignore the noise: browser extensions injecting
scripts, `about:blank`, `chrome-extension://`, `moz-extension://`,
`inline` from translation tools. A hosted collector (report-uri.com,
Sentry's CSP endpoint, Datadog) saves the week of building this.

Rollout order: report-only in production for at least a week of real
traffic → fix the legitimate needs → enforce on a percentage or on
internal users first → enforce everywhere → keep report-only for the next
tightening. Never go from nothing to enforced in one deploy; you will
break the checkout page for some browser you did not test.

## 10. Clickjacking and frame protections

An attacker frames your page invisibly and tricks the user into clicking
on it. Defense: `Content-Security-Policy: frame-ancestors 'none'` (or
`'self'`, or the specific partner origins allowed to embed you). Keep
`X-Frame-Options: DENY` (or `SAMEORIGIN`) for old browsers; it cannot
express a partner allowlist, which is why `frame-ancestors` exists.

If your product is *meant* to be embedded (widgets), list the embedding
origins in `frame-ancestors`, set `SameSite=None; Secure` on any cookie
the embed needs, and design the embedded UI so that no single click does
anything irreversible.

`sandbox` on *your* iframes that load third-party or user content:
`<iframe sandbox="allow-scripts" src=...>` (no `allow-same-origin`, no
`allow-top-navigation`, no `allow-forms` unless needed).

## 11. Cookies: every flag and prefix

```http
Set-Cookie: __Host-session=abc; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800
```

- `Secure`: HTTPS only. Always.
- `HttpOnly`: no `document.cookie` access. Always for session/auth cookies.
  (The CSRF token cookie in double-submit designs needs to be readable by
  JS, so it is the exception, and it is not a secret in the same sense.)
- `SameSite`: see §2. `Lax` default, `Strict` for step-up cookies, `None`
  only for embeds.
- `__Host-` prefix: browser enforces `Secure`, no `Domain`, `Path=/`, so a
  subdomain cannot set or shadow it. Use it for the session cookie.
  `__Secure-` is the weaker variant that allows `Domain`.
- `Domain`: omit it. Setting `Domain=example.com` sends the cookie to every
  subdomain, so any subdomain compromise (or a forgotten dev subdomain
  with XSS) leaks it. Share auth across subdomains via a proper SSO flow
  instead if you must.
- `Path`: not a security boundary (same-origin pages can read any path via
  an iframe). Use `/`.
- `Max-Age`/`Expires`: session cookies without them die with the browser,
  but browsers restore sessions, so set an explicit lifetime.
- Size: 4 KB total per cookie; many cookies slow every request. Store a
  session id, not a serialized user.
- Signed/encrypted cookie sessions (Rails, Flask, Express `cookie-session`):
  the key must be from a secret manager, rotation needs key lists, and
  the cookie is a bearer token that cannot be revoked server-side; prefer
  server-side sessions for anything with logout or role changes.

## 12. Testing headers

```bash
# Quick look
curl -sI https://app.example.com | sort
# The script in this skill reports presence and quality
python3 scripts/headers_check.py https://app.example.com
# CORS probe: a disallowed origin should get no ACAO header back
curl -sI -H "Origin: https://not-allowed.example" https://api.example.com/me | rg -i "access-control"
curl -sI -X OPTIONS -H "Origin: https://app.example.com" -H "Access-Control-Request-Method: PUT" https://api.example.com/me
```

```ts
// Integration tests that pin the configuration
test('security headers', async () => {
  const res = await request(app).get('/');
  expect(res.headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  expect(res.headers['content-security-policy']).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(res.headers['x-powered-by']).toBeUndefined();
});
test('CORS does not reflect unknown origins', async () => {
  const res = await request(app).get('/api/me').set('Origin', 'https://evil.example');
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
});
test('cookie flags', async () => {
  const res = await request(app).post('/login').send(creds);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('__Host-session='));
  expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/SameSite=(Lax|Strict)/);
});
test('cross-site POST without token is rejected', async () => {
  const res = await agentLoggedIn.post('/transfer').set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'cross-site').send({ to: 'x', amount: 1 });
  expect(res.status).toBe(403);
});
```

Cross-references: XSS and what CSP catches in `xss-and-output-encoding.md`;
session storage trade-offs in `authn-authz-threats.md`; TLS configuration
in `cryptography.md`; running ZAP against headers in `security-testing.md`.
