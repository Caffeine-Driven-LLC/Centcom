# Performance budgets

Run `pnpm bench` (all) or `pnpm bench --fast` (the pull request subset). `--filter <name>` picks metrics by name, `--update-baseline` writes `tools/bench/baseline.json` (the commit message then needs a line starting `Baseline:` saying why; `node tools/bench/check-baseline-commit.mjs origin/main` checks it). The results go to `bench-results.json`; `pnpm bench:compare before.json after.json` prints the change.

## How a result is judged

- **Reference machine:** a 4 vCPU, 8 GB CI runner. Every machine runs a fixed calibration loop; times are scaled by the ratio to the reference machine's calibration (`calibration_ms` in `bench-results.json`), rates the other way round.
- **Budget:** the p95 must stay inside it (`fail`). A budget is absolute.
- **Regression:** the p50 must not be more than 15 % worse than the baseline (`regressed`).
- **Noise:** a metric whose middle 80 % of samples spread by more than 25 % is `unstable`: shown, never failing on regression (the card asks for 10 % across five runs; one run of very short operations is judged more loosely).
- Only metrics marked as gating can make the run exit 1.

## Metrics

| Metric | Budget (p95) | Gating | Notes |
|---|---|---|---|
| `cli.version.warm` | 150 ms | no | measured through `tsx`, so far above the budget; gates once the packaged CLI exists (C094) |
| `transcript.scroll.frame` | 16 ms | yes | 10,000 messages: re-layout (cached) and one 40-row slice |
| `transcript.layout.10k` | 1.5 s | yes | first layout of 10,000 messages (full set only) |
| `mascot.redraw` | 2 ms | yes | half-block render of one frame |
| `envelope.parse` | 0.5 ms | yes | validating one frame |
| `crypto.encrypt_sign.4k` | 1 ms | yes | XChaCha20-Poly1305 and Ed25519 |
| `crypto.encrypt_sign.192k` | 8 ms | yes | near the largest frame |
| `crypto.verify_decrypt.4k` | 1 ms | yes | |
| `prompt.keypress.paint` | 50 ms | no | a key to the first byte of the new frame, in a real Ink render of the whole app with 60 messages (full set only) |
| `session.save.1k` | 25 ms | no | saving a conversation of 1,000 messages; it runs about every 600 ms while the agent writes |
| `cli.start.bundle` | 400 ms | no | `centcom --version` through the compiled bundle with V8's code cache, as `bin/centcom` runs it (full set only) |
| `diff.paint.5k` | 300 ms | yes | first paint of a 5,000-line diff: parse and lay out every row (full set only) |
| `guest.reducer.rate` | 20,000 frames/s (minimum) | yes | the guest reducer on a busy session: messages, answer deltas, tools, agent states (full set only) |
| `resume.replay.5k` | 1.5 s | yes | 5,000 buffered frames arriving newest first are put in order and reduced to a state (full set only) |
| `memory.transcript.10k` | 300 MB RSS | no | the harness alone is about 300 MB; gates when measured in the packaged CLI |

Not measured here yet: the 10,000-delta leak check (it needs the garbage collector to be exposed, which the harness does not start with) and the first interactive prompt of the packaged CLI. The web budgets come from the web build report.

## CI

`.github/workflows/bench.yml` runs the fast subset on demand and the full set nightly, uploads `bench-results.json` and appends to `perf-history.json`. It does not gate pull requests until the baseline has settled on the CI runner.
