# Security review log

One row per review or finding. Owner and date are required for anything not checked by a script.

| Date | Item | Finding or result | Owner | Status |
|---|---|---|---|---|
| 2026-10-07 | Secret scan over the tracked files | Only labelled test values for the redaction tests; listed with reasons in `tools/security/policy.json` | Alexander Gese | done |
| 2026-10-07 | Shared secret-pattern list | No pattern for `cen_live_` / `cen_test_`, GitHub (`ghp_`), Slack (`xox`), Stripe or npm tokens; the list is a contract, so a contract PR is needed. The net logger covers the Centcom keys on its own | contract owners | open |
| 2026-10-07 | Pinning | 28 dependency ranges use `^`; waived until 2026-12-31 (C001 brings exact pins) | Alexander Gese | waived |
| 2026-10-07 | CI workflow | `ci.yml` used tags for three actions; now pinned by commit SHA like `release.yml` | Alexander Gese | done |
| 2026-10-07 | Licences | `caniuse-lite` (CC-BY-4.0), two `@fontsource-variable` packages (OFL-1.1) and `argparse` (Python-2.0) are outside the allow-list; listed as exceptions with reasons | Alexander Gese | done |
| 2026-10-07 | Agent runner environment handling | not reviewed yet | Alexander Gese | due 2026-10-21 |
| 2026-10-07 | Web CSP and token storage (C081, C082) | the web app is not built yet | Alexander Gese | due when C081 lands |
