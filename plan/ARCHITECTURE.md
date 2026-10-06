# Centcom: Architecture and Decisions

Status: **frozen for v1** · Changes go through an ADR (see GUIDELINES §9)

## 1. What we are building

Centcom is a terminal-first, multiplayer platform for running coding agents. Several people (and several agents) share one workspace. Two ways to collaborate:

- **Branch mode:** every agent works on its own git worktree/branch; people merge later.
- **Command post:** one *host* session; other members queue messages into it; the host approves.

Transports: **LAN** (same Wi-Fi, direct, free) and **relay** (hosted, paid, works anywhere). Both speak the *same* protocol (`CT-WS-ENVELOPE` and friends).

## 2. Two repositories, one contract

| Repo | Visibility | Contains |
|---|---|---|
| `Centcom` (client) | public-capable | CLI, TUI, agent runner, LAN host/guest, relay client, web app, design system, mascot |
| `Centcom-backend` | private | API, relay, workers, billing, notifications, infra |

They are built by **separate people, separately, in parallel**. The only thing they share is `contracts/`, which is **byte-identical in both repos** and protected by `contracts/CONTRACTS.lock`. If the lock check fails, CI fails. Nobody changes a contract inside a lane; contract changes are their own process (GUIDELINES §9).

```
            ┌──────────────── contracts/  (shared, locked) ────────────────┐
            │  REST (OpenAPI) · WebSocket protocol · Events · Crypto · LAN │
            └───────────────┬──────────────────────────────┬───────────────┘
                            │                              │
          ┌─────────────────▼───────────┐     ┌────────────▼────────────────┐
          │  CLIENT  (105 lanes C001-C105) │     │  BACKEND (101 lanes B001-B101) │
          │  build against mock backend │     │  build against mock client  │
          │  (lane C007)                │     │  simulator (lane B011)      │
          └─────────────────┬───────────┘     └────────────┬────────────────┘
                            └───────── integration gates G1..G6 ───────────┘
```

**Rule zero:** a lane in one plan never depends on a lane in the other plan. Cross-plan coupling happens *only* through a contract ID (`CT-*`). A lane that "needs the backend" really needs a *contract* and builds against a *mock of the contract*.

## 3. Technology decisions (defaults; change only by ADR)

### Shared
| Topic | Decision |
|---|---|
| Language | TypeScript 5.x, `strict`, ESM only |
| Runtime | Node.js 22 LTS |
| Package manager | pnpm workspaces, lockfile committed |
| Scope | `@centcom/*` |
| Test runner | Vitest; Playwright for web e2e |
| Lint/format | ESLint (flat config) + Prettier; `tsc --noEmit` in CI |
| Commits | Conventional Commits; squash merge; one lane = one PR (or a short chain) |
| Wire format | JSON text frames, UTF-8 (v1). Binary fields are base64url |
| IDs | Prefixed ULIDs (`CT-IDS`) |
| Time | RFC 3339 UTC with milliseconds |
| Crypto | libsodium primitives (X25519, Ed25519, XChaCha20-Poly1305, BLAKE2b/HKDF) |

### Backend
| Topic | Decision |
|---|---|
| HTTP | Fastify 5 |
| Realtime | `ws` in a **separate** `apps/relay` service (long-lived connections scale independently) |
| Workers | BullMQ on Redis, `apps/worker` |
| Database | PostgreSQL 16, Kysely, plain SQL migrations, no ORM magic |
| Cache / pubsub / presence | Redis 7 |
| Blob storage | S3-compatible (Cloudflare R2) for encrypted history and snapshots |
| Billing | Stripe (Billing, Tax, Customer Portal) |
| Email | Provider abstraction (Postmark first) |
| Hosting | Fly.io (multi-region, WebSockets), Terraform for the rest |
| Observability | OpenTelemetry → Grafana stack |
| Layout | `apps/{api,relay,worker,admin}`, `packages/{contracts,db,core,testkit}`, `infra/` |

### Client
| Topic | Decision |
|---|---|
| Agent engines | The user's own **`claude` (Claude Code) and `codex` CLIs**, driven as child processes (stream-json / app-server JSON-RPC). No vendor SDKs, no direct model API calls, no credential handling (CT-PROVIDER) |
| TUI | Ink (React for terminals) + our own half-block pixel renderer |
| Web | Vite + React 19 + TanStack Router, Zustand |
| Keychain | OS keychain via `@napi-rs/keyring` |
| Packaging | npm, Homebrew tap, Node SEA standalone binaries (linux/mac/win) |
| Layout | `apps/{cli,web}`, `packages/{protocol,theme,mascot,agent,tui,net,lan,session,testkit}` |

## 4. Domain model (shared vocabulary)

```
User ──< Membership >── Workspace ──< Session (command post) ──< Agent
  │            (role)        │              │  host, members, queue
  └──< Device (keys)         └── Subscription, Seats, Usage
```

- **Workspace**: billing + membership boundary (Team plan). A solo Pro user has a one-person workspace.
- **Session**: a command post. Has exactly one **host** member at a time. Ad-hoc LAN sessions have no workspace and never touch the backend.
- **Agent**: one running Claude agent, owned by one member, optionally on its own branch/worktree.
- **Device**: a user's machine; owns an X25519 + Ed25519 keypair (public halves registered with the backend).
- **Member colour**: one of `violet red yellow green brown`, assigned per session, stable for its life (`CT-WS-SESSION-EVENTS` §presence).

## 5. Trust model

1. **The relay never sees plaintext** work content (messages, code, diffs, paths, branch names). It routes ciphertext and enforces a *small* set of cleartext metadata (who, when, size, queue state, lock hashes, agent state enum).
2. Session content is encrypted with a per-session symmetric key held only by member devices (`CT-CRYPTO`).
3. The backend is trusted for: identity, authorisation, billing, ordering, rate limits, retention.
4. Every request is authenticated; every authorisation decision is made server-side (`CT-RBAC`). The client mirrors permissions **for UI only**.
5. **Model-provider credentials never reach Centcom at all.** The client drives the user's own `claude` and `codex` CLIs, which sign the user in and hold the credentials; the backend never sees one and a credential-leak guard (B101) enforces it. Whoever's CLI makes the call pays and is bound by their own plan (CT-PROVIDER).
6. Free (LAN) mode works fully offline from the backend. The client must never *require* the backend for single-user or LAN use.

## 6. The integration gates

Each gate is a joint, scripted check run against real builds of both sides. Lanes list which gate they unblock.

| Gate | Name | Passes when |
|---|---|---|
| **G0** | Contract freeze | `contracts/` reviewed, locked, fixtures validate against schemas |
| **G1** | Hello | Client authenticates via device flow against real API; fetches `/v1/me` |
| **G2** | Tunnel | Client connects to real relay, completes handshake, heartbeat, resume survives a forced disconnect |
| **G3** | Command post | Two real clients: host + guest, queue → approve → agent runs → events fan out, end-to-end encrypted |
| **G4** | Money | Checkout → webhook → entitlement flips → client unlocks relay; quota warnings arrive |
| **G5** | Fleet | Three clients, branch mode, file locks, presence, notifications, webhooks |
| **G6** | Launch | Load test, chaos test, security review, installer + auto-update, runbooks, all conformance suites green |

Conformance suites: **provider** side `B100`, **consumer** side `C100`. They share fixtures in `contracts/fixtures/`.

## 7. Build order (parallelism)

Both plans start in parallel the moment G0 passes. Within a plan, `depends_on` gives the order; lanes with no unmet dependencies can all run at once. `plan/GRAPH.md` shows the layers and the critical path.

## 8. Non-goals for v1

Mobile apps, self-hosted relay, SSO/SAML (planned v1.1), on-prem, billing in currencies other than USD/EUR, end-user plugin marketplace, voice (the animation exists, the product doesn't yet).
