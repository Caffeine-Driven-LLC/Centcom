# Client plan · 100 lanes (C001-C100)

Repo: `Centcom` · Rules: [`plan/GUIDELINES.md`](../GUIDELINES.md) · Format: [`plan/LANE_CARD_SPEC.md`](../LANE_CARD_SPEC.md) · Connection points: [`contracts/`](../../contracts/index.json)

- **100 lanes**: 29 small (≤1 d), 53 medium (≤3 d), 18 large (≤5 d) · 278 person-days of work in total
- **10 dependency layers** · critical path **37 days** (see [`GRAPH.md`](../GRAPH.md)) · parallelism in layer 1: 1 lanes can start on day one
- Every lane card is independent: it names its inputs (contracts), outputs (deliverables), and how to build with no counterpart (`build_against`).
- **No lane in this plan depends on a lane in the other plan.** The two sides meet only at contract IDs.


### P0 Foundations

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C001](C001.md) | Monorepo scaffold and toolchain | M | devx | - | - | G0 |
| [C002](C002.md) | CI pipeline: typecheck, lint, test, build matrix, contract-lock check | M | devx | C001 | - | G0 |
| [C003](C003.md) | Protocol package: types and validators generated from contracts/ | M | devx | C001 | CT-IDS, CT-VER | G0 |
| [C004](C004.md) | Layered configuration system (defaults, user, project, env, flags) | S | runtime | C001 | - | G1 |
| [C005](C005.md) | Logging and diagnostics with redaction | S | runtime | C004 | - | G1 |
| [C006](C006.md) | Client error model: problem+json to typed errors and user messages | S | runtime | C003, C005 | CT-ERR | G1 |
| [C007](C007.md) | Mock backend: REST from OpenAPI plus WebSocket relay simulator | L | qa | C003 | - | G1 |
| [C008](C008.md) | Test harness: vitest setup, pty and TUI snapshot tester, fixtures | M | qa | C002 | - | G1 |
| [C009](C009.md) | Theme and mascot packages from the design system | M | tui | C001 | - | G3 |
| [C010](C010.md) | Opt-in telemetry client | S | runtime | C003, C004 | CT-TELEMETRY | G6 |
| [C011](C011.md) | Local development environment and example fixtures | S | devx | C007 | - | G1 |
| [C012](C012.md) | Release engineering skeleton: versioning, changesets, signing placeholders | S | release | C002 | - | G6 |

### P1 Agent runtime

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C013](C013.md) | Agent runner daemon wrapping the Claude Agent SDK | L | runtime | C004, C005, C025 | - | G3 |
| [C014](C014.md) | Agent session state machine emitting contract state names | M | runtime | C013, C025 | CT-STATE-MAP, CT-WS-SESSION-EVENTS | G3 |
| [C015](C015.md) | Tool permission engine: policies, allow, deny, always-rules | L | runtime | C013 | - | G3 |
| [C016](C016.md) | Command classification and execution sandbox policy | M | runtime | C015 | - | G6 |
| [C017](C017.md) | Git worktree manager | M | runtime | C013 | - | G5 |
| [C018](C018.md) | File lock client: local and remote advisory locks | M | runtime | C017 | - | G5 |
| [C019](C019.md) | Context management: token counting and compaction triggers | M | runtime | C013 | - | G6 |
| [C020](C020.md) | Skills loader and bundled skills pack | M | runtime | C013 | - | G6 |
| [C021](C021.md) | MCP server manager | M | runtime | C013 | - | G6 |
| [C022](C022.md) | Hooks engine | M | runtime | C015 | - | G6 |
| [C023](C023.md) | Memory store (project and user memory) | S | runtime | C013 | - | G6 |
| [C024](C024.md) | Sub-agent spawner with isolation | L | runtime | C013, C017 | - | G5 |
| [C025](C025.md) | Internal typed event bus | S | runtime | C003 | - | G3 |
| [C026](C026.md) | Local session persistence and resume | M | runtime | C013, C025 | - | - |
| [C027](C027.md) | Checkpoints and rewind | M | runtime | C017, C026 | - | - |
| [C028](C028.md) | Model selection and switching | S | runtime | C013 | - | - |
| [C029](C029.md) | Local cost and token accounting | S | runtime | C019, C025 | - | G4 |
| [C030](C030.md) | Interrupt and cancel semantics | S | runtime | C013 | - | - |

### P2 TUI

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C031](C031.md) | Terminal capability detection and colour tiers | S | tui | C001 | - | - |
| [C032](C032.md) | TUI theme engine: tokens to ANSI, light and dark, NO_COLOR | M | tui | C009, C031 | - | - |
| [C033](C033.md) | Half-block pixel renderer and Cento terminal component | M | tui | C009, C032 | - | - |
| [C034](C034.md) | TUI shell: Ink app skeleton, layout, resize | M | tui | C025, C032 | - | - |
| [C035](C035.md) | Prompt input: multiline, history, paste, slash commands | L | tui | C034 | - | G3 |
| [C036](C036.md) | Transcript view with virtualised scrollback | L | tui | C025, C034 | - | G3 |
| [C037](C037.md) | Diff view | M | tui | C036 | - | G3 |
| [C038](C038.md) | Permission prompt UI | M | tui | C015, C034 | - | G3 |
| [C039](C039.md) | Status line and footer | S | tui | C034 | - | G4 |
| [C040](C040.md) | Spinner and verb rotation | S | tui | C034 | - | - |
| [C041](C041.md) | Command palette | M | tui | C035 | - | - |
| [C042](C042.md) | Fleet panel: agent list, states, needs-you ordering | M | tui | C014, C034 | - | G3 |
| [C043](C043.md) | Task list and progress components | S | tui | C034 | - | - |
| [C044](C044.md) | Toast and notice system | S | tui | C034 | - | G4 |
| [C045](C045.md) | Keybinding system and help screen | M | tui | C035 | - | - |
| [C046](C046.md) | Mascot state driver: state map to animations, caps, dwell rules | M | tui | C014, C033 | - | - |
| [C047](C047.md) | Settings commands: theme, mascot, spinner, motion, density | S | tui | C032, C045 | - | - |
| [C048](C048.md) | First-run onboarding and init | M | tui | C004, C047 | - | - |
| [C049](C049.md) | TUI accessibility: reduced motion, NO_COLOR, screen-reader mode | M | tui | C032, C046 | - | - |
| [C050](C050.md) | Non-interactive mode: print, JSON output, pipes | M | runtime | C013, C025 | - | G1 |

### P3 Network

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C051](C051.md) | HTTP API client generated from OpenAPI | L | net | C003, C006, C007 | CT-PAGE | G1 |
| [C052](C052.md) | Auth client: device flow login, keychain token store, refresh | L | net | C004, C051, C056 | CT-AUTH | G1 |
| [C053](C053.md) | Account and device commands (login, logout, whoami, devices) | S | net | C052 | - | G1 |
| [C054](C054.md) | Relay WebSocket client: handshake, envelope, heartbeat | L | net | C003, C006, C007 | CT-WS-ENVELOPE, CT-VER | G2 |
| [C055](C055.md) | Reliable delivery: sequence, ack, resume, replay, dedupe | L | net | C054 | CT-WS-ENVELOPE, CT-RESUME | G2 |
| [C056](C056.md) | End-to-end crypto module: keys, frames, grants, rotation | L | net | C003 | CT-CRYPTO | G3 |
| [C057](C057.md) | Session client: create, join, leave, host mode | M | net | C051, C054, C056 | CT-RESUME, CT-WS-SESSION-EVENTS | G3 |
| [C058](C058.md) | Queue client: submit, track, cancel, host controls | M | net | C055, C057 | CT-WS-QUEUE | G3 |
| [C059](C059.md) | Presence and cursor client | S | net | C057 | CT-WS-PRESENCE | G5 |
| [C060](C060.md) | Control commands client | S | net | C057 | CT-WS-CONTROL | G3 |
| [C061](C061.md) | Remote approval routing client | M | net | C015, C057 | CT-WS-SESSION-EVENTS | G3 |
| [C062](C062.md) | Branch-mode fleet sync: agents, branches, locks | M | net | C017, C018, C057 | CT-WS-SESSION-EVENTS | G5 |
| [C063](C063.md) | Offline mode and reconnection behaviour | M | net | C026, C055 | CT-RESUME | G2 |
| [C064](C064.md) | Billing and entitlement client: fetch, cache, gate, upgrade links | M | net | C051 | - | G4 |
| [C065](C065.md) | Usage reporting: batched events and quota handling | M | net | C029, C051 | - | G4 |
| [C066](C066.md) | Notifications client: inbox, OS notifications | M | net | C051 | - | G5 |
| [C067](C067.md) | Feature flags client | S | net | C051 | - | G1 |
| [C068](C068.md) | Update client: check, download, verify, apply | L | release | C012, C051 | - | G6 |
| [C069](C069.md) | Webhook management commands | S | net | C051 | - | G5 |
| [C070](C070.md) | Audit log viewer commands | S | net | C051 | - | G5 |

### P4 LAN

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C071](C071.md) | LAN discovery over mDNS | M | net | C003 | CT-LAN | G3 |
| [C072](C072.md) | LAN host server speaking the session protocol | L | net | C054, C056, C071 | CT-LAN, CT-WS-ENVELOPE | G3 |
| [C073](C073.md) | LAN pairing with PAKE and device trust | L | net | C056, C071 | CT-LAN, CT-CRYPTO | G3 |
| [C074](C074.md) | Transport abstraction: LAN, relay, local behind one interface | M | net | C054, C072 | CT-WS-ENVELOPE | G3 |
| [C075](C075.md) | Host session engine: queue, approvals, broadcast, history | L | net | C025, C026, C074 | CT-WS-QUEUE, CT-WS-CONTROL, CT-WS-SESSION-EVENTS, CT-RESUME | G3 |
| [C076](C076.md) | Guest session engine: join, send, render remote transcript | M | net | C074, C075 | CT-WS-SESSION-EVENTS, CT-WS-QUEUE | G3 |
| [C077](C077.md) | Shared cursors and selections in the TUI | S | tui | C034, C059 | - | G5 |
| [C078](C078.md) | Conflict handling UX: locks and merge conflicts | M | tui | C038, C062 | - | G5 |
| [C079](C079.md) | Handoff and pair mode | M | net | C075, C076 | - | G5 |
| [C080](C080.md) | Reactions and comments UI | S | tui | C034, C075 | - | G5 |

### P5 Web

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C081](C081.md) | Web app scaffold: Vite, React, router, theme | M | web | C003, C009 | - | G6 |
| [C082](C082.md) | Web authentication with PKCE | M | web | C051, C081 | CT-AUTH | G1 |
| [C083](C083.md) | Web transcript and command-post view | L | web | C055, C056, C081 | - | G3 |
| [C084](C084.md) | Web fleet board | M | web | C062, C081 | - | G5 |
| [C085](C085.md) | Web roster, presence and cursors | M | web | C059, C081 | - | G5 |
| [C086](C086.md) | Web mascot canvas player | S | web | C009, C081 | - | G6 |
| [C087](C087.md) | Web workspace and members management | M | web | C051, C081 | - | G6 |
| [C088](C088.md) | Web invites and join flow with deep links | M | web | C087 | CT-DEEPLINK | G3 |
| [C089](C089.md) | Web billing UI | M | web | C064, C081 | - | G4 |
| [C090](C090.md) | Web settings and notifications UI | S | web | C066, C081 | - | G5 |
| [C091](C091.md) | Web webhooks and audit UI | S | web | C069, C070, C081 | - | G5 |
| [C092](C092.md) | Web accessibility and i18n framework | M | web | C081 | - | G6 |
| [C093](C093.md) | Web end-to-end tests with Playwright against the mock backend | M | qa | C007, C083 | - | G6 |

### P6 Distribution

| ID | Lane | Size | Role | Depends on | Implements | Gate |
|---|---|:-:|---|---|---|:-:|
| [C094](C094.md) | Installer and packaging: npm, Homebrew, standalone binaries | L | release | C002, C012 | CT-DEEPLINK | G6 |
| [C095](C095.md) | Auto-update integration and release channels | M | release | C068, C094 | - | G6 |
| [C096](C096.md) | Documentation site, README, man pages, built-in help | M | devx | C048 | - | G6 |
| [C097](C097.md) | Opt-in crash reporting and the doctor command | S | runtime | C005, C010 | - | G6 |
| [C098](C098.md) | Performance budgets and benchmarks | M | qa | C033, C036 | - | G6 |
| [C099](C099.md) | Client security review: secrets, sandbox, supply chain, SBOM | M | security | C002 | - | G6 |
| [C100](C100.md) | Consumer conformance suite and release gate | L | qa | C007, C055, C056, C057, C058, C059, C075, C076 | - | G6 |
