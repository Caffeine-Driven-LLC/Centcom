# Releasing

How Centcom is versioned, which channels exist, and how to run a release dry run. This is the skeleton from lane C012: it builds, stamps, signs and assembles a manifest, and **publishes nothing**. Publishing to npm, GitHub releases, Homebrew and the CDN arrives with the packaging lane (C094) and the update client (C068). Wire shapes belong to the contracts, not to this page: the manifest is [`CT-API-RELEASES`](../contracts/02-rest-api.md#ct-api-releases) ([schema](../contracts/schemas/release-manifest.schema.json)) and versioning rules are [`CT-VER`](../contracts/00-foundations.md#ct-ver--versioning-and-compatibility).

## Versioning policy

- **One product version.** Every `@centcom/*` package is in one Changesets `fixed` group ([`.changeset/config.json`](../.changeset/config.json)), so they always share a version. `build-meta.mjs` refuses to stamp a build if they ever disagree.
- **Semver, judged by users.** `patch` fixes, `minor` adds, `major` breaks a user, a config file or a stored format. While the product is `0.x`, breaking changes bump `minor`.
- **Changesets record intent.** A PR that changes something users can notice adds a changeset ([when and how](../.changeset/README.md)). `changeset version` writes the new version and changelog at release time; nobody edits versions by hand.
- **Contract version is stamped, not chosen.** Each build records the `contract_version` from [`contracts/index.json`](../contracts/index.json) it was built against (CT-VER). If that file is unreadable the build stops; nothing is ever stamped with an unknown contract version.

## Channels

| Channel | Version | Meant for |
|---|---|---|
| `stable` | `x.y.z` | Everyone |
| `beta` | `x.y.z-beta.N` (`N` = `--beta-number`, else the CI run number, else `1`) | Early adopters |
| `nightly` | `x.y.z-nightly.YYYYMMDD` (UTC day of the build time) | Us; the default when no channel is given |

`x.y.z` is the shared package version. Prerelease versions sort below the stable version they lead to (`1.2.0-beta.3 < 1.2.0`).

## The tools

All three live in `tools/release/`, run on plain Node 22 and take no secrets on the command line.

| Command | Does | Exit codes |
|---|---|---|
| `node tools/release/build-meta.mjs [--channel C] [--out dist/build-meta.json] [--now T] [--beta-number N] [--commit SHA]` | Writes `{ version, contract_version, commit, built_at, channel, node }`. `built_at` is RFC 3339 UTC with milliseconds; the time comes from `--now`, else `SOURCE_DATE_EPOCH`, else the clock. No hostnames, usernames or paths are recorded. | 0 ok, 2 usage or unreadable input |
| `node tools/release/sign.mjs --file F --key-file K [--out F.sig]` | Writes `F.sig`: an Ed25519 signature over the 32 raw bytes of the file's SHA-256 digest, base64url without padding. The key must be a PEM Ed25519 private key in a file with mode `0600`. | 0 ok, 2 no key, bad key, wrong mode or unreadable file |
| `node tools/release/sign.mjs --verify --file F --sig S --pub P [--sha256 HEX]` | Verifies `S` against `F` with the PEM public key `P`. With `--sha256` the file digest must also equal the given one (compared in constant time). | 0 ok, 1 does not verify, 2 usage or unreadable input |
| `node tools/release/manifest.mjs --channel C --dir artifacts/ --out manifest.json [--meta dist/build-meta.json] [--pub P] [--base-url URL] [--min-supported V] [--sig-kid ID] [--notes-url URL] [--now T]` | Assembles the release manifest from `artifacts/` and the build metadata. With `--pub`, every signature is verified before its artifact is listed. | 0 ok, 1 missing/duplicate/unsigned/tampered/empty artifact, 2 usage or unreadable input |

Artifacts are named `centcom-<platform>-<arch>[.<ext>]` with the signature next to each as `<name>.sig`. The manifest needs exactly one artifact for each of `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64` and `win32-x64` and lists them in that (byte) order; a missing pair fails with every missing pair named. Other files in the directory are ignored. `kind` follows the extension: `.tgz` is `npm`, `.zip`/`.tar.gz`/`.tar.xz`/`.tar.zst` are `archive`, anything else is `binary`.

| Manifest option | Default | Rule |
|---|---|---|
| `--base-url` | `https://downloads.centcom.invalid/releases` | Absolute URL. Artifact URLs are `<base>/<channel>/<version>/<name>`. The default is a placeholder that cannot resolve. |
| `--min-supported` | `0.0.0` (no minimum) | A version. Raise it when a release must force older clients to upgrade (CT-VER `client_too_old`). |
| `--meta` | `dist/build-meta.json` | Its `channel` must equal `--channel`. |
| `--now` | the clock (or `SOURCE_DATE_EPOCH`) | Becomes `released_at`. |

## Dry run

### In CI

Run **Release (dry run)** ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) from the Actions tab and pick a channel. It runs only on `workflow_dispatch`, only in the protected `release` environment (add required reviewers there), and:

1. installs with the frozen lockfile, typechecks, tests and builds;
2. stamps `dist/build-meta.json`;
3. packages one placeholder archive per platform/arch (the same JS bundle for all five until C094 builds real binaries);
4. signs each archive with `RELEASE_SIGNING_KEY` from the environment secrets, or, if the secret is absent, with a throwaway key generated on the runner (a warning says so), then verifies each signature;
5. assembles `artifacts/manifest.json`, verifying every signature against the public half of the key;
6. uploads `artifacts/` and `build-meta.json` as a workflow artifact kept for 7 days.

The publish steps at the end of the workflow are comments. A test fails if `npm publish`, `gh release create` or a CDN upload ever appears outside a comment.

### Locally

```sh
pnpm install --frozen-lockfile && pnpm web:build
node tools/release/build-meta.mjs --channel nightly
mkdir -p artifacts
for t in linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64; do
  tar -czf "artifacts/centcom-$t.tar.gz" dist/build-meta.json apps/web/dist package.json
done
key="$(mktemp -d)/dry-run.key"                       # throwaway, outside the repo
(umask 077; openssl genpkey -algorithm ed25519 -out "$key")
openssl pkey -in "$key" -pubout -out "${key%.key}.pub"
for f in artifacts/centcom-*.tar.gz; do node tools/release/sign.mjs --file "$f" --key-file "$key"; done
node tools/release/manifest.mjs --channel nightly --dir artifacts --out artifacts/manifest.json --pub "${key%.key}.pub"
```

`dist/` and `artifacts/` are git-ignored. Delete the throwaway key when you are done.

## Key custody

- **The signing key is never in the repo**, not even a test one. Tests generate key pairs at run time in temp dirs; a test fails if a PEM private key appears in any release file. `*.key` is git-ignored as a second line of defence.
- The real key lives only in the `RELEASE_SIGNING_KEY` secret of the `release` GitHub environment (PEM, PKCS#8, Ed25519). The workflow writes it to the runner's temp dir with mode `0600`, uses it, and deletes it in the same step.
- `sign.mjs` fails closed: no key, an unreadable key, a non-Ed25519 key, or a key file readable by anyone but its owner (mode other than `0600` on POSIX) means exit 2 and no signature. It never prints key material and never writes to the artifact.
- The public key is what clients pin. Rotating the key means shipping the new public key in a release signed by the old one first; `sig_kid` in the manifest names which key signed an artifact.
- Generate the production key on an offline machine (`openssl genpkey -algorithm ed25519`), store a sealed backup with two named custodians, and record its public key and fingerprint in the release notes of the release that introduces it.

## Failure modes

| Situation | Result |
|---|---|
| `contracts/index.json` unreadable or without a valid `contract_version` | `build-meta.mjs` exits 2; nothing written |
| `@centcom/*` packages disagree on the version | `build-meta.mjs` exits 2 |
| A platform/arch artifact is missing | `manifest.mjs` exits 1 naming every missing pair; nothing written |
| An artifact has no `.sig`, a malformed one, or one that does not verify | `manifest.mjs` exits 1 naming the pair |
| Key file unreadable, wrong mode, or not Ed25519 | `sign.mjs` exits 2; the artifact is untouched and no `.sig` is written |
| Artifact changed after signing | `sign.mjs --verify` exits 1 |

## Testing

`pnpm vitest run tools/release` runs `tools/release/release.test.ts`: every channel with an injected date, sign/verify (good, tampered, wrong key, bad permissions, no key), manifest ordering and validation against the generated validator in `@centcom/protocol`, the workflow grep checks, and `changeset status` against a throwaway git repo holding this workspace's packages.
