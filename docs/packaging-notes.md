# Packaging notes (C094, first part)

What is here, what a release has to look like for it, and what is still missing. C094 is not finished: only the parts a test can prove were built, the rest needs CI jobs, signing keys or other machines.

## Built and tested

- **`centcom --version --json`** prints `{version, contract, platform, arch, node, channel}`.
- **`centcom link <centcom://…>`** (`apps/cli/src/protocol-handler/link.ts`). The operating system runs it when a `centcom://` link is opened. The link is parsed with the same strict rules as the web app (`apps/web/src/invite/deeplink.ts`). A valid link gets a yes/no question that says only what kind of link it is ("to join a session"); on yes the matching page of centcom.dev opens in the browser (a join link keeps its `#k=` key fragment, which the page reads locally). Exit codes: 0 opened, 1 the browser could not be opened, 2 invalid link (one neutral line, nothing from the link is repeated) or a link for the desktop app, 3 declined. Without a terminal to answer it declines. Nothing is sent over the network by this command.
- **`centcom install-handler [--uninstall] [--dry-run]`** (`handler.ts`) registers the handler for the current user only, no sudo. Each platform is a plan of actions that a small executor applies, so the plans are tested everywhere. Linux: `~/.local/share/applications/centcom.desktop` (runs `centcom link %u` in a terminal so it can ask) and `xdg-mime default`; uninstall removes the file and only our line from `mimeapps.list`. A missing `xdg-utils` warns and prints the manual steps (exit 0). Windows: `reg add` under `HKCU\Software\Classes\centcom`. macOS: a small app in `~/Applications` made with `osacompile` that opens Terminal with `centcom link <url>`, declared with `plutil` and registered with `lsregister`. No entry ever contains a link, a token or a key.
- **`packaging/install.sh`** (POSIX sh; needs curl, tar, openssl 3 and sha256sum or shasum). It downloads `centcom-<version>-<os>-<arch>.tar.gz`, `SHA256SUMS` and `<archive>.sig`, and installs only after BOTH the checksum matches `SHA256SUMS` AND the Ed25519 signature over the 32 raw digest bytes verifies (the scheme of `tools/release/sign.mjs`). Any failure leaves nothing in the install folder and no temporary files. It retries downloads three times (1, 3, 9 s), never uses sudo, and only edits `~/.profile` with `--modify-path`. **The release signing key is not built in yet, so the real installer refuses to install** (`PUBKEY_PEM` is empty); tests use `--pubkey-file`.
- **No install scripts**: `tools/package/package.npm.no-scripts.test.ts` reads every `package.json` in the repository.

## Release layout the installer expects

```
<base-url>/centcom-<version>-<os>-<arch>.tar.gz     (zip on Windows)
<base-url>/centcom-<version>-<os>-<arch>.tar.gz.sig  base64url Ed25519 signature of the SHA-256 digest bytes
<base-url>/SHA256SUMS                                "<hex>  <file name>" per line
```

## Not built yet (needs a human or CI)

- The standalone binaries: Node SEA build for the five targets (`tools/package/build-sea.ts`), the size limits (120 MB / 45 MB), the cold-start budget, byte-identical rebuilds with `SOURCE_DATE_EPOCH`.
- The npm meta package with per-platform `optionalDependencies`, and `npm pack --dry-run` checks.
- `install.ps1` (PowerShell has no Ed25519 in the box; it would have to use openssl too), the Homebrew formula and `brew audit --strict` / `brew test` on macOS arm64.
- The three-OS CI jobs that check handler registration (`xdg-mime query default`, `defaults read`, `reg query`) on real machines. The macOS and Windows plans are tested as plans only; they have not been run on those systems.
- The signing key and its custody, notarisation and Authenticode certificates (an ops task).
