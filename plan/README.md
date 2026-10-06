# Centcom build plan

Two plans (**105 client lanes, 101 backend lanes**), built in parallel by different people (or agents), connected **only** through frozen contracts.

| | Backend | Client |
|---|---|---|
| Repo | `Centcom-backend` (private) | `Centcom` |
| Lanes | [B001-B101](backend/README.md) | [C001-C105](client/README.md) |
| Builds against | mock client simulator (B011) | mock backend (C007) |
| Proves compatibility with | provider conformance suite (B100) | consumer conformance suite (C100) |

## Start here
1. **[`START_HERE.md`](START_HERE.md)**: 10-minute reading path, your role, your first week, FAQ, glossary.
2. **[`OVERVIEW.md`](OVERVIEW.md)**: what we are building and how it fits together.
3. **[`ROADMAP.md`](ROADMAP.md)**: milestones M0-M6, what each demos, how long it takes.
4. **[`FEATURES.md`](FEATURES.md)**: every feature mapped to its backend lanes, client lanes and contracts.
5. Your side's index ([client](client/README.md) or [backend](backend/README.md)), then your lane card.

## All files
| File | What |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, domain model, trust model, gates |
| [`GUIDELINES.md`](GUIDELINES.md) | The strict rules every lane obeys |
| [`ROADMAP.md`](ROADMAP.md), [`milestones.json`](milestones.json) | Milestones and the lane → milestone assignment (generated doc, edit the json) |
| [`FEATURES.md`](FEATURES.md), [`features.json`](features.json) | Feature map (generated doc, edit the json) |
| [`skeleton.json`](skeleton.json) | The lanes: id, title, phase, size, role, dependencies |
| `lanes/<plan>/<ID>.json` | The lane cards (source) |
| `backend/`, `client/` | Rendered cards + plan index (generated) |
| [`GRAPH.md`](GRAPH.md) | Layers, parallelism, critical path (generated) |
| [`CONTRACT_MATRIX.md`](CONTRACT_MATRIX.md) | Every contract × the lanes that implement/consume it (generated) |
| [`INTEGRATION.md`](INTEGRATION.md) | Gates G0-G6 and who unblocks them (generated) |
| [`DECISIONS.md`](DECISIONS.md) | Every question raised while writing the cards, and the answer |
| [`SIZING.md`](SIZING.md) | Lanes that may need splitting |
| [`ENGINE_DELTA.md`](ENGINE_DELTA.md) | Why we drive the vendors' CLIs |
| [`LANE_CARD_SPEC.md`](LANE_CARD_SPEC.md), [`PR_TEMPLATE.md`](PR_TEMPLATE.md) | Card format; PR template |

## Tooling (`tools/plan/`)

```bash
python3 tools/plan/validate_plan.py          # structure, cards, contract coverage, gates (CI)
python3 tools/plan/validate_contracts.py     # G0: schemas, fixtures, event catalogue, crypto vectors, OpenAPI
python3 tools/plan/lock.py --check           # contracts/ unchanged vs CONTRACTS.lock (every lane's CI)
python3 tools/plan/lock.py --compare ../Centcom-backend/contracts   # both repos identical
python3 tools/plan/build_plan.py             # re-render markdown from the cards
python3 tools/plan/gen_events.py             # regenerate the event catalogue (Contract PR only)
```

## How to take a lane

1. Open the card. Check `depends_on` are merged (or that you can build against the mock named in `build_against`).
2. Read the contracts it lists under *Implements* / *Consumes*.
3. Branch `lane/<ID>-<slug>`; build only the `deliverables`; implement only the `interfaces`.
4. Open a PR titled `<ID>: <title>` using the template. CI must pass; a reviewer other than you approves.
5. Merge, then tell the lanes in *Unblocks*.

## Principles in one breath

Contract first · no cross-plan lane dependencies · everything built against mocks until the gates · relay never sees plaintext · local and LAN use never needs the backend · small lanes (≤ 5 days) · tests prove acceptance · strict definition of done.
