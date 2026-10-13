# Release gate checklist

`pnpm release-gate` exits 0 only when every line below passes. It reads the reports other gates leave in `release-gate-inputs/` (override with `--dir`); a missing report is a failure, never a pass.

| Check | Input file | Passes when |
|---|---|---|
| conformance | `conformance-report.json` (from `pnpm conformance --out`) | at least one contract ran and none failed |
| coverage | `coverage-summary.json` `{ "packages": { "<name>": <line %> } }` | every package is at or above 80 % |
| bench | `bench-report.json` `{ "breaches": [] }` (lane C098) | no budget breaches |
| security | `security-report.json` `{ "findings": [{ "severity": "..." }] }` (lane C099) | no high or critical finding |
| artifacts | `artifacts.json` `{ "artifacts": [{ "name", "sha256", "signature" }], "sbom": "<path>" }` | every artifact has a hash and a signature, and an SBOM is named |
| contract-lock | run by the gate: `python3 tools/plan/lock.py --check` | the lock matches the contracts |
| docs | `docs-report.json` `{ "ok": true }` (`pnpm docs:check`, lane C096) | ok |
| installers | `installers-report.json` `{ "ok": true }` (lane C094) | ok |
| update | `update-report.json` from `pnpm release:update-check` (lane C095): `{ "ok": true, "scenarios": [{ "id", "ok" }] }` | ok, and every scenario ok (a report with no scenarios fails) |

Before tagging a release, also read by hand: the changelog, the notes for contract changes, and that the production release keys are filled in (`apps/cli/src/autoupdate/keys.ts`, two slots; empty means every update is refused).

`pnpm conformance --strict` is the stricter run for the release branch: a client-implemented contract with no fixtures and no unexpired waiver (`packages/testkit/src/conformance/waivers.json`, at most 60 days) exits 3.

## Gates

`pnpm gate <G1..G6> [--backend mock|<base url>] [--out gate-report-<G>.json]` runs the consumer side of an integration gate with the same steps against the mock or a real backend. Built: **G1** (device-flow login, `GET /v1/me`, and `/v1/me` refused without a token; about 15 s against the mock because it polls at the server's 5 s interval; against a real backend a person must approve the code). **G2 to G5** report `not_built` (a failure) until the relay, session, queue, billing and branch-mode lanes they exercise exist. **G6** passes only if G1 to G5 do.

The conformance run also covers contracts the client only reads (`CT-API-RELEASES`, `CT-ENTITLEMENTS`, `CT-NOTIF-PAYLOAD`).
