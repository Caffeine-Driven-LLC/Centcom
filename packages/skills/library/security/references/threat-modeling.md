# Threat modeling in 30 minutes

A lightweight method for modeling one feature before building it: list what
is valuable, where input enters, where trust changes, who can reach what,
and what an attacker would try. Produces a short artifact that drives the
negative tests and the enforcement points. Scales from a single endpoint to
a new service; the method is the same, the time spent differs.

## Contents

1. Why 30 minutes beats either extreme
2. The method, step by step
3. Templates (copy these)
4. Worked example: "share a document with a link"
5. Trust boundary diagrams in text
6. Writing abuse cases that produce tests
7. Prioritizing: likelihood × impact, honestly
8. STRIDE as a prompt list, not a form
9. Where to record it and when to revisit
10. Signs the model is wrong

## 1. Why 30 minutes beats either extreme

Zero minutes produces the default bugs: the id in the URL is trusted, the
price comes from the client, the webhook has no signature check. A two-day
formal exercise produces a document nobody updates and a team that
associates security with delay. Thirty focused minutes on a feature with a
template finds most of the design-level problems, because design-level
problems are usually obvious once someone asks "who else can call this?".

The output is not the document. The output is (a) a list of enforcement
points you now know you need, (b) a list of negative tests you will write
first, and (c) one or two product questions to raise. The document is just
where you park those so the next person can see your reasoning.

## 2. The method, step by step

Timebox each step. Use the template in section 3.

**Minute 0-3: Scope.** One sentence: what does the feature let whom do to
what. "Lets a workspace member generate a public link that grants read
access to a document." If you cannot write this sentence, the feature is
not specified enough to secure.

**Minute 3-8: Assets.** What would someone want to steal, alter, delete, or
deny? Be concrete: the document contents, the list of who viewed it, the
link token itself, the account's quota, the audit trail. Mark each with
confidentiality / integrity / availability relevance. Assets include things
the attacker wants to *use*, not only read: a mail-sending endpoint is an
asset to a spammer.

**Minute 8-13: Entry points.** Every way data or a request enters the
feature. HTTP routes (list them with method and auth requirement),
webhooks, message queue consumers, file uploads, CLI flags, scheduled jobs
that read external state, the database rows written by another feature,
environment variables. For each, write who can hit it: anonymous,
authenticated user, member of the same tenant, admin, internal service.

**Minute 13-18: Trust boundaries.** Where does the trust level change?
Browser → API. API → database. API → third-party. Tenant A's data → tenant
B's view. User-supplied file → image processor. Model output → tool
execution. Draw it as a text diagram (section 5). Every arrow that crosses
a boundary needs validation on the trusted side and encoding on the way
out.

**Minute 18-26: Abuse cases.** Walk the boundaries with STRIDE as a
prompt (section 8). Write each as "An attacker who is [position] can [goal]
by [action]". Aim for 4-8. Include the boring ones (missing authz on the
one endpoint that has an id) because they are the ones that happen.

**Minute 26-30: Prioritize and decide.** Score likelihood and impact
(section 7). For each high item, write the control and where it lives
(middleware, policy class, DB constraint, rate limiter, allowlist). For
anything that is a product decision, write the question. Write the
negative tests as one-line descriptions.

Done. If you ran over, you are writing too much prose; cut to bullets.

## 3. Templates (copy these)

### Feature threat model

```markdown
# Threat model: <feature name>

**Scope:** <one sentence: lets WHO do WHAT to WHAT>
**Date / author / PR:** ...

## Assets
| Asset | C | I | A | Notes |
|---|---|---|---|---|
| Document contents | x | x |   | May include customer PII |
| Share link token | x |   |   | Possession = access |
| View audit log |   | x | x | Compliance relies on it |

## Entry points
| Entry | Who can reach it | Input | Notes |
|---|---|---|---|
| POST /docs/:id/share-links | Workspace member | doc id, expiry, permission | Must own/edit doc |
| GET /s/:token | Anonymous | token in path | The whole point; rate-limit |
| DELETE /share-links/:linkId | Workspace member | link id | Must own link's doc |
| Job: expire-links (cron) | Internal | DB rows | Clock skew? |

## Trust boundaries
<text diagram>

## Abuse cases
| # | Attacker position | Goal | Action | L | I | Score |
|---|---|---|---|---|---|---|
| 1 | Any member of any workspace | Read other workspace's doc | POST share-link with a doc id they do not own | H | H | 9 |
| 2 | Anonymous | Enumerate links | Guess tokens | L | H | 3 |
| 3 | Link holder | Keep access after revoke | Cache token; replay | M | M | 4 |

## Controls and where they live
| Abuse # | Control | Location | Test |
|---|---|---|---|
| 1 | Policy: caller must have edit on doc | `DocumentPolicy.canShare` used by handler | test_share_other_workspace_doc_404 |
| 2 | 128-bit random token; rate limit /s/* by IP | token gen; edge rate limiter | test_token_entropy; test_rate_limit |
| 3 | Check link row is_revoked on every GET | `GET /s/:token` handler | test_revoked_link_404 |

## Open product questions
- Should links be able to grant *edit*? (Expands blast radius of a leaked link.)
- Should we log viewer IPs? (Privacy vs audit.)

## Out of scope / accepted
- DoS on /s/* beyond basic rate limiting (edge handles)
```

### Three-line version (for a small endpoint)

```markdown
Threat model (GET /api/invoices/:id): asset = invoice PII+amounts; entry = authed
user with any id; boundary = user → other tenant's rows. Abuse: IDOR by id
swap (H/H). Control: InvoiceRepo.forAccount(caller.accountId).find(id) → 404.
Test: other tenant's id returns 404.
```

Three lines in a PR description is infinitely better than nothing and
takes two minutes.

## 4. Worked example: "share a document with a link"

Feature: a user clicks "Share", gets a URL like `https://app/s/8f3a...`,
sends it to someone outside the workspace, and that person can read the
document without an account.

**Scope:** Lets a workspace member grant anonymous read access to one
document via a possession-based token, optionally expiring.

**Assets:** document content (C, I), the token (C: possession is access),
the share record (I: tampering could extend expiry or escalate to edit),
the list of who viewed (C for viewers' privacy, I for audit), the
workspace's egress bandwidth (A: public endpoint can be hammered).

**Entry points:**

- `POST /docs/:id/share-links` (member): creates link. Input: `docId` from
  path, `expiresAt`, `permission` from body.
- `GET /s/:token` (anonymous): renders document.
- `DELETE /share-links/:id` (member): revokes.
- `GET /docs/:id/share-links` (member): lists links for a doc.
- Cron `expire-links`: marks expired.
- The document renderer itself, which now receives documents authored by
  users and renders them to anonymous viewers: a stored XSS here reaches
  people who are not even users.

**Trust boundaries:** see diagram in section 5.

**Abuse cases:**

1. Member of workspace X creates a share link for a doc in workspace Y by
   supplying Y's doc id. (Missing object-level authz.) L: high, this is the
   most common bug in the industry. I: high, cross-tenant read.
2. Member with *comment* permission creates a link with `permission: edit`,
   escalating their own access through the link. (Mass assignment / privilege
   escalation via body field.) L: medium. I: high.
3. Anonymous attacker guesses tokens. L: low if tokens are 128+ bits from a
   CSPRNG, high if they are sequential or 6 digits. I: high.
4. Link recipient keeps access after the owner revokes, because the
   renderer caches or the CDN caches `/s/:token`. L: medium. I: medium.
5. Document author embeds a script in the document; anonymous viewers run
   it under the app's origin. L: medium (depends on renderer). I: high
   (anonymous viewers, but also any member who opens it).
6. Attacker floods `/s/:token` with random tokens to enumerate or to run up
   egress costs. L: high (it's public). I: low-medium.
7. Links leak via Referer header when the shared doc contains an external
   image: the token in the URL path is sent to the image host. L: medium.
   I: high (anyone who logs referers gets the doc). Mitigation:
   `Referrer-Policy: no-referrer` on the share page, or token in fragment.
8. Expired link remains valid because the cron is late and the GET handler
   does not check `expiresAt` itself. L: medium. I: medium.

**Controls:**

- (1, 2) A `ShareLinkPolicy` that requires the caller to have *at least the
  permission they are granting* on the doc, invoked by the handler; the
  repository is scoped to the caller's workspace so a foreign doc id is a
  404 before the policy even runs. Body fields allowlisted to `expiresAt`
  and `permission ∈ {read}` for v1 (product decision: edit via link is out
  of scope until there is a reason).
- (3, 6) Token = 32 bytes from CSPRNG, base64url. Rate limit `/s/*` per IP
  and per token prefix; return the same 404 for unknown, revoked and
  expired tokens so none of them can be distinguished by timing or body.
- (4, 8) The GET handler checks `revokedAt IS NULL AND expiresAt > now()`
  on every request; `Cache-Control: private, no-store` on the response; no
  CDN caching of `/s/*`.
- (5) Documents render through the same sanitizer as the in-app view;
  share page has a CSP with no `unsafe-inline`. See
  `xss-and-output-encoding.md`.
- (7) `Referrer-Policy: no-referrer` on `/s/*`; external images proxied or
  blocked on shared pages.

**Negative tests to write first:** share a foreign doc id → 404; share with
`permission: edit` as a commenter → 403; GET revoked token → 404; GET
expired token → 404 even before the cron runs; response headers on `/s/*`
include `no-store` and `no-referrer`; rendered doc with `<script>` contains
no script element.

**Product questions:** Edit via link? Log viewer IPs? Maximum link
lifetime?

That took about 25 minutes and found eight things, two of which (the
Referer leak and the renderer reaching anonymous users) are not on any
scanner's list.

## 5. Trust boundary diagrams in text

A diagram is a list of boxes and the arrows between them, with a mark on
each arrow that crosses a trust level. Text is fine and lives in the PR.

```
  [Anonymous browser]                [Member browser]
          |                                  |
          | GET /s/:token                    | POST /docs/:id/share-links
          | (untrusted; rate-limit)          | (session cookie; CSRF token)
  ========|==================================|========= boundary: internet -> app
          v                                  v
  +-------------------------------------------------------+
  |  API                                                  |
  |   authn middleware -> request.user (or anonymous)     |
  |   ShareLinkPolicy (object-level authz)                |
  |   ShareLinkRepo.forWorkspace(user.ws)   <-- scoping   |
  +-----------+-------------------------------+-----------+
              |                               |
  ============|===============================|========== boundary: app -> storage
              v                               v
       [Postgres: documents,            [Object storage: doc bodies]
        share_links (token hash)]        (signed URLs, 5 min TTL)
              ^
  ============|========================================== boundary: external -> app
              |
       [Cron: expire-links]   (internal; still validates row state)

  Renderer: documents (authored by members, UNTRUSTED content) -> sanitizer -> HTML
  ===================== boundary: stored content -> anonymous viewer's browser
```

Conventions that help: a `====` line for each boundary, labeled; an
annotation in parentheses on each arrow saying what makes it safe; a
`<--` note where scoping or policy enforcement happens. Use it to spot
arrows with no annotation: those are the untreated crossings.

For an agent/LLM feature the diagram gains a box for the model and arrows
for "retrieved content → prompt" and "model output → tool call"; both are
boundaries. See `llm-app-security.md`.

## 6. Writing abuse cases that produce tests

An abuse case is good when you can turn it into an HTTP request (or a
function call) that must fail. Compare:

- Weak: "An attacker could access unauthorized data."
- Usable: "A member of workspace X, authenticated, sends
  `POST /docs/<Y's doc id>/share-links` and receives 201 with a working
  link." → test: `expect(res.status).toBe(404)`.

Pattern: **position** (anonymous / authenticated user / same-tenant member
/ admin / insider with DB access / supply-chain: compromised dependency),
**goal** (read, modify, delete, deny, escalate, abuse-for-spam, bypass
payment), **action** (the concrete request or sequence).

Positions worth always considering:

- *Authenticated, unprivileged user*: the position most bugs are exploited
  from. They have a valid session and a tool like the browser devtools.
- *Same-tenant low-role member*: tests role boundaries.
- *Former member*: tests revocation and token lifetime.
- *Someone with a leaked link/token*: tests possession-based access.
- *Your own frontend, lying*: tests that the server recomputes prices,
  roles, owner ids.
- *A compromised third party*: webhook sender, OAuth provider, CDN,
  dependency. Tests signature checks and least privilege.

Business-logic abuse lives here too: negative quantities, applying a coupon
twice via concurrent requests, moving an order from `shipped` back to
`cart`, buying with a currency the price list does not define. Walk the
state machine and ask which transitions the server actually forbids.

## 7. Prioritizing: likelihood × impact, honestly

Score each on a 1-3 scale and multiply; sort. The point is relative order,
not false precision.

**Likelihood** considers: who can reach the entry point (anonymous = more
likely), how much skill is needed (changing an id in a URL = none),
whether tooling exists (scanners find reflected XSS and missing headers
automatically), and whether the attacker has a motive (money, data, spam
capacity).

- 3: Reachable by anyone or any user with trivial effort; commonly
  exploited class (IDOR, injection, missing authz, public bucket).
- 2: Needs an account in the right position, or a second condition
  (a leaked link, a specific misconfiguration).
- 1: Needs insider access, a race window measured in milliseconds, or a
  chain of two other bugs.

**Impact** considers: data sensitivity (PII, health, payment, credentials
> internal metadata), breadth (all tenants > one user), reversibility
(deletion without backup > read), and legal exposure (breach notification
thresholds).

- 3: Cross-tenant or all-user data exposure, RCE, credential theft, funds
  movement, permanent data loss.
- 2: Single-user data exposure, privilege escalation within a tenant,
  persistent XSS, significant cost abuse.
- 1: Information useful only for a further attack (version banner,
  verbose error), low-value DoS, self-XSS.

Scores of 6-9 get a control and a test before merge. 3-4 get a control or
an explicit acceptance with reason. 1-2 get a note. Do not inflate low
scores to seem thorough; a model where everything is critical gives the
team no information.

Common calibration mistakes: rating "attacker needs an account" as low
likelihood (accounts are free); rating a DoS as high impact for an internal
tool (nobody is attacking it); rating missing rate limiting on login as low
when credential stuffing is the single most common attack on consumer
apps.

## 8. STRIDE as a prompt list, not a form

STRIDE is six questions to ask about each boundary crossing. Do not fill
in a 6×N matrix; just walk the arrows with the questions in mind.

| Letter | Question to ask at each arrow | Typical control |
|---|---|---|
| Spoofing | Can the caller pretend to be someone else? Is identity verified here or assumed from upstream? | Authentication; signed webhooks; mTLS between services; verifying `iss`/`aud` on tokens |
| Tampering | Can the data be altered in transit or at rest? Does the receiver trust fields the sender controls? | TLS; integrity (MAC/signature); server-side recomputation; DB constraints |
| Repudiation | Can someone deny doing it? Would you be able to prove who changed what? | Audit log with actor, action, target, time; immutable or append-only |
| Information disclosure | What leaks through the response, errors, timing, logs, caches, referers, side channels? | Generic errors; uniform timing; `no-store`; redaction; `Referrer-Policy` |
| Denial of service | What is expensive here and who can trigger it? Unbounded inputs, regexes, fan-out, storage? | Limits on size, rate, time, concurrency; queues; quotas |
| Elevation of privilege | Can a lower position gain a higher one? Through a body field, a race, a confused deputy, an injection? | Object- and function-level authz; allowlisted writable fields; least privilege |

For an LLM-integrated feature, add a seventh prompt: **"What if the content
the model reads is adversarial?"** It is spoofing and elevation at once.

## 9. Where to record it and when to revisit

Record it where it will be seen by whoever changes the code next:

- Small feature: the PR description, under a "Threat model" heading. It
  gets reviewed with the code.
- Medium feature or new service: `docs/threat-models/<feature>.md`, linked
  from the ADR or design doc, with a "last reviewed" date.
- Whole system: a living document with the trust boundary diagram and a
  table of entry points. Update it when a boundary moves (new external
  integration, new tenant model, new public endpoint).

Also record the *tests* with a reference back: a comment on the test
`// threat model abuse case #1` ties the test to the reasoning so a future
refactor does not delete it as "redundant".

Revisit when: a new entry point appears (new route, webhook, job), a trust
boundary moves (a service becomes internet-facing, a feature goes multi-
tenant), a new class of data is stored (payments, health), a dependency
gains broad permissions, or an incident shows the model was wrong.

## 10. Signs the model is wrong

- Every abuse case is about the network ("MITM", "DDoS") and none are
  about an authenticated user changing an id. Real attackers log in.
- No entry point is marked "anonymous" but the app has a login page, a
  password reset, a webhook, and a public asset route.
- The controls column says "validate input" without naming the field, the
  rule, and the sink.
- There are no product questions. Features that touch sharing, roles,
  retention or payments always have at least one.
- The highest-scored item is one the team cannot act on ("nation-state
  compromises the cloud provider"). Score what you can change.
- The model was written after the code and matches it perfectly. Models
  written after the fact find nothing because the author is explaining
  rather than questioning. Write it before, or have someone other than the
  implementer write it after.

Cross-references: controls for each class are in `injection.md`,
`authn-authz-threats.md`, `csrf-cors-headers.md`, `ssrf-and-server-side.md`;
for the test side see `security-testing.md`; for the audit of an existing
system where no model exists see `code-audit-playbook.md`.
