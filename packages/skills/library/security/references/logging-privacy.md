# Logging, privacy, and audit trails

Logs are where sensitive data goes to be forgotten by the people who put it
there and found by the people who should not have it. This file covers
what to log and what never to log, redaction that works, designing audit
trails that answer "who did what to whom and when", data minimization and
retention in the GDPR/CCPA/HIPAA sense, PII leaking through URLs and
analytics, and the user-facing error contract (generic outside, detailed
inside).

## Contents

1. Two different logs: operational and audit
2. Never log these
3. Log these
4. Redaction that works
5. Structured logging and injection
6. The error contract: generic to clients, detailed in logs
7. Audit trails: design
8. Data minimization and classification
9. Retention and deletion
10. PII in URLs, referers, and analytics
11. Access to logs
12. Detection

## 1. Two different logs

**Operational logs** help engineers debug and operate: request traces,
errors, performance. High volume, short retention (days to weeks),
accessible to engineers. Minimize personal data here, because the access
model is broad.

**Audit logs** answer accountability questions: who logged in, who changed
a permission, who viewed a record, who exported data. Lower volume, long
retention (often 1-7 years by policy or regulation), append-only,
accessible to a narrower group, and *designed*, not emitted ad hoc.

Mixing them produces the worst of both: PII at debug-log volume with
debug-log access, and audit questions that cannot be answered because the
retention was 14 days.

## 2. Never log these

- Passwords, password hashes, password reset tokens, MFA codes, recovery
  codes. Including in "login failed for user X with password Y" debug
  lines, which happen.
- Session ids, access tokens, refresh tokens, API keys, JWTs (even
  "just the header"; the whole token is one string). The `Authorization`
  and `Cookie` request headers, the `Set-Cookie` response header.
- Full request or response bodies by default. Log a schema-validated
  subset or sizes and ids.
- Full credit card numbers (PCI DSS forbids storing PAN in logs; last 4 and
  brand are fine), CVV ever, bank account numbers, government ids (SSN,
  passport), dates of birth combined with names.
- Health, sexual orientation, religion, ethnicity, union membership,
  biometrics, precise location (GDPR special categories; HIPAA PHI).
- Secrets from configuration: database URLs with passwords, the environment
  (`console.log(process.env)`), connection strings in exceptions.
- Encryption keys, private keys, nonces reused as identifiers.
- Content of user messages, documents, emails, LLM prompts and completions,
  unless the product requires it and the log is treated as a PII store
  (§11).
- Security question answers, "mother's maiden name", anything used for
  account recovery.

Email addresses, names, IP addresses, and user agents are personal data
under GDPR. They are often necessary in operational logs (IP for abuse,
user id for debugging); prefer the internal user id to the email, and
treat IP retention as something with a limit.

## 3. Log these

Operational (per request): timestamp, request id / trace id, method,
route template (not the full path with ids, or the full path with ids if
you accept the PII implication), status, duration, user id (opaque
internal id), tenant id, client ip (consider truncating the last octet
for analytics-grade logs), user agent, error class and message (after
redaction), upstream call durations. Not: query strings with tokens,
bodies, headers wholesale.

Audit (events, §7): authentication (success, failure with reason category,
MFA events, logout, session revoked), account lifecycle (created,
verified, email changed, password changed, MFA enrolled/removed,
deleted), authorization changes (role granted/revoked, invite sent/
accepted, sharing changed, API key created/revoked), access to sensitive
records (viewed patient record, downloaded export, viewed card details),
admin actions (impersonation start/stop, configuration changes, feature
flags), data export and deletion requests, security-relevant failures
(authz denied, rate limit triggered, signature verification failed,
CSRF rejected).

Security monitoring wants: repeated authz denials from one user (probing),
logins from new geographies, bulk exports, admin actions outside business
hours, spikes in 4xx on auth endpoints.

## 4. Redaction that works

Redact at the logging layer (a processor/formatter that every log line
passes through), not by remembering at each call site. Two mechanisms,
both:

**Key-based**: any field whose name matches a denylist is replaced.

```ts
// pino
import pino from 'pino';
export const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      '*.password', '*.passwordConfirmation', '*.token', '*.accessToken', '*.refreshToken',
      '*.apiKey', '*.api_key', '*.secret', '*.ssn', '*.cardNumber', '*.cvv',
      'user.email',                           // if you decide email stays out of op logs
    ],
    censor: '[REDACTED]',
  },
  serializers: { err: pino.stdSerializers.err },  // stack traces fine in server logs; never in responses
});
```

```python
# Python: a logging.Filter that walks structured extras and scrubs strings
import logging, re
SENSITIVE_KEYS = re.compile(r"(password|passwd|secret|token|authorization|cookie|api[_-]?key|ssn|card|cvv)", re.I)
PATTERNS = [
    (re.compile(r"\b(?:\d[ -]*?){13,16}\b"), "[CARD?]"),                       # PAN-like
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "[JWT]"),
    (re.compile(r"\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}\b"), "[STRIPE_KEY]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[AWS_KEY]"),
    (re.compile(r"(?i)bearer\s+[a-z0-9._-]{20,}"), "bearer [REDACTED]"),
]
def scrub(obj):
    if isinstance(obj, dict):
        return {k: ("[REDACTED]" if SENSITIVE_KEYS.search(str(k)) else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return type(obj)(scrub(v) for v in obj)
    if isinstance(obj, str):
        for pat, rep in PATTERNS: obj = pat.sub(rep, obj)
        return obj
    return obj
class RedactFilter(logging.Filter):
    def filter(self, record):
        record.msg = scrub(record.msg)
        if isinstance(record.args, dict): record.args = scrub(record.args)
        elif record.args: record.args = tuple(scrub(a) for a in record.args)
        for k, v in list(record.__dict__.items()):
            if k not in logging.LogRecord("", 0, "", 0, "", (), None).__dict__: setattr(record, k, scrub(v))
        return True
```

```java
// Logback: a MaskingPatternLayout or a logstash-logback-encoder "maskedFields" config
// <encoder class="net.logstash.logback.encoder.LogstashEncoder">
//   <jsonGeneratorDecorator class="net.logstash.logback.mask.MaskingJsonGeneratorDecorator">
//     <defaultMask>[REDACTED]</defaultMask>
//     <path>password</path><path>token</path><path>authorization</path><path>*.ssn</path>
//     <value>eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+</value>
//   </jsonGeneratorDecorator>
// </encoder>
```

```ruby
# Rails: config/initializers/filter_parameter_logging.rb
Rails.application.config.filter_parameters += [
  :passw, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :card_number, :cvv, :authorization, :cookie
]
# Also: config.filter_redirect for redirect URLs with tokens; ActiveRecord `encrypts` attributes are filtered from inspect
```

**Value-based**: patterns for things that appear in free-text messages
(exception strings, URLs): JWTs, `Bearer ...`, PAN-like digit runs, known
key prefixes, emails if you have decided to exclude them. Imperfect (that
is why key-based comes first), but catches the `logger.error(f"failed:
{response.text}")` case.

Also redact in: error tracking (Sentry `beforeSend` and `sendDefaultPii:
false`, scrub headers and local variables; Datadog/New Relic obfuscation
rules), APM traces (SQL parameters are usually captured; configure
`record_sql: obfuscated`), crash reports in mobile apps, and the LLM
observability tools that store prompts.

Test the redaction: a unit test that logs a dict with `password`,
`authorization`, and a JWT-shaped string and asserts the output contains
none of them.

## 5. Structured logging and injection

Use structured (JSON or key=value) logging where user-controlled values
are *fields*, not interpolated into the message:

```python
# VULNERABLE to log injection: a username with "\n[INFO] admin logged in" forges a line
logger.info(f"login failed for {username}")
# FIXED
logger.info("login failed", extra={"username": username, "reason": "bad_password"})
```

JSON encoders escape newlines and control characters, which defeats line
forgery. If you must use text logs, strip `\r\n` and control characters
from user values first. Also beware of log viewers that render HTML or
ANSI: a value with `\x1b[` escapes can manipulate a terminal; Kibana/
Grafana render as text by default but a custom dashboard may not.

Set a size limit per field (a 10 MB "username" in a log line is a DoS on
your log pipeline) and a sampling policy for high-volume debug logs.

## 6. The error contract

Clients get a stable, generic shape; operators get the detail.

```ts
// Express error handler
app.use((err, req, res, _next) => {
  const id = req.id ?? randomUUID();
  logger.error({ err, requestId: id, userId: req.user?.id, route: req.route?.path }, 'unhandled error');  // full detail, redacted
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({
    error: status < 500 ? err.publicMessage ?? 'Request failed' : 'Internal error',
    requestId: id,                                   // the user can quote this to support
  });
});
```

What leaks when this is missing: stack traces (file paths, framework
versions, internal hostnames), SQL fragments (schema, and confirmation of
injection), connection strings with passwords, third-party API error
bodies (which may include your keys in request echoes), internal IPs,
cloud account ids, user existence (`"user not found"` vs `"wrong
password"`; see `authn-authz-threats.md`).

Framework switches: Django `DEBUG = False` in production (the debug page
prints settings and locals); Flask `debug=False` and no Werkzeug debugger;
Rails `consider_all_requests_local = false`; Spring
`server.error.include-stacktrace=never`, `include-message=never`,
`include-binding-errors=never`; Laravel `APP_DEBUG=false`; ASP.NET
`UseExceptionHandler` not `UseDeveloperExceptionPage` in prod; Express
`NODE_ENV=production` (changes some libraries' error verbosity) plus your
handler; GraphQL servers: disable `includeStacktraceInErrorResponses`,
mask errors (`maskedErrors` in Yoga, `formatError` in Apollo), disable
introspection and the playground in prod if the schema is sensitive.

Validation errors can be specific ("email is required") because they
describe the client's input, not your internals. Never echo the offending
value back in a way that renders as HTML.

## 7. Audit trails: design

An audit event answers: **who** (actor id, actor type: user/service/admin-
impersonating-user, session id), **did what** (a stable verb from a
controlled vocabulary: `user.login`, `role.grant`, `record.view`,
`export.create`), **to what** (target type and id, tenant), **when**
(UTC timestamp from the server), **from where** (ip, user agent, request
id), **with what outcome** (success/denied/failed and a reason code), and
optionally **what changed** (before/after for mutable fields, redacted
per §2).

```json
{
  "ts": "2026-10-08T14:03:11.421Z",
  "event": "role.grant",
  "actor": { "type": "user", "id": "u_8f3", "session": "s_1a2", "impersonating": null },
  "target": { "type": "membership", "id": "m_77", "tenant": "t_42", "user": "u_9c1" },
  "change": { "role": { "from": "member", "to": "admin" } },
  "outcome": "success",
  "ctx": { "ip": "203.0.113.9", "ua": "Mozilla/5.0 ...", "request_id": "r_55d" }
}
```

Design rules:

- **Emit from the service layer**, where the action is decided, not from
  the HTTP handler (then background jobs, CLIs, and admin tools are
  covered) and not from database triggers alone (which lack the actor).
  A decorator/middleware around service methods or an outbox pattern keeps
  it consistent.
- **Append-only storage**: a dedicated table with no UPDATE/DELETE grants
  for the app role, or a log sink (S3 with Object Lock, CloudWatch Logs,
  a SIEM). Tamper-evidence via hash chaining or periodic digests if the
  threat model includes insiders with DB access.
- **Include denials.** `authz.denied` events are the signal for probing.
- **Impersonation is first-class**: when an admin acts as a user, the actor
  is the admin and `impersonating` is the user. Every event during the
  session carries both.
- **Do not log the payload** of the record viewed, just its id and type.
- **Make it queryable**: by actor, by target, by tenant, by time range.
  "Show me everything this user did" and "show me everyone who touched this
  record" are the two questions you will be asked.
- **Expose it**: a user-facing "security activity" page (recent logins,
  devices, API keys) and a tenant-admin audit page are both product
  features and a detection mechanism (users notice logins they did not
  make).
- **Retention**: by policy (§9), typically longer than operational logs.
  SOC 2 auditors will ask for a year; some regulations more.

## 8. Data minimization and classification

GDPR's principles (and CCPA/LGPD/PIPEDA equivalents) in engineering terms:

- **Collect only what the feature needs.** A signup form does not need a
  phone number "for later". Every field is a liability in a breach and a
  deletion obligation.
- **Classify data** at the schema level with a simple scheme (public,
  internal, confidential, restricted/special category) and tag columns or
  types. Then redaction, access control, encryption, and retention can key
  off the tag. A `PersonalData[T]` wrapper type or a column comment
  convention is enough to start.
- **Purpose limitation**: data collected for fraud checks is not reused
  for marketing without a basis. Record the purpose with the field.
- **Pseudonymize** where the purpose allows: analytics keyed by a hashed/
  rotating id rather than the user id; support tooling that shows the
  record without the name until a reason is entered.
- **Encrypt special categories at the application level** (field-level
  encryption with per-tenant or per-record keys; `cryptography.md` §10),
  so a DB dump or a misdirected query does not expose them, and so
  crypto-shredding can implement deletion.
- **Know your processors**: every third party that receives personal data
  (email provider, analytics, error tracking, LLM API, support desk) needs
  a data processing agreement and appears in your records of processing.
  The engineering artifact: a list of outbound integrations and which
  fields they get.
- **Data subject rights** need code paths: export (machine-readable, all
  stores including logs and backups where feasible), deletion (§9), and
  rectification. Build the "delete user" path early; retrofitting it
  across 14 tables, two search indexes, a data warehouse, and S3 is a
  quarter of work.

HIPAA adds: PHI access logging (who viewed which patient record is
mandatory), minimum necessary access, BAAs with every vendor touching
PHI. PCI DSS adds: never store CVV, PAN only tokenized or encrypted with
strict key management, cardholder data environment segmentation; the
practical path is a payment processor's hosted fields so PAN never
touches your servers.

## 9. Retention and deletion

Define retention per data class and per store, write it down, and
automate it:

| Data | Typical retention | Mechanism |
|---|---|---|
| Operational logs | 7-30 days hot, 90 days cold | Log platform retention policy; S3 lifecycle |
| Audit logs | 1-7 years | Separate store with lifecycle; Object Lock for regulated |
| Session records | Session lifetime + short grace | TTL index / cron |
| Password reset / verification tokens | Minutes to an hour | TTL |
| Deleted user accounts | Soft-delete grace (e.g. 30 days) then hard delete | Scheduled job; cascade across stores |
| Backups | As needed for recovery (e.g. 35 days) | Backup lifecycle; deleted user data ages out; or crypto-shredding |
| Analytics events | Aggregate indefinitely; raw with user ids 13-26 months | Pseudonymize or drop ids after the window |
| Support tickets | Business need (years) | Redact PII in closed tickets after N months |
| LLM prompts/completions logs | Days to weeks unless consented for improvement | TTL; separate consent flag |

Deletion must reach: primary DB, read replicas (automatic), search
indexes, caches, object storage, data warehouse/lake, analytics vendors
(their deletion APIs), error trackers, email provider contact lists, and
backups. For backups you cannot rewrite, document that deleted data
persists in backups for up to N days and is never restored to production
without re-applying deletions, or use per-user encryption keys and
destroy the key. Soft delete alone is not deletion.

Test the deletion path end to end with a synthetic user; a quarterly check
that `SELECT ... WHERE user_id = <deleted>` across stores returns nothing
is cheap.

## 10. PII in URLs, referers, and analytics

- URLs are logged by CDNs, load balancers, proxies, browsers (history),
  and sent as `Referer` to third parties loaded on the page. Never put
  emails, names, tokens, or record contents in a query string or path
  when a POST body or an opaque id would do. `GET /users?email=...` ends
  up in six logs.
- `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` on
  sensitive pages) keeps paths from leaking to third parties.
- Analytics and tag managers: configure them not to capture form field
  contents, not to record full URLs when they contain ids, and to mask
  text in session replays (Hotjar/FullStory/LogRocket default masking is
  partial; use `data-private`/`fs-exclude` attributes on sensitive
  elements, or block replay on authenticated pages). A session replay tool
  that records a support agent's screen is a PII firehose to a vendor.
- Error trackers capture request URLs, headers, and breadcrumbs (including
  console logs and fetch URLs). Scrub (§4).
- Email tracking pixels and link redirects contain identifiers; keep them
  opaque and expiring.
- Client-side logging (`console.log` of user objects) ends up in browser
  extensions and screenshots; strip in production builds.
- Push notification payloads pass through Apple/Google; keep content
  generic or encrypted.

## 11. Access to logs

Logs with personal data are a data store; apply the same access control:
SSO + MFA to the log platform, role-based access (engineers see op logs
for their services; audit logs restricted to security/compliance;
customer-content logs restricted and access-logged themselves), no
anonymous or shared credentials, and export/download audited. Alert on
bulk log exports. Log platform API keys are high-value secrets.

For LLM prompt/completion stores specifically: treat as customer content;
restrict to a small group; sample rather than browse; honor deletion
requests.

## 12. Detection

```bash
# Secrets or sensitive fields being logged
rg -n "(console\.(log|info|debug|error)|logger\.(info|debug|warn|error)|log\.(Print|Info|Debug)|logging\.(info|debug)|Rails\.logger|puts|print\()\(.*\b(password|passwd|token|secret|authorization|cookie|api_?key|ssn|card|cvv|process\.env|os\.environ|settings|config)\b" -i
# Whole objects/bodies logged
rg -n "(log|logger|console)\.[a-z]+\(\s*(req\.body|request\.body|request\.data|params|req\.headers|request\.headers|user\b|err\.response)" 
# Debug modes
rg -n "DEBUG\s*=\s*True|debug\s*=\s*True|APP_DEBUG=true|consider_all_requests_local\s*=\s*true|include-stacktrace\s*=\s*always|UseDeveloperExceptionPage|introspection:\s*true|playground:\s*true"
# Stack traces in responses
rg -n "res\.(send|json)\(.*err\.(stack|message)|jsonify\(.*traceback|render.*exception\.message|e\.getMessage\(\)\)|->getMessage\(\)\s*\]"
# PII in query strings
rg -n "\?(email|name|phone|ssn|dob|token|password)=" 
```

Runtime: send a malformed JSON body, a nonexistent id, and an expired
token to the API and read the responses; none should contain a stack
frame, a file path, a SQL fragment, or a framework version. Then grep the
server log for a request you made with a known marker in the
`Authorization` header and confirm the marker is redacted.

Cross-references: generic auth errors in `authn-authz-threats.md`; secret
redaction patterns in `secrets.md`; field-level encryption and crypto-
shredding in `cryptography.md`; prompt logging in `llm-app-security.md`;
cloud audit logging in `cloud-and-infra.md`.
