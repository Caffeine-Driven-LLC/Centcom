# release channels (lane C095)

Rehearses releasing and updating without a real account, signing key or host.

- `channels.ts`: `ReleaseChannels` publishes signed releases to stable, beta or nightly, promotes one channel to another, yanks a bad release, raises the minimum supported version, and rotates the signing key. The signing pair is made by the caller (`makeTestSigner`); no private key is stored in the repository.
- `mock-server.ts`: a loopback-only server for `GET /v1/releases/{channel}/latest`, `/v1/status` and the artifact files, with faults: `tamper`, `bad_signature`, `unknown_kid`, `replay_old`, `wrong_channel`, `too_old_426`, `server_error`, `truncate`, and a latency.
- `scenarios.ts`: the update path end to end on real files (check, download, verify, swap, health check, rollback, crash recovery, a live session). `pnpm release:update-check` runs them and writes `release-gate-inputs/update-report.json`, which the release gate reads for its `update` line.

What this does NOT prove, and a human must do: generate the production Ed25519 keys offline and put the public halves in `apps/cli/src/autoupdate/keys.ts`; sign real artifacts with them in the release job; host the files; implement `/v1/releases/{channel}/latest` on the backend with the same shape.
