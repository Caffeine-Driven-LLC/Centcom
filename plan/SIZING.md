# Sizing guidance

The lane structure (105 client, 101 backend) stays. These lanes were flagged by their authors as the most likely to exceed their size (L = 5 days). A lead may split one at kickoff by adding sub-lane suffixes (for example `B016a`, `B016b`) through a plan PR that keeps `depends_on` acyclic and only moves deliverables; contracts never change because of a split.

## Backend
| Lane | Suggested split line |
|---|---|
| B011 mock client simulator | scripted-client core vs. scenario library |
| B016 device authorization | endpoints + code store vs. device registration (overlaps B020: adopt `registerDevice`) |
| B017 token service | issue/refresh-rotation vs. JWKS rotation and revocation lists |
| B029 invites | create/accept/revoke vs. key-bundle storage and email |
| B038 relay handshake | ticket verification vs. negotiation and supersede |
| B041 sequencing | seq/dedupe/buffer vs. per-member rate limiting |
| B042 resume/replay | replay window vs. hot-buffer rehydration |
| B045 cross-node routing | pub/sub fan-out vs. control channel |
| B051 control commands | commands vs. kick/rotate atomicity |
| B052 queue service | state machine vs. auto-approve policy |
| B070 Stripe integration | gateway + catalogue vs. persistence and routes |
| B081 outgoing webhooks | management API vs. delivery engine |
| B091 / B092 infrastructure / deploy | per environment, or IaC vs. pipeline |
| B095 load testing | harness vs. capacity model |
| B100 provider conformance suite | per contract family (REST / WS / events / entitlements) |

## Client
| Lane | Suggested split line |
|---|---|
| C003 protocol package | helper functions (ids, time, text) vs. code generation |
| C007 mock backend | REST half vs. WebSocket relay simulator |
| C008 test harness | pty harness vs. Ink snapshot tester |
| C013 agent runner | daemon/IPC vs. runner core |
| C015 permission engine | rules engine vs. approval broker |
| C025 event bus | only if the catalogue grows beyond ~25 events |
| C033 pixel renderer | renderer vs. the 2x6 mini sprite |
| C035 prompt input | slash-command registry vs. editing buffer |
| C036 transcript view | virtualised list vs. Markdown renderer |
| C049 TUI accessibility | linear renderer vs. conformance suite |
| C051 HTTP client | generator vs. runtime |
| C057 session client | session REST vs. key handling and snapshots |
| C072 LAN host | socket server vs. resume and transcript |
| C075 host session engine | authority vs. history and snapshots |
| C079 handoff and pair mode | handoff vs. pair mode |
| C083 web transcript | transcript renderer vs. queue UI |
| C094 packaging | per operating system |
| C100 consumer conformance suite | per contract family; G1-G5 scripts vs. release gate checklist |
