# Overview: the product and how it fits together

## The product in plain words
**Centcom** is a terminal app (plus a web app) where **several people and several coding agents work on the same project at once**. The agents are the user's own **Claude Code** and **Codex**; Centcom runs them, shows what each one is doing (the octopus mascot, **Cento**, is the face of every agent), and lets people share a session:

- **Free:** two or more people on the same Wi-Fi share one session with no account and no server (LAN mode).
- **Paid:** a hosted relay lets a team do the same from anywhere, with accounts, workspaces, roles, history, notifications and audit logs.

Centcom never touches anyone's Anthropic or OpenAI login, and the relay can't read anyone's code (it carries encrypted data).

## The five ideas that explain every decision
1. **We drive the user's own CLIs.** `claude` and `codex` do the model work, tools, sandboxing and login. We wrap them. So we never hold credentials and never resell model usage. (`contracts/10-providers.md`)
2. **One protocol, two transports.** LAN and the relay speak the same WebSocket protocol; the host plays "server" on LAN. (`contracts/03` and `04`, `06`)
3. **The relay is blind.** Session content is end-to-end encrypted; the relay sees only a small, listed set of metadata. (`contracts/05`)
4. **Two repos meet only at contracts.** The client and backend are built by different people at the same time, each against a mock of the other. (`contracts/`, `plan/GUIDELINES.md`)
5. **We charge for the relay and for seats, not for tokens.** Model usage belongs to whoever's CLI made the call. (`contracts/07`)

## The picture
```
 ┌──────────────────────────── your machine ────────────────────────────┐
 │  centcom (TUI/CLI)                                                   │
 │    ├─ Engines: drive your own `claude` / `codex` (login stays there) │
 │    ├─ Agents in git worktrees, approvals, diff, fleet panel, Cento   │
 │    └─ Session engine: host or guest, end-to-end encryption           │
 └───────────────┬──────────────────────────────┬───────────────────────┘
                 │ LAN (free, direct)           │ relay (paid, anywhere)
                 ▼                              ▼
        another laptop, same Wi-Fi       ┌──────────────────────────────┐
                                         │ Centcom backend              │
   web app (browser) ───────────────────►│  api: accounts, workspaces,  │
                                         │       billing, notifications │
                                         │  relay: sessions, queue,     │
                                         │         presence (ciphertext)│
                                         │  workers, admin, infra       │
                                         └──────────────────────────────┘
```

## Who owns what
| Area | Repo | What it is |
|---|---|---|
| Terminal app and agent engines | `Centcom` | CLI, TUI, engines, worktrees, approvals, mascot, theme |
| LAN and session engines | `Centcom` | discovery, pairing, host/guest, encryption, queue client |
| Web app | `Centcom` | login, session view, members, billing screens |
| API | `Centcom-backend` | accounts, devices, workspaces, invites, billing, notifications, webhooks, audit |
| Relay | `Centcom-backend` | realtime sessions, sequencing, resume, queue, presence, control |
| Infra and safety | `Centcom-backend` | IaC, deploys, observability, load/chaos tests, security |
| Contracts | both (identical) | the only coupling between the two |

## How the plan is organised
| Document | Answers |
|---|---|
| [`START_HERE.md`](START_HERE.md) | Where do I begin? What is my first week? |
| [`ROADMAP.md`](ROADMAP.md) | What ships when? How long will it take? |
| [`FEATURES.md`](FEATURES.md) | For feature X, which backend lanes, client lanes and contracts? |
| [`client/README.md`](client/README.md), [`backend/README.md`](backend/README.md) | All lanes of one side, by phase and milestone |
| `client/C###.md`, `backend/B###.md` | One lane: goal, scope, interfaces, acceptance, tests, guardrails |
| [`GUIDELINES.md`](GUIDELINES.md) | The strict rules every lane follows |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, domain model, trust model, gates |
| [`../contracts/README.md`](../contracts/README.md) | The connection points |
| [`INTEGRATION.md`](INTEGRATION.md) | The joint checks G0-G6 |
| [`GRAPH.md`](GRAPH.md) | Dependency layers and critical path |
| [`DECISIONS.md`](DECISIONS.md) | Every question that came up, and its answer |
| [`SIZING.md`](SIZING.md) | Lanes that may need splitting |
| [`ENGINE_DELTA.md`](ENGINE_DELTA.md) | Why the client drives CLIs instead of embedding SDKs |
