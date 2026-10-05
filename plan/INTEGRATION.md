# Integration gates

Joint, scripted checks run against real builds of both sides. Each gate lists the lanes that declare they unblock it. The provider-side script lives in lane B100, the consumer-side in lane C100.


## G0 · Contract freeze

Contracts reviewed and locked; `tools/plan/validate_contracts.py` passes; both repos hold identical contracts (`lock.py --compare`).

- **backend** lanes: B001, B002, B003, B004, B005
- **client** lanes: C001, C002, C003

## G1 · Hello

Client authenticates via the device flow against the real API and fetches `/v1/me`.

- **backend** lanes: B006, B007, B008, B009, B010, B012, B013, B014, B015, B016, B017, B018, B020, B021, B022, B023, B024, B025, B086
- **client** lanes: C004, C005, C006, C007, C008, C011, C050, C051, C052, C053, C067, C082

## G2 · Tunnel

Client connects to the real relay: handshake, heartbeat, forced disconnect, resume.

- **backend** lanes: B011, B037, B038, B039, B040, B041, B042, B053, B054, B055, B056
- **client** lanes: C054, C055, C063

## G3 · Command post

Two real clients: host + guest, queue → approve → agent runs → events fan out, end-to-end encrypted.

- **backend** lanes: B027, B028, B031, B043, B044, B045, B046, B049, B051, B052
- **client** lanes: C009, C013, C014, C015, C025, C035, C036, C037, C038, C042, C056, C057, C058, C060, C061, C071, C072, C073, C074, C075, C076, C083, C088

## G4 · Money

Checkout → webhook → entitlement flips → relay unlocked; quota warnings arrive.

- **backend** lanes: B019, B030, B069, B070, B071, B072, B073, B074, B075, B076, B077, B078, B079, B080
- **client** lanes: C029, C039, C044, C064, C065, C089

## G5 · Fleet

Three clients, branch mode, file locks, presence, notifications, webhooks.

- **backend** lanes: B029, B032, B033, B034, B035, B036, B047, B048, B057, B058, B059, B060, B061, B062, B063, B064, B065, B066, B067, B068, B081, B082, B083
- **client** lanes: C017, C018, C024, C059, C062, C066, C069, C070, C077, C078, C079, C080, C084, C085, C090, C091

## G6 · Launch

Load + chaos + security review, installer + auto-update, runbooks, both conformance suites green.

- **backend** lanes: B026, B050, B084, B085, B087, B088, B089, B090, B091, B092, B093, B094, B095, B096, B097, B098, B099, B100
- **client** lanes: C010, C012, C016, C019, C020, C021, C022, C023, C068, C081, C086, C087, C092, C093, C094, C095, C096, C097, C098, C099, C100
