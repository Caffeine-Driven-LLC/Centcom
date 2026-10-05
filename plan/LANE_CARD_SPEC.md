# Lane card format

One JSON file per lane: `plan/lanes/<backend|client>/<ID>.json`. `tools/plan/build_plan.py` renders it to markdown; `tools/plan/validate_plan.py` enforces the rules below. **Cards are written to be handed to a developer (or an AI agent) who has never seen the project and must be able to build the lane alone.** Be concrete: real file paths, real function/endpoint/event names, real numbers.

## Fields

```json
{
  "id": "B037",
  "title": "Relay service skeleton: ws server, health, graceful shutdown",
  "plan": "backend",
  "phase": "P3 Relay",
  "size": "M",
  "role": "realtime",
  "depends_on": ["B001", "B005"],
  "goal": "1-3 sentences: the outcome, not the activity.",
  "scope_in": ["bullet: exactly what this lane builds (>= 3)"],
  "scope_out": ["bullet: what it must NOT build, naming the lane that owns it where applicable (>= 2)"],
  "implements": ["CT-WS-ENVELOPE"],
  "consumes": ["CT-AUTH"],
  "build_against": "How to build and test this lane with NO counterpart repo: which mock/stub/fixture, from which lane.",
  "deliverables": ["apps/relay/src/server.ts", "apps/relay/README.md"],
  "interfaces": ["Concrete public surface other lanes may use: TS signatures, HTTP routes, WS frame kinds, CLI flags, env vars, DB tables. (>= 1)"],
  "acceptance": ["Each item is a testable statement with numbers where possible (>= 5)"],
  "tests": ["Named test suites / cases that prove the acceptance items (>= 3)"],
  "guardrails": ["Lane-specific MUST / MUST NOT rules beyond plan/GUIDELINES.md (>= 3)"],
  "failure_modes": ["Failure -> required behaviour (>= 2)"],
  "unblocks_gate": "G2",
  "notes": "optional; open questions, risks, suggestions"
}
```

## Rules (validated)

1. **Keep `id`, `title`, `plan`, `phase`, `size`, `role`, `depends_on` exactly as in `plan/skeleton.json`.** If you believe one is wrong, keep it and explain in `notes` (a human changes the skeleton).
2. `implements` / `consumes` contain only IDs from `contracts/index.json`. A lane `implements` a contract when it produces the code that realises that side of the contract (server side for backend plan; client side for client plan; codegen lanes implement the shared "types" side of CT-IDS/CT-ERR/CT-VER/CT-PAGE as appropriate). It `consumes` a contract when it relies on it but does not realise it.
3. **No cross-plan lane references anywhere** (not in `depends_on`, `scope_out`, `build_against`, `notes`). Refer to the other side only by contract ID and by "the mock" / "the real counterpart".
4. Mentions of lanes in the *same* plan are fine (`scope_out`, `interfaces`).
5. `deliverables` are repo-relative paths following the layout in `plan/ARCHITECTURE.md` §3 and the layouts below. No path may be claimed by two lanes (validator checks). Directories end with `/`.
6. `acceptance` items are **observable**: "returns 429 with `Retry-After` after 31 sequenced frames in 1 s", not "rate limiting works".
7. `guardrails` must include the lane's most dangerous failure (security, data loss, privacy, ordering) and restate relevant contract rules that are easy to violate. Do not repeat generic items already in GUIDELINES.md.
8. Do not invent new contracts, endpoints, event kinds, error codes, state names or entitlement keys. Use only what is in `contracts/`. If something is missing, put it in `notes` as "CONTRACT GAP: …".
9. Sizes: keep to the skeleton. If a card feels bigger than its size, say so in `notes` ("SPLIT?").
10. English, plain, no marketing words. Keep each bullet to one or two lines.

## Repo layouts (use these paths)

**Backend repo (`Centcom-backend`)**
```
apps/api/src/{plugins,routes,modules/<area>}/        Fastify app (REST)
apps/relay/src/                                      WebSocket relay
apps/worker/src/jobs/                                BullMQ jobs
apps/admin/                                          internal admin console
packages/contracts/                                  generated types/validators (from contracts/)
packages/core/src/                                   config, log, errors, rbac, ratelimit, redis, email
packages/db/{migrations,src}/                        Kysely + SQL migrations
packages/testkit/src/                                factories, containers, client simulator
infra/{terraform,fly,runbooks,loadtest,chaos}/       operations
docs/                                                service docs, threat model
contracts/                                           (shared, read-only)
plan/                                                (this plan)
```
**Client repo (`Centcom`)**
```
apps/cli/src/                                        `centcom` binary entry + commands
apps/web/src/                                        web app
packages/protocol/                                   generated types/validators (from contracts/)
packages/theme/                                      tokens, terminal themes (from assets/theme)
packages/mascot/                                     animation data + renderers (from assets/mascot)
packages/agent/src/                                  agent runner, permissions, worktrees, skills, MCP, hooks
packages/tui/src/                                    Ink components
packages/net/src/                                    http client, relay client, crypto, session client, billing/usage clients
packages/lan/src/                                    mDNS, LAN host, pairing
packages/session/src/                                host/guest engines, transport abstraction
packages/testkit/src/                                mock backend, fixtures, pty harness
tools/                                               build/release scripts
docs/                                                user docs
contracts/                                           (shared, read-only)
plan/                                                (this plan)
```
