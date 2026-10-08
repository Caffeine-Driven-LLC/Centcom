# Security testing

How to run static analysis (SAST), dependency scanning (SCA), and dynamic
scanning (DAST) so that they produce signal, how to triage what they
report, and how to write the security regression tests that scanners
cannot replace: authorization matrices, injection behavior tests, header
and cookie assertions, and tests that pin a security configuration so a
refactor cannot silently remove it.

## Contents

1. What each kind of testing finds, and misses
2. SAST: semgrep in practice
3. SAST: CodeQL and language-specific tools
4. SCA: dependency scanning in CI
5. DAST: ZAP baseline and authenticated scans
6. Triage: confirmed, false positive, needs runtime check
7. Writing security regression tests
8. Fuzzing and property tests for parsers
9. Pre-commit, CI, and gating without friction
10. Working with a pentest report
11. Metrics that mean something

## 1. What each kind finds, and misses

| Method | Finds | Misses |
|---|---|---|
| SAST (semgrep, CodeQL, bandit, gosec, brakeman) | Dangerous sinks with tainted sources: injection, XSS, weak crypto, hard-coded secrets, insecure deserialization, dangerous config | Missing authorization checks, business logic, anything that depends on runtime config or data |
| SCA (npm audit, pip-audit, osv-scanner, trivy) | Known-vulnerable dependency versions, some license issues | Whether the vulnerable code is reachable; malicious packages without an advisory; your own code |
| DAST (ZAP, Nuclei, Burp) | Missing headers, reflected XSS, some injection, exposed debug endpoints, TLS issues, cookie flags, open redirects | Stored/second-order issues it cannot trigger, authorization bugs (unless configured with two users), logic bugs |
| IaC scanning (checkov, trivy config) | Cloud misconfig in code | Drift, console changes |
| Security regression tests (yours) | Exactly the properties you assert: authz matrix, encoding, headers, rate limits, tenant isolation | Anything you did not think of |
| Threat modeling + manual review | Design-level issues, authz gaps, logic abuse | Scales with reviewer time |

No tool finds "user A can read user B's invoice". That comes from the
threat model and the test matrix. Run the tools to clear the floor, write
the tests to hold the ceiling.

## 2. SAST: semgrep in practice

Semgrep is the fastest way to get useful SAST across most languages with
no build step.

```bash
# Try the curated rulesets for your stack (several can be combined)
semgrep --config p/default --config p/security-audit --config p/secrets .
semgrep --config p/owasp-top-ten --config p/javascript --config p/react --config p/nodejs .
semgrep --config p/python --config p/django --config p/flask .
semgrep --config p/golang . ; semgrep --config p/java --config p/spring . ; semgrep --config p/ruby --config p/rails .
# Only files changed vs main (fast PR check)
semgrep --config auto --baseline-commit origin/main .
# Machine-readable for triage
semgrep --config auto --json -o semgrep.json . ; semgrep --config auto --sarif -o semgrep.sarif .
# Severity filter
semgrep --config auto --severity ERROR .
```

Write a project rule when the codebase has its own dangerous API or its
own safe wrapper that should be the only way to do something:

```yaml
# .semgrep/rules/no-raw-query.yml
rules:
  - id: no-unparameterized-raw-query
    languages: [typescript, javascript]
    severity: ERROR
    message: >
      Raw SQL with string interpolation. Use db.query(sql, params) with placeholders,
      or the repository layer. See security/references/injection.md.
    patterns:
      - pattern-either:
          - pattern: $DB.query(`...${$X}...`)
          - pattern: $DB.query("..." + $X)
          - pattern: $DB.query($S.concat($X))
          - pattern: $DB.$M(`...${$X}...`, ...)
      - metavariable-regex:
          metavariable: $M
          regex: ^(query|execute|raw|whereRaw|orderByRaw|\$queryRawUnsafe|\$executeRawUnsafe)$
    fix: |
      $DB.query(/* use $1 placeholders */, [$X])

  - id: handler-without-authz
    languages: [typescript]
    severity: WARNING
    message: Route handler with an :id param does not call a policy/scoped repo. Verify object-level authorization.
    patterns:
      - pattern: |
          $ROUTER.$METHOD("$PATH", ..., async ($REQ, $RES) => { ... })
      - metavariable-regex: { metavariable: $PATH, regex: ".*:[a-zA-Z]*[iI]d.*" }
      - pattern-not: |
          $ROUTER.$METHOD("$PATH", ..., async ($REQ, $RES) => { ... $POLICY.$CHECK(...) ... })
      - pattern-not: |
          $ROUTER.$METHOD("$PATH", ..., async ($REQ, $RES) => { ... $REPO.forAccount(...) ... })

  - id: dangerous-html-without-sanitize
    languages: [typescript, javascript]
    severity: ERROR
    message: dangerouslySetInnerHTML with a value not wrapped in cleanHtml(). Sanitize or render as text.
    patterns:
      - pattern: <$EL dangerouslySetInnerHTML={{ __html: $X }} />
      - pattern-not: <$EL dangerouslySetInnerHTML={{ __html: cleanHtml(...) }} />
```

```bash
semgrep --config .semgrep/rules --config p/default .
```

Suppress a confirmed false positive inline with a reason so the next
reader does not re-investigate:

```ts
// nosemgrep: no-unparameterized-raw-query -- $X is a constant from SORT_COLUMNS allowlist, not user input
const rows = await db.query(`SELECT * FROM users ORDER BY ${col} LIMIT $1`, [limit]);
```

Taint mode (`mode: taint` with `pattern-sources`/`pattern-sinks`/
`pattern-sanitizers`) lets you say "anything from `req.body`/`req.query`
reaching `exec()` without passing through `validate()`" and is worth
learning for a codebase you maintain; the Pro engine adds cross-file
taint.

## 3. SAST: CodeQL and language-specific tools

**CodeQL** (GitHub): deeper interprocedural dataflow than semgrep's free
engine; slower; needs a build for compiled languages. Enable the default
setup in repository settings (Security → Code scanning) with the
`security-extended` query suite; results appear on PRs. Locally:

```bash
codeql database create db --language=javascript-typescript --source-root .
codeql database analyze db codeql/javascript-queries:codeql-suites/javascript-security-extended.qls --format=sarif-latest --output=results.sarif
```

Language-native tools worth running alongside:

| Language | Tool | Notes |
|---|---|---|
| Python | `bandit -r . -ll -ii` ; `pip install bandit[toml]` to configure in pyproject | `# nosec B608 -- reason` inline |
| Go | `gosec -exclude-generated ./...` ; `govulncheck ./...` ; `staticcheck ./...` | `//nolint:gosec // reason` |
| Ruby/Rails | `brakeman -q -z --no-pager` ; `--interactive-ignore` to build the ignore file | Very low false-positive rate for Rails |
| Java/Kotlin | SpotBugs + `find-sec-bugs` plugin (Maven/Gradle); SonarQube | `@SuppressFBWarnings(value="...", justification="...")` |
| PHP | `psalm --taint-analysis` ; `phpstan` with strict rules ; Laravel: `enlightn` | |
| JS/TS | `eslint-plugin-security`, `eslint-plugin-no-unsanitized`, `eslint-plugin-regexp` | Cheap; runs with lint |
| C#/.NET | `security-code-scan` analyzers; Roslyn analyzers | |
| Rust | `cargo clippy`, `cargo audit`, `cargo geiger` (unsafe count) | |
| Swift/Kotlin mobile | `mobsf` | See `mobile-security.md` |
| Terraform/K8s/Docker | `checkov`, `trivy config`, `hadolint` | See `cloud-and-infra.md` |
| GitHub Actions | `zizmor`, `actionlint` | |

## 4. SCA in CI

Commands per ecosystem are in `dependencies-supply-chain.md` §3. The CI
pattern:

```yaml
# .github/workflows/security.yml
name: security
on: { pull_request: {}, push: { branches: [main] }, schedule: [{ cron: '17 6 * * 1' }] }
permissions: { contents: read, security-events: write }
jobs:
  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: semgrep/semgrep-action@<sha>
        with: { config: "p/default p/secrets .semgrep/rules" }
  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: google/osv-scanner-action/osv-scanner-action@<sha>
        with: { scan-args: "-r --skip-git ./" }
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }                 # full history for gitleaks
      - uses: gitleaks/gitleaks-action@<sha>
  iac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: bridgecrewio/checkov-action@<sha>
        with: { directory: infra/, soft_fail: false, quiet: true }
```

The weekly schedule matters: new advisories appear for versions you
already ship; a PR-only scan never sees them. Upload SARIF to the code
scanning tab so findings live in one place.

## 5. DAST: ZAP baseline and authenticated scans

OWASP ZAP in Docker against a staging deployment (never against
production without sign-off, never against systems you do not own).

```bash
# Passive baseline: spiders and reports without attacking; safe for any environment you own
docker run --rm -v "$(pwd)":/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://staging.example.com -r baseline.html -J baseline.json -a   # -a includes alpha rules
# API scan from an OpenAPI spec
docker run --rm -v "$(pwd)":/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py -t https://staging.example.com/openapi.json -f openapi -r api.html
# Full active scan (sends attack-shaped requests; staging only, with test data you can discard)
docker run --rm -v "$(pwd)":/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-full-scan.py -t https://staging.example.com -r full.html -z "-config api.disablekey=true"
```

Authenticated scanning needs a context with login steps or a session
token; the ZAP automation framework (`-autorun plan.yaml`) handles form
auth, script auth, and header injection. Create two test users and use
ZAP's access-control add-on (or do it in your own tests, §7) to check that
user B cannot reach user A's URLs.

Baseline output triage: `WARN` for missing headers and cookie flags is
usually real and cheap to fix; `X-Powered-By` and server banners are low;
"Timestamp disclosure" and "Information disclosure - suspicious comments"
are mostly noise; anything in "Injection" or "XSS" needs a manual
reproduction before you believe it.

Nuclei (`nuclei -u https://staging.example.com -t http/exposures/
-t http/misconfiguration/`) is fast for exposed files, debug endpoints,
and known misconfigurations; keep it to your own hosts.

## 6. Triage

Every finding gets one of four labels, written down:

- **Confirmed**: reproduced with a request or a test that demonstrates
  the behavior. Gets a severity (use the likelihood × impact scheme in
  `threat-modeling.md` §7, or CVSS if the organization requires), a fix,
  and a regression test.
- **False positive**: the pattern matched but the source is constant or
  already validated, or the sink is not reachable. Suppressed inline with
  a reason (`nosemgrep`, `# nosec`, `//nolint`, `.trivyignore` comment,
  `.zap/rules.tsv`) so it stays suppressed and auditable.
- **Needs runtime check**: static analysis cannot tell (does this config
  flag get set in prod? is this endpoint reachable?). Assign to someone
  with an environment; do not leave it in limbo.
- **Accepted risk**: real but not worth fixing now. Owner, reason, review
  date. Rare; most "accepted risks" are deferred fixes with no ticket.

Triage order: by severity, then by how cheap the fix is. A batch of
missing headers is one PR. Do not report a scanner's raw output to the
team as "47 vulnerabilities"; triage first, report the five that matter
and the forty that were noise with one line each.

Common false positives: `eval` in build scripts with constant input;
`shell=True` with no variables; `innerHTML = ''` (clearing); MD5 for cache
keys or ETags (not security); `Math.random` for jitter/animation; `http://`
URLs in XML namespaces and schemas; test fixtures with fake keys (mark them
`EXAMPLE`/`FAKE` so scanners' allowlists catch them); "hard-coded
password" on a variable named `password_field_id`.

Common false negatives (the scanner is quiet and the bug is real): missing
authz, mass assignment, race conditions, IDOR, logic errors, SSRF through
a library the ruleset does not model, XSS through a framework escape hatch
the rules do not know, secrets in a format the regexes do not cover. This
is why §7 exists.

## 7. Writing security regression tests

Security tests are ordinary tests that assert *negative* behavior: the
request that must fail, the output that must not contain markup, the
header that must be present. Keep them in the normal suite, tagged, so
they run on every PR.

### Authorization matrix (the most valuable test in the suite)

```python
# tests/security/test_authz_matrix.py (pytest + a fixture that logs in as each principal)
import pytest

@pytest.fixture
def world(db):
    a = make_user(tenant="A"); b = make_user(tenant="B"); admin_a = make_user(tenant="A", role="admin")
    inv = make_invoice(owner=a)
    return dict(a=a, b=b, admin_a=admin_a, anon=None, inv=inv)

CASES = [
    # who,      method,   path,                         expected
    ("anon",    "GET",    "/api/invoices/{inv}",        401),
    ("b",       "GET",    "/api/invoices/{inv}",        404),
    ("b",       "PATCH",  "/api/invoices/{inv}",        404),
    ("b",       "DELETE", "/api/invoices/{inv}",        404),
    ("a",       "GET",    "/api/invoices/{inv}",        200),
    ("a",       "DELETE", "/api/invoices/{inv}",        204),
    ("a",       "GET",    "/api/admin/users",           403),
    ("admin_a", "GET",    "/api/admin/users",           200),
    ("admin_a", "GET",    "/api/admin/tenants/B/users", 404),
]

@pytest.mark.parametrize("who,method,path,expected", CASES)
def test_authz(client_as, world, who, method, path, expected):
    resp = client_as(world[who]).request(method, path.format(inv=world["inv"].id))
    assert resp.status_code == expected, resp.text
    if expected >= 400:
        assert world["inv"].customer_email not in resp.text        # no data in the error
        assert "Traceback" not in resp.text and "at " not in resp.text[:200]
```

Add a meta-test that fails when a new route appears without a matrix
entry, so coverage cannot silently drop:

```python
def test_every_route_has_authz_cases(app):
    routes = {(r.methods - {"HEAD", "OPTIONS"}, r.path) for r in app.routes if r.path.startswith("/api/")}
    covered = {(m, p.split("{")[0]) for _, m, p, _ in CASES}
    uncovered = [(m, p) for ms, p in routes for m in ms if (m, p.split("{")[0]) not in covered and p not in PUBLIC_ROUTES]
    assert not uncovered, f"routes without authz tests: {uncovered}"
```

### Tenant isolation at the data layer

```ts
test('repository cannot return foreign tenant rows', async () => {
  const a = await seedInvoice({ tenantId: 'A' });
  const repo = InvoiceRepo.forTenant('B');
  await expect(repo.findOrThrow(a.id)).rejects.toThrow(NotFound);
  expect(await repo.search({ q: a.customerName })).toEqual([]);     // search index path too
});
```

### Injection behavior

See `injection.md` §12: legitimate inputs containing metacharacters are
stored and returned verbatim; sort/filter parameters outside the allowlist
produce 400 or a default, never 500; operator objects in JSON bodies are
rejected by the schema.

### Output encoding

See `xss-and-output-encoding.md` §12: user content with markup renders as
text; the sanitizer policy is pinned by a test so loosening it is a visible
diff.

### Headers, cookies, CORS, CSRF

See `csrf-cors-headers.md` §12. One test file that fetches `/` and
`/api/me` and asserts the full header set; run `scripts/headers_check.py`
against staging after deploy as the runtime check.

### Rate limiting

```ts
test('login is throttled per account', async () => {
  for (let i = 0; i < 6; i++) await api.post('/login').send({ email: 'x@y.z', password: 'wrong' });
  const res = await api.post('/login').send({ email: 'x@y.z', password: 'wrong' });
  expect(res.status).toBe(429);
  expect(res.headers['retry-after']).toBeDefined();
});
```

### Uniform responses (enumeration)

```ts
test('login and reset do not reveal account existence', async () => {
  const [known, unknown] = await Promise.all([
    api.post('/login').send({ email: existing.email, password: 'wrong' }),
    api.post('/login').send({ email: 'nobody@example.com', password: 'wrong' }),
  ]);
  expect(known.status).toBe(unknown.status);
  expect(known.body).toEqual(unknown.body);
});
```

### Configuration pinning

Tests that fail if someone flips a safety flag:

```python
def test_production_settings():
    from django.conf import settings
    assert settings.DEBUG is False
    assert "django.middleware.csrf.CsrfViewMiddleware" in settings.MIDDLEWARE
    assert settings.SESSION_COOKIE_SECURE and settings.SESSION_COOKIE_HTTPONLY
    assert settings.SECURE_HSTS_SECONDS >= 31536000
    assert not settings.CORS_ALLOW_ALL_ORIGINS
```

```ts
test('no route is mounted outside the auth middleware', () => {
  const unprotected = listRoutes(app).filter((r) => !r.middlewares.includes(requireAuth) && !PUBLIC.has(r.path));
  expect(unprotected).toEqual([]);
});
```

### Secrets and error leakage

```ts
test('errors do not leak internals', async () => {
  const res = await api.post('/api/invoices').set('Content-Type', 'application/json').send('{bad json');
  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules|\.js:\d+|SELECT|postgres/i);
  expect(res.body.requestId).toBeDefined();
});
```

## 8. Fuzzing and property tests for parsers

Anything that parses untrusted bytes (file formats, custom protocols,
query languages, markdown extensions) benefits from fuzzing. Low-effort
options: Go's built-in `go test -fuzz=FuzzParse`; Python `hypothesis`
with `@given(st.binary())` asserting "never raises anything but
`ParseError`, never takes more than 1 s"; `jsfuzz`/`fast-check` in JS;
`cargo fuzz` in Rust; Jazzer for the JVM. Run for a few minutes in CI
nightly and keep the corpus. Crashes, hangs, and memory blowups are
security findings in a parser exposed to users.

## 9. Pre-commit, CI, and gating

- Pre-commit (fast, local): gitleaks on staged changes; semgrep on changed
  files with the project rules only; lint security plugins. Under a few
  seconds or developers bypass it.
- PR (minutes): full semgrep ruleset on the diff baseline; SCA; IaC scan;
  the security test suite; headers test. Fail on ERROR-severity new
  findings only, after the backlog is cleared; warn on the rest.
- Nightly/weekly: full-repo SAST, SCA against fresh advisories, ZAP
  baseline against staging, fuzz runs, dependency bot runs.
- Release: image scan, SBOM generation, signature.

Gate on *new* findings (baseline/diff mode) so an existing backlog does
not block every PR; track the backlog as tickets with owners.

## 10. Working with a pentest report

- Each finding is a hypothesis with evidence. Reproduce it yourself before
  fixing; sometimes the environment differed, sometimes it is worse than
  reported.
- Fix the **class**, not the instance. One IDOR means "audit every handler
  with an id" (`code-audit-playbook.md`); one reflected XSS means "find
  every escape hatch"; one missing header means "centralize headers".
- Write a regression test per confirmed finding, named after the report
  id, before the fix.
- Re-test with the same technique the tester used; ask for a retest on
  high/critical.
- Disagree in writing when a severity is wrong for your context, with the
  reason (compensating control, unreachable in prod). Do not silently
  downgrade.
- Track time-to-fix by severity; it is the metric auditors and customers
  ask for.

## 11. Metrics that mean something

- Percentage of API routes covered by the authz matrix (target 100%,
  enforced by the meta-test).
- Open high/critical SCA findings in production dependencies, and their
  age.
- Time from advisory publication to deployed fix for critical.
- Secrets scanner findings per month (should trend to zero; a spike means
  onboarding or a tooling gap).
- Security tests count and pass rate (nondeterministic LLM evals tracked
  separately with pass-rate thresholds; see `llm-app-security.md` §12).
- CSP violation reports per 1k page views (after enforcement, a rise means
  an injection or a new third party).

Vanity metrics to avoid: raw scanner finding counts, "vulnerabilities
fixed" without severity, number of tools run.

Cross-references: audit commands per ecosystem in
`dependencies-supply-chain.md`; the systematic review process in
`code-audit-playbook.md`; specific test patterns in each class's
reference.
