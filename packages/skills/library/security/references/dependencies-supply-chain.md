# Dependencies and supply chain

Most of the code in a modern application was written by strangers and
arrives through a package manager. This file covers making that pipeline
trustworthy: lockfiles that are actually honored, audit tools per ecosystem
with the commands and how to triage their output, automated update bots
configured so they help rather than spam, pinning CI actions, provenance
and SLSA, install scripts, typosquatting and dependency confusion, and
what to do when a package you depend on is compromised.

## Contents

1. The threat model for dependencies
2. Lockfiles: commit them, honor them
3. Audit commands and triage per ecosystem
4. Reading an advisory: is it reachable?
5. Dependabot and Renovate configurations
6. Pinning GitHub Actions and other CI dependencies
7. Install scripts and the postinstall problem
8. Typosquatting, dependency confusion, and private registries
9. Provenance, signatures, SLSA, and SBOMs
10. Choosing a dependency
11. When a dependency is compromised
12. Checklist

## 1. The threat model for dependencies

- **Known vulnerabilities** in a version you use (the CVE/GHSA stream).
  Most common, least dramatic; the fix is updating.
- **Malicious packages**: typosquats (`lodahs`), takeovers of abandoned
  packages, maintainer account compromise, protestware, packages that
  exfiltrate env vars at install time. Install scripts and CI are the
  usual targets because they run with secrets.
- **Dependency confusion**: your private package `@acme/utils` or
  `acme-utils` is not reserved on the public registry; an attacker
  publishes it with a higher version and your build pulls theirs.
- **Build and CI compromise**: an unpinned GitHub Action, a compromised
  base image, a build tool plugin fetched over HTTP.
- **Transitive explosion**: you audit your 40 direct dependencies; they
  bring 1,400. The attacker targets the one nobody looks at.

Controls map to these: lockfiles + audits (known vulns), install script
control + registry scoping + review of new packages (malicious), scoped
registries (confusion), SHA pinning + provenance (CI), SCA tooling that
covers transitives (explosion).

## 2. Lockfiles: commit them, honor them

A lockfile records the exact resolved version and integrity hash of every
transitive dependency. Without it, two builds a day apart can differ, and
a malicious patch release of a transitive dependency enters silently.

| Ecosystem | Lockfile | Install honoring the lock (use in CI and Docker) | Common mistake |
|---|---|---|---|
| npm | `package-lock.json` | `npm ci` | `npm install` in CI, which may update the lock |
| pnpm | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` | |
| yarn | `yarn.lock` | `yarn install --immutable` (v2+) / `--frozen-lockfile` (v1) | |
| bun | `bun.lock` / `bun.lockb` | `bun install --frozen-lockfile` | |
| pip | none by default | `pip-tools` (`requirements.txt` compiled from `requirements.in` with `--generate-hashes`), or `uv lock` + `uv sync --frozen`, Poetry `poetry.lock` + `poetry install --sync`, PDM | `requirements.txt` with `>=` ranges and no hashes |
| Go | `go.sum` | `go mod verify`; `-mod=readonly` is default | Running `go get` in CI |
| Rust | `Cargo.lock` | `cargo build --locked` | Not committing `Cargo.lock` for libraries (fine for libs, required for binaries) |
| Ruby | `Gemfile.lock` | `bundle install --deployment` or `bundle config set frozen true` | |
| PHP | `composer.lock` | `composer install` (uses lock) | `composer update` in CI |
| Java/Gradle | none by default | Gradle dependency locking (`dependencyLocking { lockAllConfigurations() }` + `--write-locks`) or Maven `versions` plugin with exact versions; Maven does not lock transitives without a plugin | Version ranges in `pom.xml` |
| .NET | `packages.lock.json` | `<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>` + `dotnet restore --locked-mode` | Not enabled by default |
| Dart/Flutter | `pubspec.lock` | `dart pub get --enforce-lockfile` | |
| Swift | `Package.resolved` | `swift package resolve` with the file committed | |

Verify the lockfile in CI: a `git diff --exit-code package-lock.json`
after install catches drift. Review lockfile diffs in PRs: a lockfile
change that adds a package nobody added to the manifest is a question.

Integrity hashes in lockfiles (`integrity` in npm, `--hash` in pip,
`go.sum`) make a tampered registry response fail the install. They only
help if the lock is honored.

## 3. Audit commands and triage per ecosystem

```bash
# JavaScript
npm audit --audit-level=high                 # exit non-zero at high+; `npm audit --json` for tooling
npm audit --omit=dev                         # production deps only (dev tooling vulns rarely matter at runtime)
pnpm audit --prod --audit-level high
yarn npm audit --severity high               # yarn 2+;  yarn audit (v1)
npx better-npm-audit audit                   # allows justified exclusions in a file

# Python
pip-audit -r requirements.txt                # or pip-audit (current env), --fix to attempt upgrades
pip-audit --strict --desc
uv pip audit / poetry audit (plugins)        # if using those managers
safety check                                 # alternative, commercial DB

# Go
govulncheck ./...                            # call-graph aware: reports only vulns in code you actually call
govulncheck -mode=binary ./bin/app           # on a built binary

# Rust
cargo audit                                  # RustSec advisory DB
cargo deny check advisories licenses bans    # policy file deny.toml; also bans duplicate/forbidden crates

# Ruby
bundle exec bundler-audit check --update
brakeman -q                                  # Rails SAST, includes some dependency checks

# PHP
composer audit
composer audit --locked --format=json

# Java / JVM
mvn org.owasp:dependency-check-maven:check   # OWASP Dependency-Check; needs an NVD API key for speed
./gradlew dependencyCheckAnalyze
snyk test / trivy fs .                       # alternatives with better Java coverage

# .NET
dotnet list package --vulnerable --include-transitive
dotnet list package --deprecated

# Multi-ecosystem
osv-scanner -r .                             # Google OSV; reads most lockfiles; also SBOMs and container images
osv-scanner --lockfile=package-lock.json --lockfile=requirements.txt
trivy fs --scanners vuln,secret,misconfig .  # lockfiles + IaC + secrets in one pass
trivy image registry/app:tag                 # OS packages + app deps in a container image
grype dir:.                                  # Anchore; pairs with syft for SBOMs
```

Run the production-only variant to prioritize, then the full one. Put the
audit in CI with a severity threshold, and make it fail the build only
after you have cleared the backlog, otherwise it is ignored on day two.

## 4. Reading an advisory: is it reachable?

An advisory says package `X` version `< 4.17.21` has a prototype pollution
in `_.merge`. Before upgrading in a panic or ignoring in a hurry:

1. **Is it a production dependency?** `npm ls X`, `pip show X`, `go mod why
   X`, `cargo tree -i X`, `bundle why X`. A vulnerability in a test
   runner's transitive dependency does not ship to users.
2. **Is the vulnerable function used, with untrusted input?** The advisory
   names the function and the condition. `rg "_.merge\(|merge\(" src/` and
   check what feeds it. `govulncheck` does this analysis automatically for
   Go; for others it is manual or paid (Snyk reachability, Semgrep Supply
   Chain).
3. **Is there a fixed version, and does the upgrade break you?** Run tests
   after `npm update X` / `pip install -U X`. For a transitive, use
   `overrides` (npm), `pnpm.overrides`, `resolutions` (yarn), `[patch]`
   (cargo), `replace` (go.mod), `constraints` in pip-tools, or bump the
   direct dependency that pulls it in.
4. **No fixed version?** Options: pin and document the acceptance with an
   expiry date, replace the package, vendor and patch (`patch-package`,
   `cargo patch`, a fork), or add a compensating control (validate input
   before it reaches the function).
5. **Record the decision.** Audit tools support ignore files with reasons
   and expiry (`.nsprc`/`better-npm-audit` exceptions, `pip-audit
   --ignore-vuln`, `cargo-deny` `ignore` with reason, `osv-scanner.toml`
   `IgnoredVulns` with `reason` and `ignoreUntil`, `.trivyignore` with
   expiry comments). An ignore without a reason and date is a time bomb.

Severity scores (CVSS) describe the vulnerability in the abstract, not in
your deployment. A CVSS 9.8 in an unused code path is lower priority than
a 6.5 in your request handler. Say that explicitly in the PR so the team
learns to think this way.

## 5. Dependabot and Renovate configurations

Both open PRs for updates and security fixes. Renovate is more
configurable (grouping, schedules, automerge rules, lockfile maintenance);
Dependabot is built into GitHub and simpler. The configuration that makes
either sustainable: group minor/patch updates, schedule them, and automerge
only what tests cover.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 10
    groups:
      minor-and-patch:
        applies-to: version-updates
        update-types: [minor, patch]
      security:
        applies-to: security-updates
    ignore:
      - dependency-name: "some-pkg-pinned-on-purpose"
        versions: [">=3"]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: docker
    directory: /
    schedule: { interval: weekly }
```

```json
// renovate.json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":pinAllExceptPeerDependencies", "helpers:pinGitHubActionDigests"],
  "schedule": ["before 6am on monday"],
  "lockFileMaintenance": { "enabled": true, "schedule": ["before 6am on the first day of the month"] },
  "vulnerabilityAlerts": { "enabled": true, "labels": ["security"], "schedule": ["at any time"] },
  "osvVulnerabilityAlerts": true,
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"], "matchCurrentVersion": "!/^0/", "groupName": "all non-major", "automerge": true, "minimumReleaseAge": "3 days" },
    { "matchUpdateTypes": ["major"], "automerge": false },
    { "matchDepTypes": ["devDependencies"], "automerge": true, "minimumReleaseAge": "3 days" },
    { "matchManagers": ["github-actions"], "pinDigests": true }
  ]
}
```

`minimumReleaseAge` (Renovate) / a cooldown (Dependabot `cooldown`) of a
few days is a cheap defense against malicious releases: most are
detected and yanked within 24-72 hours. Automerge only with a real test
suite; a green CI on an untested codebase means nothing.

## 6. Pinning GitHub Actions and other CI dependencies

`uses: some-org/action@v3` resolves a *mutable tag*. If the maintainer's
account is compromised, the tag moves to malicious code and every workflow
using it runs that code with your secrets. This has happened to popular
actions. Pin to the commit SHA and let Renovate/Dependabot update it:

```yaml
# WRONG
- uses: actions/checkout@v4
- uses: some-org/deploy-action@main

# RIGHT: full SHA with the version as a comment so humans can read it
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

Also in workflows:

- `permissions:` at the top set to `contents: read` and widen per job.
- No `pull_request_target` with a checkout of `github.event.pull_request.head.sha`
  (see `secrets.md` §6).
- Untrusted input in `run:` via `${{ github.event.issue.title }}` is script
  injection; pass through `env:` and quote.
- `zizmor .github/workflows/` and `actionlint` catch these.
- Docker base images: pin by digest (`FROM node:22-alpine@sha256:...`) and
  let the bot bump it; `latest` is unreproducible.
- Build tool plugins (Gradle, Maven, Terraform providers, Helm charts):
  exact versions and checksums (`.terraform.lock.hcl` committed; Helm
  `Chart.lock`).
- `curl | sh` installers in CI: download, verify the checksum/signature,
  then run. Or use the ecosystem's package manager.

## 7. Install scripts and the postinstall problem

npm runs `preinstall`/`install`/`postinstall` scripts from any dependency
with your user's permissions and environment, which is how most npm
malware works (steal `~/.npmrc`, env vars, SSH keys). Python `setup.py`
runs arbitrary code on legacy installs; wheels do not. Ruby gems can run
extensions builds; Cargo `build.rs` runs on build.

```ini
# .npmrc (project): disable scripts by default; allow specific packages that need them
ignore-scripts=true
```

Then run the few that genuinely need it explicitly (`npm rebuild
esbuild`, or `pnpm` with `onlyBuiltDependencies` in `pnpm-workspace.yaml`,
which is the cleanest model: an allowlist of packages permitted to run
build scripts). Bun does not run lifecycle scripts for untrusted
dependencies by default (`trustedDependencies` allowlist). Check what a
package would run: `npm pkg get scripts --workspace=false` inside
`node_modules/<pkg>`, or `can-i-ignore-scripts`.

Python: prefer wheels (`pip install --only-binary=:all:`) so no
`setup.py` executes; use `uv` or `pip` with hash checking.

Developer machines matter as much as CI: `npm install` on a laptop with
cloud credentials in `~/.aws` is the common exfiltration path. Consider
running installs in a container or with a tool like `npq`/`socket` CLI
that checks packages before install.

## 8. Typosquatting, dependency confusion, and private registries

**Typosquatting**: `reqeusts`, `python3-dateutil`, `lodahs`. Defenses: copy
names from the registry page, not from memory; use `npm view <name>` /
`pip index versions <name>` to check age and downloads before adding; tools
like Socket, `npq`, or GitHub's dependency review action flag new, low-
download, or newly-maintained packages in PRs.

**Dependency confusion**: your internal `acme-billing` package is
installed from an internal registry, but the resolver also checks the
public one and takes the higher version. Defenses:

- **Scope everything internal** (`@acme/billing`) and bind the scope to the
  internal registry: `.npmrc` → `@acme:registry=https://npm.internal.acme/`.
  Register the scope on the public registry too (an empty org) so no one
  else can.
- **pip**: never use `--extra-index-url` for the private index (it merges
  with PyPI and picks the highest version). Use `--index-url` pointing to a
  proxy (Artifactory, Nexus, devpi, AWS CodeArtifact) that serves both
  private packages and a curated mirror, or reserve your internal names on
  PyPI.
- **Go**: `GOPRIVATE=git.internal.acme/*` so the public proxy and checksum
  DB are not consulted for those paths; module paths include your domain,
  which is a built-in defense.
- **Maven/Gradle**: repository content filtering
  (`repositories { maven { url ...; content { includeGroup "com.acme" } } }`)
  so each repo serves only its groups.
- **NuGet**: package source mapping in `nuget.config`.
- **Rust**: private registries via `cargo` `[registries]` and `registry = `
  per dependency; crates.io name reservations.

A private registry/proxy also gives you: a cache (builds survive registry
outages), a quarantine window for new versions, a blocklist, and an audit
log of what was downloaded.

## 9. Provenance, signatures, SLSA, and SBOMs

**Provenance** is a signed statement of how an artifact was built (source
repo, commit, builder). npm provenance (`npm publish --provenance` from
GitHub Actions/GitLab CI, shown as a badge on the package page and
verifiable with `npm audit signatures`), PyPI Trusted Publishers (OIDC from
CI; attestations visible on the project page), Sigstore/cosign for
container images and binaries (`cosign verify --certificate-identity ...
--certificate-oidc-issuer ...`), Go's checksum database (`sum.golang.org`,
on by default). Prefer dependencies that publish provenance; verify where
tooling exists.

**SLSA** levels, in practice: L1 = you have a documented build process and
produce provenance; L2 = the build runs on a hosted platform and the
provenance is signed; L3 = the build is isolated and the provenance cannot
be forged by the project's own maintainers. For your own artifacts: build
in CI (not laptops), generate provenance with the platform's attestation
action (`actions/attest-build-provenance`), sign images with cosign
keyless, and verify in deploy.

**SBOMs** (CycloneDX or SPDX): a list of what is in your artifact. Generate
with `syft`, `cdxgen`, `trivy sbom`, `npm sbom`, `cargo cyclonedx`; feed to
`grype`/`osv-scanner --sbom` for continuous monitoring, and keep them with
the release. Increasingly required by customers and regulation. An SBOM is
only useful if someone scans it after release, when new advisories appear
for versions you already shipped.

## 10. Choosing a dependency

Before adding one, in rough order of signal:

- Does the standard library or an existing dependency already do this?
  Every dependency is a permanent maintenance and security commitment.
- Maintenance: last release, response to issues, number of maintainers
  (one maintainer is a bus-factor and account-compromise risk), whether
  security advisories were handled promptly.
- Size of the transitive tree (`npm view <pkg> dependencies`, `npx
  howfat`, `cargo tree`). Prefer fewer transitives.
- Install scripts? Native builds? Network access at install?
- Provenance published? 2FA required for maintainers (npm shows this)?
- License compatibility (`cargo deny`, `license-checker`, FOSSA).
- For security-critical functions (crypto, auth, sanitization): is it the
  one the ecosystem's security community recommends, with audits? Do not
  pick the novel one.

Record the reasoning in the PR that adds it. Future you will want it.

## 11. When a dependency is compromised

News breaks that `popular-pkg@1.2.3` contained malware (or your scanner
flags it).

1. **Determine exposure**: `npm ls popular-pkg` (and in lockfile history:
   `git log -p package-lock.json | rg popular-pkg`), across all repos and
   images. Did any build/install run during the window? CI logs and image
   digests answer this.
2. **If installed anywhere**: treat every secret available to that
   environment as compromised. Install-time malware steals env vars,
   `~/.npmrc`, `~/.aws`, SSH keys, and CI secrets. Rotate per
   `secrets.md`. Developer laptops that ran the install count.
3. **Pin to a known-good version** (overrides/resolutions) or remove; the
   registry usually yanks the bad version, but your lockfile may still
   reference it or a cached copy.
4. **Check for persistence** in CI (modified workflows, new secrets usage),
   in deployed images, and in any artifact built during the window; rebuild
   from clean.
5. **Write it up** and add the controls that would have caught it:
   `minimumReleaseAge`, `ignore-scripts`, scoped registries, SHA pinning.

## 12. Checklist

- Lockfile committed for every manifest; CI and Docker install with the
  frozen/locked flag; lockfile drift fails CI.
- Audit tool for each ecosystem runs in CI with a threshold; ignores have
  reasons and expiry dates.
- Dependabot or Renovate configured with grouping, schedule, cooldown,
  and security alerts at any time.
- All GitHub Actions and base images pinned by SHA/digest; workflow
  `permissions` minimal; no `pull_request_target` footguns; `zizmor` clean.
- Install scripts disabled by default (`ignore-scripts`,
  `onlyBuiltDependencies`, wheels only) with an explicit allowlist.
- Internal packages scoped and bound to the internal registry; public
  names reserved; no `--extra-index-url`.
- SBOM generated per release and scanned on a schedule; provenance
  verified where available; own artifacts signed.
- New dependencies reviewed for maintenance, size, scripts, and
  provenance before merge; reasoning recorded.

Cross-references: CI secret handling in `secrets.md`; container image
scanning and base image choice in `cloud-and-infra.md`; SCA in the testing
workflow in `security-testing.md`.
