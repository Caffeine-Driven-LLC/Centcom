# Roadmap

What ships, in what order. A **milestone** is something a person can demo. Both sides work **in parallel**: the backend track starts at M0 and is ready by the time the client reaches M3, so M1 and M2 (the free, client-only product) can ship and be tested while the server is being built.

```
time ->   M0 ───► M1 ───► M2 ───► M3 ───► M4 ───► M5 ───► M6
client    scaffold  solo    LAN      accounts teams    fleet    launch
          + mocks   agent   multi-   + relay  + money  + polish
                    in TUI  player   client   + web
backend   scaffold  ·······················build the server in parallel·········
          + mocks   (identity, relay, billing lanes run alongside M1-M2)
```

**Recommended first release: M1 + M2** (client only, no server, no accounts). It proves the core idea (several people and agents on one project) before any backend or billing exists.

| Milestone | What ships | Lanes (client / backend) | Person-days (client / backend) | Gate |
|---|---|---|---|---|
| **M0** Contracts and scaffolding | Both repos build and test in CI, the contracts are frozen and locked, and each side has the mock of the other so everyone can work alone. | 12 / 12 | 26 / 32 | G0 |
| **M1** Solo agent in the terminal | A person installs Centcom, it finds their own Claude Code and/or Codex, and they work with agents in git worktrees in a polished TUI with the mascot. No network, no account. | 39 / 0 | 109 / 0 | none (demo script) |
| **M2** LAN multiplayer (free tier) | Two machines on the same Wi-Fi share one command post with no backend and no account: pair with a code, queue prompts, host approves, everything end-to-end encrypted. | 17 / 0 | 59 / 0 | G3 (LAN variant against the client simulator) |
| **M3** Accounts and relay | Sign in to Centcom, create a hosted session, and work together from anywhere through the relay, with resume after a dropped connection. | 3 / 46 | 9 / 140 | G1, G2, G3 |
| **M4** Teams and money | Workspaces with members and roles, invites, plans and checkout, entitlements, quotas, notifications, and the first web screens. | 11 / 21 | 33 / 51 | G4 |
| **M5** Fleet and polish | Branch-mode fleets across people, file locks, webhooks, audit log, updates, flags and telemetry, and the rest of the web app. | 14 / 14 | 36 / 36 | G5 |
| **M6** Launch | Production readiness: infrastructure, load and chaos tests, security review, installers, docs, accessibility, and both conformance suites green. | 8 / 6 | 26 / 22 | G6 |
| **Later** After launch | Useful but not needed for launch. | 1 / 2 | 1 / 4 | - |

## How long will it take?

Rough calendar time to reach a milestone, per side, from the lane sizes: `weeks = max(longest dependency chain, person-days / (people x 0.8)) / 5`. The 0.8 allows for review, meetings and context switching. These are planning numbers, not promises.

| Reach | Side | Person-days | Longest chain (days) | 2 people | 3 people | 4 people |
|---|---|--:|--:|--:|--:|--:|
| M2 | client | 194 | 32 | 24 wk | 16 wk | 12 wk |
| M2 | backend | 32 | 15 | 4 wk | 3 wk | 3 wk |
| M3 | client | 203 | 32 | 25 wk | 17 wk | 13 wk |
| M3 | backend | 172 | 39 | 22 wk | 14 wk | 11 wk |
| M4 | client | 236 | 32 | 30 wk | 20 wk | 15 wk |
| M4 | backend | 223 | 39 | 28 wk | 19 wk | 14 wk |
| M6 | client | 298 | 37 | 37 wk | 25 wk | 19 wk |
| M6 | backend | 281 | 45 | 35 wk | 23 wk | 18 wk |


## M0 · Contracts and scaffolding

Both repos build and test in CI, the contracts are frozen and locked, and each side has the mock of the other so everyone can work alone.

- **Who:** both  ·  **Gate:** G0
- **Demo:** `pnpm test` is green in both repos; the mock backend and the client simulator start; `lock.py --compare` says identical.
- **Done when:**
  - Contract validators and plan validators run in CI
  - Codegen produces types from `contracts/` in both repos
  - Mock backend (C007) and client simulator (B011) run scripted scenarios
  - Local dev environments start with one command
- **Effort:** client 26 person-days (longest chain 12 d) · backend 32 person-days (longest chain 15 d)

**Client lanes (12):**

- [C001](client/C001.md) Monorepo scaffold and toolchain (M)
- [C002](client/C002.md) CI pipeline: typecheck, lint, test, build matrix, contract-lock check (M)
- [C003](client/C003.md) Protocol package: types and validators generated from contracts/ (M)
- [C004](client/C004.md) Layered configuration system (defaults, user, project, env, flags) (S)
- [C005](client/C005.md) Logging and diagnostics with redaction (S)
- [C006](client/C006.md) Client error model: problem+json to typed errors and user messages (S)
- [C007](client/C007.md) Mock backend: REST from OpenAPI plus WebSocket relay simulator (L)
- [C008](client/C008.md) Test harness: vitest setup, pty and TUI snapshot tester, fixtures (M)
- [C009](client/C009.md) Theme and mascot packages from the design system (M)
- [C010](client/C010.md) Opt-in telemetry client (S)
- [C011](client/C011.md) Local development environment and example fixtures (S)
- [C012](client/C012.md) Release engineering skeleton: versioning, changesets, signing placeholders (S)

**Backend lanes (12):**

- [B001](backend/B001.md) Monorepo scaffold and toolchain (M)
- [B002](backend/B002.md) CI pipeline (typecheck, lint, test, build, security scan, contract-lock check) (M)
- [B003](backend/B003.md) Contract codegen package (types and validators from contracts/) (M)
- [B004](backend/B004.md) Typed configuration and secrets loader (S)
- [B005](backend/B005.md) Structured logging, request ids, redaction (S)
- [B006](backend/B006.md) Error layer: problem+json, error registry, error handler (M)
- [B007](backend/B007.md) Database package: Postgres client, migration runner, conventions (M)
- [B008](backend/B008.md) Core schema v1 migration (users, devices, workspaces, memberships, sessions skeleton) (M)
- [B009](backend/B009.md) Redis abstraction: pub/sub, KV, rate-limit primitives (in-memory + Redis impls) (M)
- [B010](backend/B010.md) Test harness: containers, factories, contract test runner (M)
- [B011](backend/B011.md) Mock client simulator (scripted fake clients speaking the WS protocol) (L)
- [B012](backend/B012.md) Local dev environment: compose stack, seed data, one-command up (S)

## M1 · Solo agent in the terminal

A person installs Centcom, it finds their own Claude Code and/or Codex, and they work with agents in git worktrees in a polished TUI with the mascot. No network, no account.

- **Who:** client only  ·  **Gate:** none (demo script)
- **Demo:** Run `centcom`, check `centcom provider status`, give a task, approve a command, see the diff, run two agents on two branches.
- **Done when:**
  - Both engines pass golden-transcript tests offline
  - TUI snapshots pass at 80x24 and under NO_COLOR
  - Permission prompts, diff view, fleet panel, spinner and mascot work end to end
  - No credential is ever read or logged (secret-pattern tests)
- **Effort:** client 109 person-days (longest chain 21 d) · backend 0 person-days (longest chain 0 d)

**Client lanes (39):**

- [C013](client/C013.md) Agent runner daemon hosting AgentEngine processes (claude, codex) (L)
- [C014](client/C014.md) Agent session state machine emitting contract state names (M)
- [C015](client/C015.md) Permission policy engine bridging engine approval requests (L)
- [C016](client/C016.md) Command risk classification and sandbox settings passed to the engines (M)
- [C017](client/C017.md) Git worktree manager (M)
- [C019](client/C019.md) Context visibility: usage display and compaction requests through the engine (M)
- [C020](client/C020.md) Skills pack: install and manage Claude Code skills and Codex AGENTS.md guidance (M)
- [C021](client/C021.md) MCP server manager: configure and show status through the engines (M)
- [C022](client/C022.md) Hooks and settings manager for the engines’ native hooks (M)
- [C023](client/C023.md) Memory files: CLAUDE.md and AGENTS.md editing and sync (S)
- [C025](client/C025.md) Internal typed event bus (S)
- [C026](client/C026.md) Local transcript persistence and engine session resume (M)
- [C027](client/C027.md) Checkpoints and rewind (M)
- [C028](client/C028.md) Model selection through the engines (S)
- [C029](client/C029.md) Usage and cost display from engine reports (S)
- [C030](client/C030.md) Interrupt and cancel semantics (S)
- [C031](client/C031.md) Terminal capability detection and colour tiers (S)
- [C032](client/C032.md) TUI theme engine: tokens to ANSI, light and dark, NO_COLOR (M)
- [C033](client/C033.md) Half-block pixel renderer and Cento terminal component (M)
- [C034](client/C034.md) TUI shell: Ink app skeleton, layout, resize (M)
- [C035](client/C035.md) Prompt input: multiline, history, paste, slash commands (L)
- [C036](client/C036.md) Transcript view with virtualised scrollback (L)
- [C037](client/C037.md) Diff view (M)
- [C038](client/C038.md) Permission prompt UI (M)
- [C039](client/C039.md) Status line and footer (S)
- [C040](client/C040.md) Spinner and verb rotation (S)
- [C041](client/C041.md) Command palette (M)
- [C042](client/C042.md) Fleet panel: agent list, states, needs-you ordering (M)
- [C043](client/C043.md) Task list and progress components (S)
- [C044](client/C044.md) Toast and notice system (S)
- [C045](client/C045.md) Keybinding system and help screen (M)
- [C046](client/C046.md) Mascot state driver: state map to animations, caps, dwell rules (M)
- [C047](client/C047.md) Settings commands: theme, mascot, spinner, motion, density (S)
- [C048](client/C048.md) First-run onboarding and init (M)
- [C050](client/C050.md) Non-interactive mode: print, JSON output, pipes (M)
- [C101](client/C101.md) Engine abstraction: AgentEngine interface, capabilities and normalised event stream (L)
- [C102](client/C102.md) Claude Code engine: drive the user’s own claude binary (stream-json, resume, approvals bridge) (L)
- [C103](client/C103.md) Codex engine: drive the user’s own codex binary (app-server JSON-RPC, exec fallback) (L)
- [C104](client/C104.md) Provider detection and login handoff: provider status, login, logout, doctor checks (M)

## M2 · LAN multiplayer (free tier)

Two machines on the same Wi-Fi share one command post with no backend and no account: pair with a code, queue prompts, host approves, everything end-to-end encrypted.

- **Who:** client only  ·  **Gate:** G3 (LAN variant against the client simulator)
- **Demo:** Laptop A hosts, laptop B joins with the pairing code, B queues a prompt, A approves, the agent runs, both see the stream, B sees presence.
- **Done when:**
  - Host and guest engines pass the shared event fixtures
  - Crypto passes the known-answer vectors; pairing passes the CPace vectors
  - Queue, control and presence behave per contract with two real processes
  - Who-pays gate blocks subscription-backed shared sessions by default
- **Effort:** client 59 person-days (longest chain 21 d) · backend 0 person-days (longest chain 0 d)

**Client lanes (17):**

- [C051](client/C051.md) HTTP API client generated from OpenAPI (L)
- [C054](client/C054.md) Relay WebSocket client: handshake, envelope, heartbeat (L)
- [C055](client/C055.md) Reliable delivery: sequence, ack, resume, replay, dedupe (L)
- [C056](client/C056.md) End-to-end crypto module: keys, frames, grants, rotation (L)
- [C057](client/C057.md) Session client: create, join, leave, host mode (M)
- [C058](client/C058.md) Queue client: submit, track, cancel, host controls (M)
- [C059](client/C059.md) Presence and cursor client (S)
- [C060](client/C060.md) Control commands client (S)
- [C061](client/C061.md) Remote approval routing client (M)
- [C067](client/C067.md) Feature flags client (S)
- [C071](client/C071.md) LAN discovery over mDNS (M)
- [C072](client/C072.md) LAN host server speaking the session protocol (L)
- [C073](client/C073.md) LAN pairing with PAKE and device trust (L)
- [C074](client/C074.md) Transport abstraction: LAN, relay, local behind one interface (M)
- [C075](client/C075.md) Host session engine: queue, approvals, broadcast, history (L)
- [C076](client/C076.md) Guest session engine: join, send, render remote transcript (M)
- [C105](client/C105.md) Who-pays policy: runs-on banner, command-post gate, kill switches, policy table (M)

## M3 · Accounts and relay

Sign in to Centcom, create a hosted session, and work together from anywhere through the relay, with resume after a dropped connection.

- **Who:** both  ·  **Gate:** G1, G2, G3
- **Demo:** `centcom login` (device flow), create a hosted session, a teammate joins from another network, kill the connection and watch it resume.
- **Done when:**
  - Device flow works against the real API
  - Relay handshake, sequencing, resume and queue pass the provider and consumer conformance suites
  - Relay logs and storage contain no plaintext (privacy tests)
  - Dev and stage environments deploy from CI
- **Effort:** client 9 person-days (longest chain 6 d) · backend 140 person-days (longest chain 29 d)

**Client lanes (3):**

- [C052](client/C052.md) Auth client: device flow login, keychain token store, refresh (L)
- [C053](client/C053.md) Account and device commands (login, logout, whoami, devices) (S)
- [C063](client/C063.md) Offline mode and reconnection behaviour (M)

**Backend lanes (46):**

- [B013](backend/B013.md) User model and repository (S)
- [B014](backend/B014.md) Passwordless email login (magic link) (M)
- [B015](backend/B015.md) Social login providers (GitHub, Google) (M)
- [B016](backend/B016.md) Device authorization grant endpoints (RFC 8628) (L)
- [B017](backend/B017.md) Token service: JWT issue, refresh rotation with reuse detection, JWKS, revocation (L)
- [B018](backend/B018.md) Web session login: authorization code with PKCE, CSRF protection (M)
- [B019](backend/B019.md) API keys: create, scope, hash, rotate, revoke (M)
- [B020](backend/B020.md) Device registry, key registration, revoke (M)
- [B021](backend/B021.md) RBAC engine: roles, permission checks, policy tests (M)
- [B022](backend/B022.md) Accounts endpoints: /v1/me, preferences (S)
- [B023](backend/B023.md) Rate limiting and abuse protection middleware (M)
- [B024](backend/B024.md) Idempotency-Key middleware (S)
- [B025](backend/B025.md) Pagination and filtering library (S)
- [B026](backend/B026.md) Account deletion and data export (M)
- [B027](backend/B027.md) Workspace CRUD endpoints (M)
- [B028](backend/B028.md) Membership and workspace role management (M)
- [B029](backend/B029.md) Invites: create, accept, revoke, expiry, key-bundle storage (L)
- [B031](backend/B031.md) Member slot assignment service (S)
- [B032](backend/B032.md) Transactional email service with templates and provider abstraction (M)
- [B033](backend/B033.md) Deep link and join URL service (S)
- [B036](backend/B036.md) Audit event emitter library (S)
- [B037](backend/B037.md) Relay service skeleton: ws server, health, graceful shutdown (M)
- [B038](backend/B038.md) Relay handshake and authentication (relay tickets, protocol negotiation) (L)
- [B039](backend/B039.md) Envelope codec and schema-enforced validation with size limits (M)
- [B040](backend/B040.md) Heartbeat, liveness and connection state machine (M)
- [B041](backend/B041.md) Sequencing, acks and at-least-once delivery per session (L)
- [B042](backend/B042.md) Resume and replay from the hot buffer and durable log (L)
- [B043](backend/B043.md) Session room registry and membership authorisation (M)
- [B044](backend/B044.md) Fan-out engine for opaque ciphertext routing (M)
- [B045](backend/B045.md) Cross-node routing over pub/sub (multi-instance relay) (L)
- [B046](backend/B046.md) Backpressure and slow-consumer handling (M)
- [B047](backend/B047.md) Presence service (ephemeral, TTL, coalescing) (M)
- [B048](backend/B048.md) Cursor and typing throttling (S)
- [B049](backend/B049.md) Key-grant routing and epoch rotation signalling (M)
- [B050](backend/B050.md) Relay privacy enforcement: no-plaintext tests, log scrubbing (M)
- [B051](backend/B051.md) Control commands: kick, mute, role, transfer host, end, policy (L)
- [B052](backend/B052.md) Queue service: ordering, dedupe, approve, reorder, caps, auto-approve policy (L)
- [B053](backend/B053.md) Session lifecycle service: create, live, paused, ended, expired, host-loss policy (M)
- [B054](backend/B054.md) Session REST endpoints: list, create, get, join-token, claim-host (M)
- [B055](backend/B055.md) Encrypted history store (blob storage of ciphertext frames) (M)
- [B056](backend/B056.md) Snapshot service: descriptors, pre-signed upload, commit, pruning (M)
- [B083](backend/B083.md) Feature flags and remote config service (M)
- [B086](backend/B086.md) Status endpoints and public status feed (S)
- [B091](backend/B091.md) Infrastructure as code: environments dev, stage, prod (L)
- [B092](backend/B092.md) Deployment pipeline: blue/green, safe migrations, rollback (L)
- [B101](backend/B101.md) Credential-leak guard: scanners for logs, frames, telemetry, backups and CI (S)

## M4 · Teams and money

Workspaces with members and roles, invites, plans and checkout, entitlements, quotas, notifications, and the first web screens.

- **Who:** both  ·  **Gate:** G4
- **Demo:** Owner upgrades to Pro in the browser, invites a teammate by link, the entitlement flips, the client unlocks the relay, usage warnings appear.
- **Done when:**
  - Stripe test-mode checkout updates entitlements through webhooks
  - Seats, proration and dunning behave per contract
  - Quota warnings reach clients as notices and notifications
  - Web app covers login, session view, members, invites, billing
- **Effort:** client 33 person-days (longest chain 9 d) · backend 51 person-days (longest chain 14 d)

**Client lanes (11):**

- [C064](client/C064.md) Billing and entitlement client: fetch, cache, gate, upgrade links (M)
- [C065](client/C065.md) Usage reporting: batched events and quota handling (M)
- [C066](client/C066.md) Notifications client: inbox, OS notifications (M)
- [C081](client/C081.md) Web app scaffold: Vite, React, router, theme (M)
- [C082](client/C082.md) Web authentication with PKCE (M)
- [C083](client/C083.md) Web transcript and command-post view (L)
- [C085](client/C085.md) Web roster, presence and cursors (M)
- [C086](client/C086.md) Web mascot canvas player (S)
- [C087](client/C087.md) Web workspace and members management (M)
- [C088](client/C088.md) Web invites and join flow with deep links (M)
- [C089](client/C089.md) Web billing UI (M)

**Backend lanes (21):**

- [B030](backend/B030.md) Seat accounting and seat-limit enforcement (S)
- [B034](backend/B034.md) Workspace settings and policies (S)
- [B035](backend/B035.md) Projects registry (S)
- [B063](backend/B063.md) Notification dispatcher core: events to channels (M)
- [B064](backend/B064.md) Push delivery: web push, APNs, FCM abstraction (M)
- [B065](backend/B065.md) In-app notification inbox API (S)
- [B066](backend/B066.md) Notification preferences and quiet hours (S)
- [B068](backend/B068.md) Share links and viewer-only guest tokens (M)
- [B069](backend/B069.md) Plans and entitlements model (M)
- [B070](backend/B070.md) Stripe integration: customers and subscriptions (L)
- [B071](backend/B071.md) Checkout and customer portal sessions (M)
- [B072](backend/B072.md) Stripe webhook ingestion: verified, idempotent, replay-safe (M)
- [B073](backend/B073.md) Seat quantity sync and proration preview (M)
- [B074](backend/B074.md) Usage event ingestion API (M)
- [B075](backend/B075.md) Usage aggregation and quota computation (M)
- [B076](backend/B076.md) Quota signalling: warnings at 80 and 100 percent to sessions and owners (M)
- [B077](backend/B077.md) Invoices, receipts and tax endpoints (S)
- [B078](backend/B078.md) Dunning and grace-period state machine (M)
- [B079](backend/B079.md) Trials, coupons and promotions (S)
- [B080](backend/B080.md) Entitlement cache and enforcement middleware (M)
- [B093](backend/B093.md) Observability: metrics, traces, dashboards, SLOs (M)

## M5 · Fleet and polish

Branch-mode fleets across people, file locks, webhooks, audit log, updates, flags and telemetry, and the rest of the web app.

- **Who:** both  ·  **Gate:** G5
- **Demo:** Three people each run agents on their own branches in one workspace and see each other's state, locks and conflicts; admins read the audit log.
- **Done when:**
  - Locks and conflict signals work across three clients
  - Webhooks deliver with retries and signatures
  - Audit export works
  - Auto-update verifies signatures and rolls out by channel
- **Effort:** client 36 person-days (longest chain 9 d) · backend 36 person-days (longest chain 5 d)

**Client lanes (14):**

- [C018](client/C018.md) File lock client: local and remote advisory locks (M)
- [C024](client/C024.md) Parallel agents: a fleet of engine processes in isolated worktrees (L)
- [C062](client/C062.md) Branch-mode fleet sync: agents, branches, locks (M)
- [C068](client/C068.md) Update client: check, download, verify, apply (L)
- [C069](client/C069.md) Webhook management commands (S)
- [C070](client/C070.md) Audit log viewer commands (S)
- [C077](client/C077.md) Shared cursors and selections in the TUI (S)
- [C078](client/C078.md) Conflict handling UX: locks and merge conflicts (M)
- [C079](client/C079.md) Handoff and pair mode (M)
- [C080](client/C080.md) Reactions and comments UI (S)
- [C084](client/C084.md) Web fleet board (M)
- [C090](client/C090.md) Web settings and notifications UI (S)
- [C092](client/C092.md) Web accessibility and i18n framework (M)
- [C093](client/C093.md) Web end-to-end tests with Playwright against the mock backend (M)

**Backend lanes (14):**

- [B057](backend/B057.md) Agent registry (ids, owners, modes, states) (M)
- [B058](backend/B058.md) Agent state validation against the state-map contract (S)
- [B059](backend/B059.md) File-lock coordination service (advisory, TTL, fairness) (M)
- [B060](backend/B060.md) Approval routing: tool approvals, delegates, timeouts (M)
- [B061](backend/B061.md) Branch and conflict signalling (S)
- [B062](backend/B062.md) Reactions and comments persistence (S)
- [B067](backend/B067.md) Presence history and last-seen API (S)
- [B081](backend/B081.md) Outgoing webhooks: endpoints, delivery, retries, signing (L)
- [B082](backend/B082.md) Audit log API and export (M)
- [B084](backend/B084.md) Release manifest and update channel service (M)
- [B085](backend/B085.md) Telemetry ingest: schema validation, PII scrub, retention (M)
- [B087](backend/B087.md) Internal admin API and support tooling (M)
- [B090](backend/B090.md) Data retention and purge jobs (M)
- [B094](backend/B094.md) Alerting and on-call runbooks (M)

## M6 · Launch

Production readiness: infrastructure, load and chaos tests, security review, installers, docs, accessibility, and both conformance suites green.

- **Who:** both  ·  **Gate:** G6
- **Demo:** Fresh machine install, update, full flow in production-like stage; load test at target concurrency; incident drill.
- **Done when:**
  - Load and chaos tests meet the targets in B095/B096
  - Threat model reviewed, penetration findings fixed
  - Installers and updater tested on Linux, macOS and Windows
  - Provider policy table re-verified and written confirmations obtained or features kept off
- **Effort:** client 26 person-days (longest chain 8 d) · backend 22 person-days (longest chain 8 d)

**Client lanes (8):**

- [C049](client/C049.md) TUI accessibility: reduced motion, NO_COLOR, screen-reader mode (M)
- [C094](client/C094.md) Installer and packaging: npm, Homebrew, standalone binaries (L)
- [C095](client/C095.md) Auto-update integration and release channels (M)
- [C096](client/C096.md) Documentation site, README, man pages, built-in help (M)
- [C097](client/C097.md) Opt-in crash reporting and the doctor command (S)
- [C098](client/C098.md) Performance budgets and benchmarks (M)
- [C099](client/C099.md) Client security review: secrets, sandbox, supply chain, SBOM (M)
- [C100](client/C100.md) Consumer conformance suite and release gate (L)

**Backend lanes (6):**

- [B095](backend/B095.md) Load testing and capacity model (L)
- [B096](backend/B096.md) Chaos and failure-mode tests (M)
- [B097](backend/B097.md) Security hardening: headers, WAF rules, secret scanning, dependency policy (M)
- [B098](backend/B098.md) Threat model and penetration-test preparation (M)
- [B099](backend/B099.md) Backup, restore and disaster-recovery drills (M)
- [B100](backend/B100.md) Provider conformance suite and release gate (L)

## Later · After launch

Useful but not needed for launch.

- **Who:** both  ·  **Gate:** -
- **Demo:** -
- **Effort:** client 1 person-days (longest chain 1 d) · backend 4 person-days (longest chain 3 d)

**Client lanes (1):**

- [C091](client/C091.md) Web webhooks and audit UI (S)

**Backend lanes (2):**

- [B088](backend/B088.md) Internal admin console (minimal web UI) (M)
- [B089](backend/B089.md) Metadata search across sessions and members (S)
