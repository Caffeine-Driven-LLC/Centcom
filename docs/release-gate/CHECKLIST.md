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
| update | `update-report.json` `{ "ok": true }` (lane C095) | ok |

Before tagging a release, also read by hand: the changelog, the notes for contract changes, and that the production release keys (the update client's key set) are filled in.

`pnpm conformance --strict` is the stricter run for the release branch: a client-implemented contract with no fixtures and no unexpired waiver (`packages/testkit/src/conformance/waivers.json`, at most 60 days) exits 3.
