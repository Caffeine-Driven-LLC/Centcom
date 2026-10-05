# Backend plan · 100 lanes (B001-B100)

Repo: `Centcom-backend` · Rules: [`plan/GUIDELINES.md`](../GUIDELINES.md) · Format: [`plan/LANE_CARD_SPEC.md`](../LANE_CARD_SPEC.md) · Connection points: [`contracts/`](../../contracts/index.json)

- **100 lanes**: 24 small (≤1 d), 60 medium (≤3 d), 16 large (≤5 d) · 284 person-days of work in total
- **13 dependency layers** · critical path **45 days** (see [`GRAPH.md`](../GRAPH.md)) · parallelism in layer 1: 1 lanes can start on day one
- Every lane card is independent: it names its inputs (contracts), outputs (deliverables), and how to build with no counterpart (`build_against`).
- **No lane in this plan depends on a lane in the other plan.** The two sides meet only at contract IDs.


### P0 Foundations

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B001](B001.md) | Monorepo scaffold and toolchain | M | platform | - | - | G0 |
| [B002](B002.md) | CI pipeline (typecheck, lint, test, build, security scan, contract-lock check) | M | platform | B001 | - | G0 |
| [B003](B003.md) | Contract codegen package (types and validators from contracts/) | M | platform | B001 | CT-IDS, CT-VER | G0 |
| [B004](B004.md) | Typed configuration and secrets loader | S | platform | B001 | - | G0 |
| [B005](B005.md) | Structured logging, request ids, redaction | S | platform | B004 | - | G0 |
| [B006](B006.md) | Error layer: problem+json, error registry, error handler | M | platform | B003, B005 | CT-ERR | G1 |
| [B007](B007.md) | Database package: Postgres client, migration runner, conventions | M | data | B004 | - | G1 |
| [B008](B008.md) | Core schema v1 migration (users, devices, workspaces, memberships, sessions skeleton) | M | data | B007 | - | G1 |
| [B009](B009.md) | Redis abstraction: pub/sub, KV, rate-limit primitives (in-memory + Redis impls) | M | platform | B004 | - | G1 |
| [B010](B010.md) | Test harness: containers, factories, contract test runner | M | qa | B002, B007 | - | G1 |
| [B011](B011.md) | Mock client simulator (scripted fake clients speaking the WS protocol) | L | qa | B003, B010 | - | G2 |
| [B012](B012.md) | Local dev environment: compose stack, seed data, one-command up | S | platform | B008, B009 | - | G1 |

### P1 Identity

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B013](B013.md) | User model and repository | S | identity | B006, B008 | - | G1 |
| [B014](B014.md) | Passwordless email login (magic link) | M | identity | B013, B032 | - | G1 |
| [B015](B015.md) | Social login providers (GitHub, Google) | M | identity | B013 | - | G1 |
| [B016](B016.md) | Device authorization grant endpoints (RFC 8628) | L | identity | B013, B017 | CT-AUTH | G1 |
| [B017](B017.md) | Token service: JWT issue, refresh rotation with reuse detection, JWKS, revocation | L | identity | B004, B013 | CT-AUTH | G1 |
| [B018](B018.md) | Web session login: authorization code with PKCE, CSRF protection | M | identity | B017 | CT-AUTH | G1 |
| [B019](B019.md) | API keys: create, scope, hash, rotate, revoke | M | identity | B017, B021 | CT-AUTH, CT-API-ACCOUNTS | G4 |
| [B020](B020.md) | Device registry, key registration, revoke | M | identity | B017 | CT-AUTH, CT-API-ACCOUNTS | G1 |
| [B021](B021.md) | RBAC engine: roles, permission checks, policy tests | M | identity | B006, B008 | CT-RBAC | G1 |
| [B022](B022.md) | Accounts endpoints: /v1/me, preferences | S | identity | B013, B021 | CT-API-ACCOUNTS | G1 |
| [B023](B023.md) | Rate limiting and abuse protection middleware | M | platform | B006, B009 | CT-PAGE | G1 |
| [B024](B024.md) | Idempotency-Key middleware | S | platform | B006, B009 | CT-PAGE | G1 |
| [B025](B025.md) | Pagination and filtering library | S | platform | B006 | CT-PAGE | G1 |
| [B026](B026.md) | Account deletion and data export | M | identity | B013, B036 | CT-API-ACCOUNTS | G6 |

### P2 Workspaces

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B027](B027.md) | Workspace CRUD endpoints | M | identity | B008, B021, B036 | CT-API-WORKSPACES | G3 |
| [B028](B028.md) | Membership and workspace role management | M | identity | B027 | CT-API-WORKSPACES | G3 |
| [B029](B029.md) | Invites: create, accept, revoke, expiry, key-bundle storage | L | identity | B028, B032 | CT-API-WORKSPACES | G5 |
| [B030](B030.md) | Seat accounting and seat-limit enforcement | S | billing | B028, B069 | - | G4 |
| [B031](B031.md) | Member slot assignment service | S | realtime | B028 | CT-WS-SESSION-EVENTS | G3 |
| [B032](B032.md) | Transactional email service with templates and provider abstraction | M | platform | B004, B006 | - | G5 |
| [B033](B033.md) | Deep link and join URL service | S | identity | B029 | CT-DEEPLINK | G5 |
| [B034](B034.md) | Workspace settings and policies | S | identity | B027 | CT-API-WORKSPACES | G5 |
| [B035](B035.md) | Projects registry | S | identity | B027 | CT-API-WORKSPACES | G5 |
| [B036](B036.md) | Audit event emitter library | S | platform | B005, B008 | - | G5 |

### P3 Relay

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B037](B037.md) | Relay service skeleton: ws server, health, graceful shutdown | M | realtime | B001, B005 | CT-STATUS, CT-VER | G2 |
| [B038](B038.md) | Relay handshake and authentication (relay tickets, protocol negotiation) | L | realtime | B003, B017, B037 | CT-WS-ENVELOPE, CT-VER | G2 |
| [B039](B039.md) | Envelope codec and schema-enforced validation with size limits | M | realtime | B003, B037 | CT-WS-ENVELOPE | G2 |
| [B040](B040.md) | Heartbeat, liveness and connection state machine | M | realtime | B038, B039 | CT-WS-ENVELOPE | G2 |
| [B041](B041.md) | Sequencing, acks and at-least-once delivery per session | L | realtime | B040 | CT-WS-ENVELOPE | G2 |
| [B042](B042.md) | Resume and replay from the hot buffer and durable log | L | realtime | B041, B055 | CT-RESUME, CT-WS-ENVELOPE | G2 |
| [B043](B043.md) | Session room registry and membership authorisation | M | realtime | B028, B038 | CT-WS-ENVELOPE | G3 |
| [B044](B044.md) | Fan-out engine for opaque ciphertext routing | M | realtime | B041, B043 | CT-WS-SESSION-EVENTS | G3 |
| [B045](B045.md) | Cross-node routing over pub/sub (multi-instance relay) | L | realtime | B009, B044 | - | G3 |
| [B046](B046.md) | Backpressure and slow-consumer handling | M | realtime | B044 | CT-WS-ENVELOPE | G3 |
| [B047](B047.md) | Presence service (ephemeral, TTL, coalescing) | M | realtime | B009, B043 | CT-WS-PRESENCE | G5 |
| [B048](B048.md) | Cursor and typing throttling | S | realtime | B047 | CT-WS-PRESENCE | G5 |
| [B049](B049.md) | Key-grant routing and epoch rotation signalling | M | realtime | B044 | CT-WS-SESSION-EVENTS | G3 |
| [B050](B050.md) | Relay privacy enforcement: no-plaintext tests, log scrubbing | M | security | B005, B049 | - | G6 |
| [B051](B051.md) | Control commands: kick, mute, role, transfer host, end, policy | L | realtime | B021, B044 | CT-WS-CONTROL | G3 |
| [B052](B052.md) | Queue service: ordering, dedupe, approve, reorder, caps, auto-approve policy | L | realtime | B009, B044 | CT-WS-QUEUE | G3 |
| [B053](B053.md) | Session lifecycle service: create, live, paused, ended, expired, host-loss policy | M | realtime | B007, B043 | CT-API-SESSIONS | G2 |
| [B054](B054.md) | Session REST endpoints: list, create, get, join-token, claim-host | M | realtime | B021, B025, B053, B017, B031 | CT-API-SESSIONS | G2 |
| [B055](B055.md) | Encrypted history store (blob storage of ciphertext frames) | M | data | B007, B008, B039 | CT-RESUME | G2 |
| [B056](B056.md) | Snapshot service: descriptors, pre-signed upload, commit, pruning | M | data | B055 | CT-RESUME, CT-API-SESSIONS | G2 |

### P4 Fleet

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B057](B057.md) | Agent registry (ids, owners, modes, states) | M | realtime | B008, B044 | CT-WS-SESSION-EVENTS | G5 |
| [B058](B058.md) | Agent state validation against the state-map contract | S | realtime | B057 | CT-WS-SESSION-EVENTS | G5 |
| [B059](B059.md) | File-lock coordination service (advisory, TTL, fairness) | M | realtime | B009, B044 | CT-WS-SESSION-EVENTS | G5 |
| [B060](B060.md) | Approval routing: tool approvals, delegates, timeouts | M | realtime | B044, B051 | CT-WS-SESSION-EVENTS | G5 |
| [B061](B061.md) | Branch and conflict signalling | S | realtime | B057 | CT-WS-SESSION-EVENTS | G5 |
| [B062](B062.md) | Reactions and comments persistence | S | data | B007, B044 | CT-WS-SESSION-EVENTS | G5 |
| [B063](B063.md) | Notification dispatcher core: events to channels | M | platform | B009, B036 | CT-NOTIF-PAYLOAD | G5 |
| [B064](B064.md) | Push delivery: web push, APNs, FCM abstraction | M | platform | B063 | CT-API-NOTIFY | G5 |
| [B065](B065.md) | In-app notification inbox API | S | platform | B025, B063 | CT-API-NOTIFY | G5 |
| [B066](B066.md) | Notification preferences and quiet hours | S | platform | B065 | CT-API-NOTIFY | G5 |
| [B067](B067.md) | Presence history and last-seen API | S | realtime | B047 | CT-WS-PRESENCE | G5 |
| [B068](B068.md) | Share links and viewer-only guest tokens | M | identity | B017, B054, B031 | CT-API-SESSIONS | G5 |

### P5 Billing

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B069](B069.md) | Plans and entitlements model | M | billing | B008 | CT-ENTITLEMENTS, CT-API-BILLING | G4 |
| [B070](B070.md) | Stripe integration: customers and subscriptions | L | billing | B027, B069 | CT-API-BILLING | G4 |
| [B071](B071.md) | Checkout and customer portal sessions | M | billing | B070 | CT-API-BILLING | G4 |
| [B072](B072.md) | Stripe webhook ingestion: verified, idempotent, replay-safe | M | billing | B070 | - | G4 |
| [B073](B073.md) | Seat quantity sync and proration preview | M | billing | B030, B072 | CT-API-BILLING | G4 |
| [B074](B074.md) | Usage event ingestion API | M | billing | B008, B017, B024 | CT-API-USAGE | G4 |
| [B075](B075.md) | Usage aggregation and quota computation | M | billing | B069, B074 | CT-ENTITLEMENTS, CT-API-BILLING | G4 |
| [B076](B076.md) | Quota signalling: warnings at 80 and 100 percent to sessions and owners | M | billing | B044, B075 | CT-ENTITLEMENTS | G4 |
| [B077](B077.md) | Invoices, receipts and tax endpoints | S | billing | B071 | CT-API-BILLING | G4 |
| [B078](B078.md) | Dunning and grace-period state machine | M | billing | B072, B053 | CT-API-BILLING, CT-ENTITLEMENTS | G4 |
| [B079](B079.md) | Trials, coupons and promotions | S | billing | B070 | CT-API-BILLING, CT-ENTITLEMENTS | G4 |
| [B080](B080.md) | Entitlement cache and enforcement middleware | M | billing | B009, B069 | CT-ENTITLEMENTS, CT-API-BILLING | G4 |

### P6 Platform

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B081](B081.md) | Outgoing webhooks: endpoints, delivery, retries, signing | L | platform | B009, B036 | CT-API-WEBHOOKS, CT-WEBHOOKS | G5 |
| [B082](B082.md) | Audit log API and export | M | platform | B025, B036 | CT-API-AUDIT | G5 |
| [B083](B083.md) | Feature flags and remote config service | M | platform | B008, B017 | CT-API-FLAGS | G5 |
| [B084](B084.md) | Release manifest and update channel service | M | platform | B008 | CT-API-RELEASES | G6 |
| [B085](B085.md) | Telemetry ingest: schema validation, PII scrub, retention | M | platform | B006, B008 | CT-TELEMETRY | G6 |
| [B086](B086.md) | Status endpoints and public status feed | S | platform | B037 | CT-STATUS | G1 |
| [B087](B087.md) | Internal admin API and support tooling | M | platform | B021, B036 | - | G6 |
| [B088](B088.md) | Internal admin console (minimal web UI) | M | platform | B087 | - | G6 |
| [B089](B089.md) | Metadata search across sessions and members | S | data | B054 | - | G6 |
| [B090](B090.md) | Data retention and purge jobs | M | data | B008, B055 | - | G6 |

### P7 Ops

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [B091](B091.md) | Infrastructure as code: environments dev, stage, prod | L | infra | B001 | - | G6 |
| [B092](B092.md) | Deployment pipeline: blue/green, safe migrations, rollback | L | infra | B002, B091 | - | G6 |
| [B093](B093.md) | Observability: metrics, traces, dashboards, SLOs | M | infra | B005, B037 | - | G6 |
| [B094](B094.md) | Alerting and on-call runbooks | M | infra | B093 | - | G6 |
| [B095](B095.md) | Load testing and capacity model | L | qa | B045, B093 | - | G6 |
| [B096](B096.md) | Chaos and failure-mode tests | M | qa | B095 | - | G6 |
| [B097](B097.md) | Security hardening: headers, WAF rules, secret scanning, dependency policy | M | security | B002 | - | G6 |
| [B098](B098.md) | Threat model and penetration-test preparation | M | security | B097 | - | G6 |
| [B099](B099.md) | Backup, restore and disaster-recovery drills | M | infra | B007, B091 | - | G6 |
| [B100](B100.md) | Provider conformance suite and release gate | L | qa | B011, B042, B047, B052, B054 | - | G6 |
