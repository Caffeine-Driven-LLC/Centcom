# auto-update integration (lane C095)

Installed copies find, check and apply new versions on the stable, beta or nightly channel, never in the middle of a session. Downloading, the SHA-256 check and the Ed25519 signature check are the update client's (`packages/net/src/update`, lane C068); this folder adds the rules around them.

| File | What it owns |
|---|---|
| `install-method.ts` | `detectInstallMethod(execPath, env)` -> `standalone`, `npm`, `brew`, `unknown`; the `CENTCOM_INSTALL_METHOD` build flag; the exact package-manager commands |
| `schedule.ts` | `shouldCheck(now, lastCheck, rng, intervalH)`: every 6 h +/- 20 %; the last look kept in `update-check.json` in the state folder |
| `apply.ts` | `applyUpdate(plan, fs, runner)`: swap through `<exe>.new`, keep `<exe>.previous`, run `<exe> --version --json` for at most 5 s, roll back if it fails; `deferred` while a session is live; `recoverInterrupted` settles a crash at next start |
| `policy.ts` | downgrade refusal, the nightly confirmation, when an install may update itself |
| `startup.ts` | `startUpdateCheck`: fire-and-forget at start; skipped under `CI`, with `update.auto` or `update.check` off, or `CENTCOM_NO_UPDATE_CHECK=1` |
| `too-old.ts` | HTTP 426, `client_too_old`, close code 4426, `/v1/status.min_client_version`: hosted features blocked, LAN and local still start |
| `notices.ts` | the "Update available: 1.4.3" toast for a `sys.notice client_update_available` or a notification `update_available`; a notice never starts a download |
| `keys.ts` | the ONLY list of trusted release keys: two slots (`primary`, `next`) for rotation. Both are empty until the release procedure fills them, so until then every update is refused |
| `ports.ts` | `FsPort` and `Runner`, the two doors to files and child processes (tests inject faults) |

## Command

`centcom update [--check] [--channel stable|beta|nightly] [--yes] [--allow-downgrade] [--rollback] [--json]`

Exit 0 up to date or updated, 1 failed, cancelled or refused (a downgrade, a failed health check, a live session), 2 bad options, 10 an update is available (`--check`), 11 the download failed verification, 12 this install does not update itself (npm: `npm i -g @centcom/cli@latest`, Homebrew: `brew upgrade centcom`, a source checkout). Switching to `nightly` shows a warning and needs `--yes` or a typed yes.

## Config

`update.check` (default on), `update.auto` (default on; the effective default is off for anything but a standalone install), `update.channel` (default stable). The interval is `update.check_interval_h` (default 6, 1 to 168 hours, give or take 20 %), passed to `shouldCheck`.

## Failure modes

Offline or slow: silent in the background (5 s limit), one plain line for an explicit `centcom update`. Disk full or no permission: the swap stops before the program is touched. Unknown key id or bad signature: refused, the download is deleted, reinstall by hand. Killed mid-swap: `recoverInterrupted` restores or discards at the next start. A new program that does not answer its health check: the old one is put back and `.previous` is kept.

## Test

`pnpm exec vitest run apps/cli/test/autoupdate tools/release-channels`. The end-to-end tests use the mock release server in `tools/release-channels` with a throwaway key and real files; `pnpm release:update-check` runs the same scenarios and writes the report the release gate reads.
