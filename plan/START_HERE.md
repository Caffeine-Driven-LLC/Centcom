# Start here

## 10-minute reading path
1. [`OVERVIEW.md`](OVERVIEW.md): what we are building and the five ideas behind it (3 min).
2. [`ROADMAP.md`](ROADMAP.md): the milestones M0-M6 and what each one demos (3 min).
3. [`GUIDELINES.md`](GUIDELINES.md): the strict rules (4 min; you will be reviewed against them).
4. Your side's plan index: [client](client/README.md) or [backend](backend/README.md).

## Pick your role
| I am... | Read next | First lanes |
|---|---|---|
| **Client developer** (TUI, agents, LAN, web) | [`client/README.md`](client/README.md) | **C001** scaffold → C002 CI → C003 codegen → C007 mock backend |
| **Backend developer** (API, relay, billing) | [`backend/README.md`](backend/README.md) | **B001** scaffold → B002 CI → B003 codegen → B011 client simulator |
| **Lead / PM** | [`ROADMAP.md`](ROADMAP.md), [`FEATURES.md`](FEATURES.md), [`INTEGRATION.md`](INTEGRATION.md) | Pick the first release (recommended: M1 + M2, client only) |
| **Reviewer** | [`GUIDELINES.md`](GUIDELINES.md) §8 and §11 | Any PR |
| **Designer** | [`../assets/DESIGN.md`](../assets/DESIGN.md) | Mascot and theme lanes C009, C032, C033, C046 |

## Your first week
**Day 1:** clone, read the four documents above, run the three checks:
```bash
python3 tools/plan/validate_contracts.py   # contracts are consistent
python3 tools/plan/validate_plan.py        # plan is consistent
python3 tools/plan/lock.py --check         # contracts unchanged
```
**Day 2-5:** take a lane from the first layer of [`GRAPH.md`](GRAPH.md) that matches your role (`depends_on` empty or already merged). Open its card, read its contracts, branch `lane/<ID>-<slug>`, build only its `deliverables`, open a PR titled `<ID>: <title>`.

## The lane lifecycle (every lane, every time)
```
 pick a lane (deps merged) ─► read card + contracts ─► build against the mock ─►
 tests prove each acceptance item ─► PR (template) ─► review by someone else ─► merge ─► tell "Unblocks"
```
Stuck on something the contract does not say? Do **not** guess: follow the card's conservative reading, check [`DECISIONS.md`](DECISIONS.md), and if it is truly missing open a *Contract PR* ([`GUIDELINES.md`](GUIDELINES.md) §9-10).

## Suggested team layout (5 people)
| Person | Owns | Milestones |
|---|---|---|
| Client A: **engines and runtime** | C013-C030, C101-C105 | M1, M2 |
| Client B: **TUI and mascot** | C031-C050, C086 | M1 |
| Client C: **network, LAN and crypto** | C051-C076 | M2, M3 |
| Backend D: **identity, workspaces, billing** | B013-B036, B069-B080 | M3, M4 |
| Backend E: **relay, realtime, ops** | B037-B068, B091-B100 | M3, M6 |
With fewer people, do M1 → M2 → M3 in order; the timing table in [`ROADMAP.md`](ROADMAP.md) shows calendar estimates for 2, 3 and 4 people per side.

## FAQ
**Why 206 lanes?** Each lane is one small, independently reviewable task (≤ 5 days). Small lanes make parallel work and clear acceptance possible. Most are 1-3 days.

**Why can't a client lane depend on a backend lane?** So the two teams never wait on each other. They meet at a *contract* and test against a *mock*; the joint gates (G0-G6) prove they agree.

**Where do I find everything about feature X (say, the queue)?** [`FEATURES.md`](FEATURES.md): one row per feature with backend lanes, client lanes and contracts.

**What is the smallest thing worth shipping?** M1 + M2: the client alone, with LAN multiplayer. No server, no account, no billing. Everything after that is the paid hosted product.

**Can I change a contract?** Only through a Contract PR (ADR + approval from both sides + both conformance suites). Lanes never edit `contracts/`.

**What about Anthropic and OpenAI terms?** We drive the user's own CLIs and never touch credentials ([`../contracts/10-providers.md`](../contracts/10-providers.md)). Shared command posts on subscription logins are off by default until the providers confirm in writing.

## Glossary
| Term | Meaning |
|---|---|
| **Lane** | one task card (`B###` backend, `C###` client) |
| **Contract** (`CT-*`) | an agreed, frozen connection point between client and backend |
| **Milestone** (M0-M6) | something demo-able; groups lanes in time |
| **Gate** (G0-G6) | a joint check run against real builds of both sides |
| **Engine** | the part of the client that drives one vendor CLI (`claude` or `codex`) |
| **Command post** | a shared session where guests queue prompts and the host approves |
| **Branch mode** | everyone runs their own agents on their own git worktrees |
| **Host / guest** | the person running a command post / the others |
| **Relay** | the paid hosted server that carries encrypted sessions |
| **Cento** | the octopus mascot and the face of an agent |
