# Centcom build plan

Two plans, **100 lanes each**, built in parallel by different people (or agents), connected **only** through frozen contracts.

| | Backend | Client |
|---|---|---|
| Repo | `Centcom-backend` (private) | `Centcom` |
| Lanes | [B001-B100](backend/README.md) | [C001-C100](client/README.md) |
| Builds against | mock client simulator (B011) | mock backend (C007) |
| Proves compatibility with | provider conformance suite (B100) | consumer conformance suite (C100) |

## Read in this order

1. [`ARCHITECTURE.md`](ARCHITECTURE.md): what we are building, the stack, the trust model, the integration gates.
2. [`GUIDELINES.md`](GUIDELINES.md): the strict rules every lane obeys (boundaries, contracts, tests, security, definition of done, change control).
3. [`../contracts/README.md`](../contracts/README.md): the connection points.
4. Your plan's index ([backend](backend/README.md) or [client](client/README.md)), then your lane card.

## Map

| File | What |
|---|---|
| [`skeleton.json`](skeleton.json) | The 200 lanes: id, title, phase, size, role, dependencies. Source of truth for structure. |
| `lanes/<plan>/<ID>.json` | The lane cards (source). Written to be buildable by someone who has never seen the project. |
| `backend/`, `client/` | Rendered cards + plan index (generated) |
| [`GRAPH.md`](GRAPH.md) | Layers, parallelism, critical path (generated) |
| [`CONTRACT_MATRIX.md`](CONTRACT_MATRIX.md) | Every contract × the lanes that implement/consume it (generated) |
| [`INTEGRATION.md`](INTEGRATION.md) | Gates G0-G6 and who unblocks them (generated) |
| [`OPEN_ITEMS.md`](OPEN_ITEMS.md) | Remaining contract questions and split candidates, collected from the cards (generated) |
| [`LANE_CARD_SPEC.md`](LANE_CARD_SPEC.md) | Card format and the rules `validate_plan.py` enforces |
| [`PR_TEMPLATE.md`](PR_TEMPLATE.md) | Pull request template for lanes |

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
