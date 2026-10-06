# @centcom/protocol

Every wire contract as types and validators, generated from `contracts/` so nobody hand-writes a wire type. Plus the helpers the contracts require (IDs, time, base64url, text rules, versions).

```sh
pnpm --filter @centcom/protocol gen           # regenerate src/generated (after a contract change)
pnpm --filter @centcom/protocol gen --check   # exit 1 if the committed output is stale (CI runs this)
```

Output is deterministic (same input, same bytes) and committed. Validators are compiled ahead of time with Ajv standalone, so there is no `new Ajv` and no `eval`/`new Function` at runtime; they work in a single-file binary and under a strict browser CSP.

## Reading and writing

```ts
import { parseFrame, parseEventPayload, parseSecretPayload, assertWritableFrame, payloadMode, isAgentWireState } from '@centcom/protocol';

const r = parseFrame(JSON.parse(text));
if (r.ok) { r.value; r.unknown /* true when the event kind is one we do not know */ }
```

- **Reading is tolerant** (CT-VER "Unknown data"): unknown fields, frame types, event kinds and enum values are accepted. Missing or wrongly typed required fields are still errors, reported as `{ pointer, code }`.
- **Writing is exact**: `assertWritableFrame` throws a `ProtocolError` for any field, kind or value the schema does not define.
- `payloadMode(kind)` says whether an event kind is `clear`, `encrypted` or `hybrid`; `parseEventPayload` validates the cleartext `p`, `parseSecretPayload` the decrypted secret.

## Helpers

| Module | What it gives you |
|---|---|
| `ids` | `newIdGenerator({ now, random })` (monotonic ULIDs, injected clock and RNG), `isId`, `idPrefix`, all 24 prefixes |
| `time` | `nowRfc3339`, `parseRfc3339`, `Money` (integer minor units, USD or EUR) |
| `b64u` | base64url without padding, hash strings |
| `text` | NFC normalising, control-character rejection, the 40/60/80 name limits, slugs |
| `version` | `CONTRACT_VERSION`, `userAgent`, `compareVersions` (semver with prereleases), `isClientTooOld` |
| generated | `ErrorCode` and `ERROR_TABLE` (status, area, retryable) from `errors.json`; `STATE_NAMES` and `AGENT_WIRE_STATES` from `state-map.json` and `09-state-map.md`; `OPERATIONS` and `OpenApiPaths` from `openapi.yaml` |

## Notes on the generated output

- Event kinds and their modes are derived from the schema's `p_*` (cleartext) and `s_*` (secret) definitions; a test checks the derivation against all fixtures.
- `AGENT_WIRE_STATES` is the list a client may *emit*, taken from the "Agent-level states" section of `09-state-map.md`. The relay accepts every key of `state-map.json`.
- The lane card asked for `json-schema-to-typescript`; a small purpose-built emitter is used instead so the output is fully deterministic and the subset of JSON Schema the contracts use is checked (anything else throws).
