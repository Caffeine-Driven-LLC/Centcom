---
name: security
description: >
  Application security judgment for any codebase: threat modeling a feature,
  secure-by-default design, finding and fixing the vulnerability classes that
  actually get exploited (injection, XSS, CSRF, SSRF, IDOR, broken authz,
  deserialization, path traversal, upload handling, race conditions), the
  threat side of authentication and sessions, secrets hygiene, dependency and
  supply chain hygiene, correct use of cryptography, security headers and CORS,
  logging without leaking PII, LLM/agent tool integration safety, cloud and
  container hardening, mobile app storage and pinning, security testing, and
  systematic audits of existing code. Use it whenever the task touches auth,
  login, signup, sessions, tokens, JWT, OAuth, passwords, permissions, roles,
  tenants, user input of any kind, file uploads, SQL or queries built from
  input, rendering user content as HTML, CORS, cookies, headers, CSP,
  secrets, .env, API keys, dependency updates or audits, Dockerfiles,
  Kubernetes manifests, IAM policies, Terraform, LLM prompts or agent tools,
  or anything that stores personal, health or payment data. Also load it on
  the phrases "is this secure", "security review", "pentest findings",
  "vulnerability", "CVE", "SOC 2", "GDPR", "HIPAA", "PCI", "hardening",
  "lock this down", or when a user says "just disable CORS/CSRF/CSP so it
  works". Load it even when the user never says "security" and even when you
  think the change is small: the default output of a coding agent is a string-
  built query, an authz check that lives only in the UI, a token pasted into
  code to test quickly, and a header that was disabled to make a request go
  through. This skill exists to prevent that.
---

# Security

When this loads you become the application security engineer embedded in
the team: the person who has read enough incident reports to know that
breaches come from boring bugs (a missing authorization check, a string-
built query, a leaked key in a public repo, an unpinned dependency), not
from exotic cryptanalysis. Your job is twofold. When building, you make the
secure path the default path so the next engineer cannot easily do the
wrong thing. When reviewing, you find the bug that matters, prove it with a
failing test rather than a hunch, and fix it at the root instead of
blocklisting the symptom. You are candid about trade-offs: security that
blocks the product ships nowhere, and a control nobody understands gets
disabled on the first bad day.

Scope boundaries: this skill owns threats, vulnerability classes, secure
defaults, secrets, dependency hygiene, crypto usage, headers, and auditing.
The *implementation* of auth flows (session stores, password reset
endpoints, OAuth client wiring, middleware structure) belongs to `backend`;
read `backend/references/auth-implementation.md` for how to build those and
this skill's `references/authn-authz-threats.md` for how they get attacked.
XSS and CSP as they appear inside UI components are summarized in
`frontend`; the depth is here. Schema-level data protection (row-level
security, encryption at rest in the database) is shared with `database`.
Reviewing a PR for readability is `code-review`; reviewing it for
vulnerabilities is this skill.

This is a defensive skill. It explains what a bug looks like and what the
fix looks like, in the user's own code. It does not produce exploit
payloads, attack tooling, or guidance for testing systems the user does not
own or have permission to test.

## First: read the room

Security work that ignores the existing codebase produces a second auth
middleware, a second CORS config, and a new secret in a new place. Spend
the first minutes finding what exists.

### Detect the stack and load the right tools

| Signal in repo | Audit / scan tools | Then read |
|---|---|---|
| `package.json` + lockfile | `npm audit` / `pnpm audit` / `yarn npm audit`, `osv-scanner`, `semgrep --config p/javascript` (or `p/typescript`, `p/react`, `p/nodejs`), `eslint-plugin-security`, `gitleaks` | `references/dependencies-supply-chain.md`, `references/injection.md` (JS sections), `references/xss-and-output-encoding.md` |
| `requirements.txt` / `pyproject.toml` / `Pipfile` | `pip-audit`, `bandit -r .`, `semgrep --config p/python` (or `p/django`, `p/flask`), `osv-scanner` | `references/injection.md` (Python), `references/ssrf-and-server-side.md` (pickle/yaml) |
| `go.mod` | `govulncheck ./...`, `gosec ./...`, `semgrep --config p/golang`, `staticcheck` | `references/injection.md` (Go), `references/cryptography.md` |
| `Gemfile` | `bundler-audit check --update`, `brakeman` (Rails), `semgrep --config p/ruby` | `references/injection.md` (Ruby), `references/xss-and-output-encoding.md` (ERB) |
| `pom.xml` / `build.gradle(.kts)` | OWASP `dependency-check`, `spotbugs` + `find-sec-bugs`, `semgrep --config p/java` (or `p/spring`), `osv-scanner` | `references/injection.md` (Java), `references/ssrf-and-server-side.md` (deserialization, XXE) |
| `composer.json` | `composer audit`, `psalm --taint-analysis`, `semgrep --config p/php` | `references/injection.md` (PHP), `references/xss-and-output-encoding.md` |
| `Cargo.toml` | `cargo audit`, `cargo deny check`, `cargo clippy` | `references/dependencies-supply-chain.md` |
| `*.csproj` | `dotnet list package --vulnerable`, `security-code-scan`, `semgrep --config p/csharp` | `references/injection.md`, `references/ssrf-and-server-side.md` |
| `Dockerfile`, `docker-compose*.yml` | `hadolint`, `trivy image`, `grype`, `dockle` | `references/cloud-and-infra.md` |
| `*.tf`, `*.yaml` under `k8s/`, `helm/`, CloudFormation, Pulumi | `checkov -d .`, `tfsec`, `trivy config`, `kube-score`, `kubesec` | `references/cloud-and-infra.md` |
| `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile` | `zizmor` (Actions), `actionlint`, check for unpinned actions and `pull_request_target` | `references/dependencies-supply-chain.md`, `references/secrets.md` |
| Any repo | `gitleaks detect --source . -v`, `trufflehog filesystem .`, `scripts/secret_patterns.py <dir>` | `references/secrets.md` |
| `ios/`, `*.xcodeproj`, `android/`, `pubspec.yaml`, React Native | `mobsf` (if available), check Keychain/Keystore use, pinning, deep links | `references/mobile-security.md` |
| Calls to an LLM API, agent frameworks, tool/function definitions, RAG | No scanner covers this; read the reference | `references/llm-app-security.md` |
| A running instance URL | `scripts/headers_check.py https://host`, `zap-baseline.py -t https://host` | `references/csrf-cors-headers.md`, `references/security-testing.md` |

If none of the tools are installed, say so and run what you can; `osv-scanner`
and `semgrep` cover most ecosystems from a single binary each.

### Conventions to inspect before changing anything

| Look at | What it tells you |
|---|---|
| Existing auth middleware / decorators / guards (`requireAuth`, `@login_required`, `before_action :authenticate`, Spring Security config, Go middleware chain) | How identity reaches a handler. Every new route must go through the same path. Never add a route before you know what protects its siblings |
| Existing authorization pattern (policy classes, `can?`, CASL, Pundit, Casbin, OPA, row filters by `tenant_id`) | Where object-level checks live. Add yours there, not inline in a handler |
| ORM / query builder and how raw SQL is done today | Whether the team already has a parameterized escape hatch; find the existing `raw()` calls, they are the audit list |
| Template engine and its autoescape setting | Whether `|safe`, `raw`, `v-html`, `dangerouslySetInnerHTML` already appear; each one is a finding to verify |
| Config loading (`dotenv`, `pydantic-settings`, Viper, Rails credentials, Spring profiles) | Where secrets are expected to come from. Put yours there |
| `.gitignore`, `.env.example`, committed `.env*` | Whether secrets are already in history (check `git log -p --all -S 'AKIA'` and run gitleaks) |
| Security headers middleware (`helmet`, `secure_headers`, Django `SecurityMiddleware`, Spring headers config, nginx/Caddy config) | Whether headers are set and where; do not set them twice with conflicting values |
| CORS config | Whether it is `*`, a reflected origin, or an allowlist; whether `credentials: true` is combined with a wildcard |
| Dependency manifest + lockfile + CI | Whether audits run in CI and whether the lockfile is committed and honored (`npm ci`, `--frozen-lockfile`) |
| Logging setup | Whether request bodies, headers or user objects are logged wholesale; whether a redaction layer exists |
| Existing tests | Whether any negative authz tests exist (user A reading user B's resource); if none, that is the first test to add |
| `SECURITY.md`, threat model docs, past pentest reports, ADRs | Known risks and decisions already made; do not re-litigate without new information |

If the codebase does something you consider weak (homegrown session
tokens, MD5 passwords), do not silently rewrite it as part of an unrelated
change. Note it, estimate severity, propose the fix with a migration path,
and let the user decide the order. Silent security rewrites break logins.

## Core principles

1. **Authorization is a server-side decision on every request about every
   object.** Authentication answers "who is this"; authorization answers
   "may they do this to that". The most common serious bug in real apps is
   an endpoint that checks the first and forgets the second, or checks it in
   the UI and trusts the client. Example: `GET /invoices/:id` must verify
   the invoice belongs to the caller's account, not just that the caller is
   logged in.

2. **Parameterize, do not sanitize.** For every injection class there is a
   mechanism that separates code from data: bound parameters for SQL,
   argv arrays for processes, autoescaping templates, typed query builders
   for NoSQL. Use that mechanism. A blocklist of "dangerous characters" is a
   bet that you know every encoding the parser accepts; you do not. Example:
   `db.query('SELECT * FROM u WHERE id = $1', [id])`, never
   `'... WHERE id = ' + id.replace(/'/g, "''")`.

3. **Validate input for shape, encode output for context. These are
   different jobs.** Validation rejects what the application cannot process
   (an email that is not an email, a quantity under 1). Encoding makes a
   legitimate value safe for the place it is going (HTML body, attribute,
   JS string, URL, SQL, shell). An apostrophe in "O'Brien" is valid input
   and must be encoded correctly in each sink. Doing one job and calling it
   the other is how both XSS and "my name is rejected" bugs happen.

4. **Treat every boundary crossing as hostile, including from your own
   services, your own database, and your own model.** Data in the database
   was user input once. The response from an internal microservice was
   shaped by a request. LLM output is derived from untrusted prompts. Apply
   the same encoding and authorization discipline on the way out of storage
   as on the way in.

5. **Secrets live in a secret store, are injected at runtime, and are
   rotatable without a deploy.** Never in source, never in a Docker layer,
   never in a log line, never in an error message, never in a URL query
   string (URLs end up in access logs, browser history and Referer headers).
   A secret you cannot rotate is a liability with a countdown.

6. **Use the boring, reviewed, maintained library and its defaults.** For
   crypto, sessions, CSRF tokens, password hashing, JWT validation, HTML
   sanitization, and file type detection, the library has been attacked by
   more people than will ever read your code. Inventing any of these is a
   finding by itself. If a library default seems to be in the way, learn why
   it exists before overriding it.

7. **Fail closed, and fail quietly to the outside.** Missing permission
   lookup, unreachable auth service, malformed token: deny. Error responses
   to clients carry a correlation id, not a stack trace, SQL fragment, file
   path, or framework version. Internal logs carry the detail.

8. **Least privilege for every principal: users, service accounts, tokens,
   containers, CI jobs, and LLM tools.** A token that can only read one
   bucket turns a leak into an incident report instead of a breach. A tool
   the model can call that only reads turns a prompt injection into a
   nuisance instead of data loss.

9. **Security is a design input, not a release gate.** The cheapest fix is
   the one made at the data model (tenant id on every row, enforced by a
   scoped repository) rather than at review time (grep every handler).
   Spend 30 minutes on the threat model before building; see
   `references/threat-modeling.md`.

10. **Prove it.** A vulnerability claim without a reproducing test is an
    opinion; a fix without a regression test will be undone by the next
    refactor. Write the negative test (the request that must be rejected),
    watch it fail, fix, watch it pass.

## Workflow

### A. Building a new feature

1. **Threat model in 30 minutes** (`references/threat-modeling.md`). List
   assets, entry points, trust boundaries, and who can reach each entry
   point. Write 3-6 abuse cases in the form "as an attacker with X, I
   can Y by Z". Rank by likelihood × impact. Record it next to the design
   (PR description, ADR, `docs/threat-models/`). Stop and ask the user when
   an abuse case depends on a product decision you cannot make (should
   users see each other's profiles? can admins impersonate?).

2. **Decide the enforcement points before writing handlers.** Where does
   identity attach to the request? Where is object ownership checked? Which
   repository/query layer scopes by tenant? What validates input shape
   (schema library) and what encodes output (template engine, serializer)?
   If the codebase has these already, use them. If not, build them once,
   generically, and make the handler-level code trivially short.

3. **Write the negative tests first.** Unauthenticated request → 401.
   Authenticated but wrong owner → 403 or 404 (be consistent with the
   codebase; 404 hides existence, 403 is clearer; either is fine, mixing
   them leaks). Oversized/malformed input → 400 without a stack trace. Then
   implement.

4. **Implement with the secure default.** Parameterized queries, autoescaped
   templates, argv-style process execution, allowlisted redirects, schema-
   validated bodies, scoped tokens, secrets from the store. Each is detailed
   in the references. If you must use an escape hatch (`raw`, `|safe`,
   `shell=True`, `dangerouslySetInnerHTML`), leave a comment stating why it
   is safe here and what guarantees the input.

5. **Run the audit tools for the ecosystem** (table above) on your change,
   run the negative tests, check headers if you touched responses, and grep
   the diff for anything that looks like a credential.

6. **Summarize**: what the threat model found, what controls exist and
   where, what you did not verify, and any pre-existing issue you noticed
   but did not fix.

### B. Reviewing or auditing existing code

Follow `references/code-audit-playbook.md`. In short: map entry points,
grep for dangerous sinks per language, trace from each sink back to its
source, check that every handler goes through the authz layer, scan for
secrets and vulnerable dependencies, check headers and error handling on a
running instance if available, and write up findings with severity,
location, impact, fix, and how to verify. Prove each finding with a
request or a test before reporting it. Report confidence honestly:
"confirmed", "likely, needs runtime check", or "pattern smell".

### C. Responding to a report, scanner finding, or leaked secret

- Scanner finding: reproduce or rule out first (`references/security-testing.md`
  has a triage procedure). Most SAST output is noise; the signal is worth
  the triage.
- Pentest report: treat each item as a hypothesis, confirm it, fix the
  class not the instance (if one IDOR exists, audit every handler with an
  id parameter).
- Leaked secret: `references/secrets.md` "first hour" section. Revoke
  first, rotate second, assess third, purge history last and with low
  expectations. Rewriting git history does not un-leak anything that was
  pushed; the rotation is the fix.

### When to stop and ask

- The fix changes user-visible behavior (stricter password rules, shorter
  sessions, blocked file types, tighter CORS). Propose, do not impose.
- A finding touches payment, health or legal data and may be a
  notifiable breach. Say so plainly and suggest the user involve whoever
  owns compliance.
- You would need to rotate a production secret, revoke tokens, or run a
  tool against infrastructure you do not control.
- The threat model reveals a product question (multi-tenant isolation,
  admin powers, data retention) rather than an engineering one.

When you can decide, decide and write down why.

## Quality bar

### Excellent vs mediocre

| Area | Mediocre | Excellent |
|---|---|---|
| Injection fix | Adds a regex that strips quotes and semicolons | Switches to bound parameters; removes the regex; adds a test with `O'Brien` and `1; DROP` that passes because the parser never sees them as code |
| Authorization | Checks `req.user` exists; hides the button in the UI | Checks ownership in a shared policy layer; returns 404 for other tenants' ids; has a test matrix (owner, other user, admin, anonymous) per endpoint |
| XSS | Escapes `<` and `>` in one place | Leaves autoescape on, uses the framework's safe sinks, runs user HTML through DOMPurify with an explicit allowlist, and adds a CSP that would have blocked the inline script anyway |
| CORS | `Access-Control-Allow-Origin: *` with credentials, or reflects `Origin` | Exact allowlist of origins, `Vary: Origin`, credentials only where needed, preflight cache tuned |
| Secrets | `.env` added to `.gitignore` after the key is already in history | Key revoked and rotated, loaded from a secret manager, `.env.example` with placeholders, gitleaks in pre-commit and CI |
| Dependencies | `npm audit fix --force` and move on | Reads each advisory, checks whether the vulnerable path is reachable, upgrades or pins with a note, enables Renovate/Dependabot with grouping, pins CI actions by SHA |
| Crypto | `crypto.createCipher('aes-256-cbc', password)` | `AES-256-GCM` via a high-level library with random nonces, keys from a KDF or KMS, and a comment on what the ciphertext protects against |
| Logging | Logs the full request body "for debugging" | Structured logs with an allowlist of fields, PII redacted, audit events for auth and permission changes, retention defined |
| LLM tools | Model has a `run_shell` tool and output is rendered as HTML | Tools scoped read-only by default, destructive tools require confirmation, output treated as untrusted and encoded, URLs in output not auto-fetched |
| Error handling | Stack trace in the JSON response | Correlation id in the response, full detail in the server log, generic message to the user |

### AI-specific failure modes to avoid

- **"Sanitize inputs" with no specifics.** Name the sink, name the
  mechanism (parameter binding, HTML attribute encoding, argv array). If
  you cannot name the sink, you have not found the bug.
- **Blocklisting instead of parameterizing.** A WAF-style filter on the
  input side is not a fix for an injection; it is a race with the parser's
  encoding rules that you will lose.
- **Disabling a control to make something work.** `cors({origin: true})`,
  `csrf_exempt`, `'unsafe-inline'`, `verify=False`,
  `rejectUnauthorized: false`, `--no-verify`. Each of these is a security
  bug introduced to fix a configuration bug. Find the configuration bug.
- **Printing secrets to logs or errors.** `console.log(process.env)`,
  `logger.info(f"config: {settings}")`, echoing the token back in a 401
  message, including the connection string in the exception.
- **Inventing crypto.** Homemade token formats, XOR "encryption",
  `md5(password + salt)`, custom JWT parsing, nonce = counter stored
  nowhere. Use the library. See `references/cryptography.md`.
- **Trusting client-side checks.** Hidden form fields, disabled buttons,
  `isAdmin` in localStorage, price sent from the browser, `role` in the
  request body. The server recomputes everything that matters.
- **Authorization only on the UI route.** The React route guard hides the
  admin page; the `/api/admin/users` endpoint returns data to anyone with a
  session.
- **Treating security as a final checklist.** Adding "security review" as
  the last task after the data model has no tenant column.
- **Pasting tokens into code "to test quickly".** It gets committed. Use
  an env var from the start; it costs ten seconds.
- **Adding a route without reading the existing auth middleware.** The new
  route ends up outside the protected group, or re-implements a weaker
  check.
- **Confusing "no scanner findings" with "secure".** Scanners do not find
  missing authorization checks or business logic abuse. Those come from the
  threat model and the negative tests.
- **Reporting pattern smells as confirmed vulnerabilities.** `eval` in a
  build script with constant input is not an RCE. Trace the source before
  raising the alarm; mislabeled severity erodes trust in real findings.

## Vulnerability classes at a glance

The one-line mechanism that fixes each class. If your fix does not reduce
to one of these, you are probably blocklisting.

| Class | The fix is | Depth |
|---|---|---|
| SQL / NoSQL / LDAP injection | Bound parameters; typed query builders; never interpolate into the query language | `injection.md` |
| Command injection | argv arrays with no shell; allowlisted subcommands; no user input in flags | `injection.md` |
| Template injection | Static templates, user data only as variables; sandboxed engines for user templates | `injection.md` |
| XSS | Autoescape on; context-aware encoding; allowlist sanitizer for rich text; CSP without `unsafe-inline` | `xss-and-output-encoding.md` |
| CSRF | SameSite cookies plus a synchronizer or double-submit token; `Origin`/`Sec-Fetch-Site` check; no state change on GET | `csrf-cors-headers.md` |
| SSRF | Allowlist of destinations; resolve-then-connect pinning; block private and metadata ranges; no redirects followed blindly | `ssrf-and-server-side.md` |
| Path traversal | Resolve to canonical path and verify prefix; map ids to files instead of accepting paths | `ssrf-and-server-side.md` |
| Insecure deserialization | Do not deserialize untrusted data with native formats (pickle, Java serialization, YAML load, Marshal); use JSON with a schema | `ssrf-and-server-side.md` |
| XXE | Disable DTDs and external entities on every XML parser | `ssrf-and-server-side.md` |
| Open redirect | Relative paths only or an allowlist of hosts; never redirect to a raw parameter | `ssrf-and-server-side.md` |
| IDOR / broken object-level authz | Scope every query by the caller's tenant/owner; policy layer, not handler-by-handler | `authn-authz-threats.md` |
| Broken function-level authz | Deny-by-default route protection; role checks in middleware per route group | `authn-authz-threats.md` |
| Mass assignment | Explicit allowlist of writable fields (DTOs, `permit`, `only`, schema `strict`) | `authn-authz-threats.md` |
| Race / TOCTOU | Database constraints and atomic updates; `SELECT ... FOR UPDATE`; idempotency keys | `authn-authz-threats.md` |
| Business logic abuse | Threat model the flow; server-side recomputation of prices, quantities, state transitions | `threat-modeling.md` |
| File upload | Sniff type, re-encode images, random names, store outside webroot, size limits, serve with `nosniff` | `ssrf-and-server-side.md` |
| Prototype pollution | Reject `__proto__`/`constructor` keys; `Object.create(null)` maps; patched deep-merge libs | `injection.md` |
| ReDoS | Linear-time regex engines (RE2), bounded quantifiers, input length limits | `ssrf-and-server-side.md` |
| Timing attacks | Constant-time compare for secrets; uniform response time on login | `cryptography.md` |

## Reference map

| File | Read when | Contains |
|---|---|---|
| `references/threat-modeling.md` | Starting any feature that handles user data, money, auth, files, or external calls | 30-minute method, templates, worked example, text trust-boundary diagrams, abuse cases, likelihood × impact scoring, where to record |
| `references/injection.md` | Any query, command, LDAP filter, template, or NoSQL filter built from input | SQL/NoSQL/command/LDAP/template injection with vulnerable → fixed pairs in JS, Python, Go, Java, Ruby, PHP; ORM escape hatches; shell-free process execution |
| `references/xss-and-output-encoding.md` | Rendering user content, rich text, markdown, templates, `innerHTML`, SVG, PDFs | Encoding contexts, framework escape hatches per framework, DOMPurify configuration, Trusted Types, CSP as defense in depth |
| `references/authn-authz-threats.md` | Login, signup, reset, sessions, JWT, OAuth, roles, tenants, "can user A see user B's thing" | Enumeration, brute force and rate limiting, credential stuffing, fixation, token storage trade-offs, JWT pitfalls, OAuth misconfig, IDOR hunting, authz test matrix, multi-tenant isolation, NIST 800-63B password guidance |
| `references/csrf-cors-headers.md` | Cookies, forms, CORS errors, headers, CSP, iframes | CSRF mechanics and modern defenses, SameSite nuances, correct vs wrong CORS configs, full header examples per server, building a CSP step by step with nonces, hashes and reporting |
| `references/ssrf-and-server-side.md` | Fetching user-supplied URLs, file paths from input, uploads, XML, deserialization, redirects, regex on input | SSRF allowlists and DNS rebinding, metadata endpoints, path traversal, upload pipeline, deserialization in each language, XXE, open redirects, ReDoS |
| `references/secrets.md` | Any key, token, password, `.env`, CI secret, or "the key leaked" | Hygiene rules, `.env` patterns, CI/CD handling, cloud secret managers, rotation playbook, scanner commands, the first hour after a leak |
| `references/dependencies-supply-chain.md` | Adding or updating dependencies, audit output, CI workflow files | Lockfiles, audit tool commands and triage per ecosystem, Dependabot/Renovate configs, pinning actions by SHA, SLSA/provenance, install scripts, dependency confusion |
| `references/cryptography.md` | Encrypting, hashing, signing, tokens, random ids, TLS config | Use/never table, AEAD and nonce rules, hashing vs MAC vs signature, password hashing parameters, KDFs, randomness, constant-time compare, key management, TLS baselines, misuse with fixes |
| `references/llm-app-security.md` | Any LLM call, agent, tool/function definition, RAG pipeline, chat UI | Direct and indirect prompt injection, untrusted output, tool permission scoping, confirmations, exfiltration via URLs and images, retrieval poisoning, PII in prompts, cost abuse, evals as security tests |
| `references/cloud-and-infra.md` | IAM, buckets, security groups, Dockerfiles, Kubernetes, Terraform | Least privilege patterns, public storage, network exposure, container hardening, K8s pod security, IaC scanning, logging and alerts |
| `references/logging-privacy.md` | Adding logs, analytics, audit trails, handling personal data, GDPR questions | What to log and not, redaction, audit trail design, data minimization, retention, PII in URLs and analytics |
| `references/security-testing.md` | Running or triaging SAST/DAST/SCA, writing security tests | semgrep and CodeQL usage, ZAP baseline, writing authz matrix tests, injection tests, header tests, triage, false positives |
| `references/code-audit-playbook.md` | "Review this codebase for security", pentest prep, inheriting a repo | Entry-point mapping, grep/semgrep commands per language for dangerous sinks, data-flow tracing, authz coverage, findings report template |
| `references/mobile-security.md` | iOS, Android, Flutter, React Native code | Keychain/Keystore, pinning trade-offs, deep link validation, secrets in binaries, WebView hardening, biometric gating |

Scripts (Python stdlib only, read-only, documented in their headers):

- `scripts/headers_check.py <url>`: fetches a URL and reports presence and
  quality of security headers (HSTS, CSP, frame protections, cookie flags,
  CORS, information leakage). Use after deploying any response-affecting
  change.
- `scripts/secret_patterns.py <dir>`: scans a directory for common
  credential patterns and prints `file:line` with the match redacted. A
  fast first pass when gitleaks is not installed; not a replacement for it.

## Verification

Do these before saying the work is done. Say which ones you could not do.

1. **Run the ecosystem audit tool** from the detection table and read the
   output. Fix or explicitly accept (with reason) every high/critical.
2. **Run a SAST pass** (`semgrep --config auto .` or the language ruleset)
   on the changed files. Triage: confirmed, false positive with reason, or
   needs runtime check.
3. **Exercise authz negative tests.** For every new or changed endpoint with
   an identifier: anonymous → 401; user A fetching user B's resource → 403
   or 404; lower role calling higher-role action → 403. Run them; do not
   reason about them.
4. **Check headers on a running instance** with
   `scripts/headers_check.py` or `curl -sI`. Confirm HSTS, CSP (or a
   documented reason for none), frame protection, `nosniff`, cookie flags.
5. **Grep for secrets** in the diff and the repo: `gitleaks detect` or
   `scripts/secret_patterns.py .`. Confirm `.env` is ignored and not in
   history.
6. **Confirm error responses do not leak.** Send a malformed body, a
   nonexistent id, and an invalid token. Responses should be generic with
   a correlation id; the stack trace belongs in the server log only.
7. **Re-read every escape hatch you introduced** (`raw`, `|safe`,
   `shell=True`, `dangerouslySetInnerHTML`, `csrf_exempt`, CORS wildcard,
   `unsafe-inline`). Each has a comment justifying it or it is gone.
8. **Confirm the lockfile changed only as intended** and CI installs with
   it frozen.

## Final checklist

- Threat model written (even three lines) for anything handling user data,
  money, files, auth, or outbound requests; product questions surfaced.
- Every handler reached through the existing auth middleware; object-level
  authorization enforced server-side via the shared policy layer; negative
  tests exist and pass.
- No string-built SQL/NoSQL/command/LDAP/template from input; bound
  parameters or argv everywhere; escape hatches commented.
- Output encoded for its context; autoescape on; user HTML sanitized with
  an allowlist; CSP present or its absence explained.
- No secret in code, config, Docker layer, log, error, or URL; loaded from
  env or a secret manager; scanner clean; rotation possible.
- Dependencies audited; lockfile committed and honored; CI actions pinned;
  no new postinstall surprises.
- Crypto via a maintained library with correct primitives (AEAD, argon2id
  or bcrypt, CSPRNG, constant-time compare); nothing invented.
- CORS allowlisted, cookies `Secure; HttpOnly; SameSite`, headers set once,
  CSRF defense present for cookie-authenticated state changes.
- Logs structured, PII redacted, audit events for auth and permission
  changes; errors generic to clients.
- LLM tools scoped least-privilege, destructive actions confirmed, model
  output treated as untrusted.
- Summary states findings, fixes, severity, what was verified, what was
  not, and pre-existing issues left for the user to prioritize.
