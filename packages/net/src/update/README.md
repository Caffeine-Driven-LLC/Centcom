# update client (lane C068)

Checks a release channel, downloads the file for this computer, proves it is the published one, and puts it in place. Nothing is installed that has not been verified.

- **`UpdateClient.check()`** asks `GET /v1/releases/{channel}/latest` for this platform and architecture. A version is offered only when it is higher than the current one, on the chosen channel, and not a pre-release on `stable`. `required` is set when this version is below `min_supported` or the service said the client is too old (`markRequired()`, for HTTP 426 / close code 4426).
- **`download()`** streams to a file next to the program, resuming an interrupted download with a `Range` request, stopping at one byte over the size the release states, with 10 s connect and 60 s idle limits.
- **`verify()`** compares the file's SHA-256 with the manifest (constant time) and checks the Ed25519 signature over the 32 digest bytes against the trusted keys (two can be valid at once). On any failure the file is deleted.
- **`apply()`** refuses an update that was not verified (`NotVerifiedError`). It renames the staged file over the program and keeps the old one as `centcom.prev`; on Windows the running program is renamed away first. `rollback()` puts the old one back.
- **Package-manager installs** (npm, Homebrew) never update themselves: `centcom update` prints `npm install --global centcom@latest` or `brew upgrade centcom`.
- **When to look:** `shouldCheck` allows one background check a day, never when `CENTCOM_NO_UPDATE_CHECK=1`, `update.check=false` or in CI; `backgroundCheck` gives up after 5 s and never throws.
- **Keys:** `PRODUCTION_KEYS` is empty until the release signing procedure fills it; with no key every update is refused.

The REST contract (OpenAPI) and the manifest schema spell some manifest fields differently (`signature` / `sig`, `sha256:<hex>` / `<hex>`, `min_supported_version` / `min_supported`, `macos` / `darwin`, `windows` / `win32`). `normaliseManifest` reads both until the contracts agree.

`centcom update [--check] [--channel stable|beta|nightly] [--yes] [--rollback] [--json]`: exit 0 up to date or updated, 1 failed, 10 an update is available (with `--check`).
