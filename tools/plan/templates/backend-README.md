# Centcom Backend

Private server side of Centcom: REST API, WebSocket relay, workers, billing, notifications, infrastructure.

> Status: planning complete; implementation starts after gate **G0** (contract freeze). Everything you need is in [`plan/`](plan/README.md) and [`contracts/`](contracts/README.md).

## What this repo will contain

```
apps/api       Fastify REST API (/v1/*)
apps/relay     WebSocket relay (sessions, sequencing, queue, presence, control)
apps/worker    BullMQ jobs (webhooks, notifications, billing, retention)
apps/admin     Internal admin console
packages/      contracts (generated), core, db, testkit
infra/         Terraform, Fly.io, runbooks, load and chaos tests
```

The relay is deliberately blind: it routes **ciphertext** and may read only the cleartext metadata listed in `contracts/04-session-events.md`.

## The plan

- **[100 backend lanes (B001-B100)](plan/backend/README.md)**: independent tasks with strict acceptance criteria.
- [Architecture and decisions](plan/ARCHITECTURE.md) · [strict guidelines](plan/GUIDELINES.md) · [dependency graph](plan/GRAPH.md) · [contract matrix](plan/CONTRACT_MATRIX.md) · [integration gates](plan/INTEGRATION.md).
- The client repo (`Centcom`) has its own 100 lanes. **You never depend on them**; you meet only at [contracts](contracts/README.md). Build against the mock client simulator (lane B011); prove compatibility with the conformance suite (lane B100).

## Day one

```bash
python3 tools/plan/validate_contracts.py   # gate G0 checks
python3 tools/plan/validate_plan.py        # plan consistency
python3 tools/plan/lock.py --check         # contracts unchanged
```
Then pick a lane from layer 1 of [`plan/GRAPH.md`](plan/GRAPH.md) (start: **B001**), open its card, and follow [`plan/GUIDELINES.md`](plan/GUIDELINES.md).

## Source of truth

`contracts/`, `plan/` and `tools/plan/` are identical in both repos. Do not edit them here except through the Contract PR process (`plan/GUIDELINES.md` §9). Verify parity with:
`python3 tools/plan/lock.py --compare ../Centcom/contracts`
