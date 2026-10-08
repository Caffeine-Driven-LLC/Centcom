# Secrets management

API keys, database passwords, signing keys, OAuth client secrets, webhook
secrets, TLS private keys, cloud credentials. Where they must never be,
where they should live, how they reach the process, how to rotate them,
how to find the ones already leaked, and exactly what to do in the first
hour after a leak. Also the `.env` and CI/CD patterns that most teams get
slightly wrong.

## Contents

1. The rules and the reasoning
2. Where secrets leak from in practice
3. `.env` done right
4. Loading secrets in the application
5. Cloud secret managers and runtime injection
6. CI/CD secrets
7. Secrets in containers and images
8. Rotation: a playbook per secret type
9. Scanning: gitleaks, trufflehog, and the bundled script
10. The first hour after a leak
11. Purging history, and why it is not the fix
12. Secret hygiene checklist for a repo

## 1. The rules and the reasoning

- **Never in source control**, including private repos, including "just
  the dev key". Private repos become public (acquisitions, misclicks,
  forks), get cloned to laptops, and are readable by every contractor who
  ever had access. The history is forever.
- **Never in client-side code** (JS bundles, mobile binaries, config
  shipped to the browser). Anything the client has, the user has. If a
  "secret" must be in the client, it is not a secret; it is an identifier,
  and the real authorization must happen server-side (Firebase config,
  Stripe publishable key, Maps API key restricted by referrer are
  identifiers; a Stripe secret key or a service-account JSON is not).
- **Never in logs, error messages, crash reports, or analytics.** Those
  systems have wider access than production and longer retention. Common
  leak: logging the full config object, the connection string in a DB
  error, the `Authorization` header in a request log, the environment in
  a crash reporter.
- **Never in URLs.** Query strings land in access logs, browser history,
  proxy logs, Referer headers, and screenshots. Signed URLs are the
  exception by design, and they expire in minutes.
- **Never in Docker image layers**, even if deleted in a later layer (the
  layer is still in the image).
- **Never in commit messages, PR descriptions, issue trackers, chat, or
  wikis.** These are searchable and exported.
- **One secret per purpose per environment.** Shared secrets cannot be
  rotated independently or attributed when they leak. The prod database
  password is not the staging one; the CI deploy key is not a developer's
  personal key.
- **Least privilege per secret.** A read-only database user for the
  reporting job; a scoped API token (GitHub fine-grained PAT, Stripe
  restricted key, AWS role with a narrow policy) instead of an owner
  token.
- **Rotatable without a code change.** If rotating requires editing a
  file and redeploying, it will not happen under pressure. Secrets come
  from the environment or a secret manager at runtime.
- **Short-lived where possible.** Cloud workload identity (IAM roles for
  service accounts, GCP service account impersonation, Azure managed
  identity, OIDC federation from CI) hands out credentials that expire in
  an hour and never exist as a static string anyone can copy. Prefer this
  over any long-lived key.

## 2. Where secrets leak from in practice

In rough order of frequency in real incidents:

1. Committed `.env`, `config.yml`, `settings.py`, `application.properties`,
   `terraform.tfvars`, `docker-compose.yml`, `*.pem`, `id_rsa`,
   `serviceAccount.json`, `.npmrc` with `_authToken`, `.pypirc`,
   `.netrc`, Jupyter notebooks with inline keys.
2. Test fixtures and example code with a real key "temporarily".
3. CI logs printing env or `curl -v` with the auth header.
4. Frontend bundles (`NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*` prefixes mean
   "ship to the browser"; a server secret with that prefix is published).
5. Mobile apps: strings in the APK/IPA (see `mobile-security.md`).
6. Docker images pushed to a public registry with `COPY . .` including
   `.env`, or `ARG`/`ENV` with secrets.
7. Error tracking (Sentry, Datadog) receiving request headers or local
   variables.
8. Slack/Teams/Jira/Notion pastes.
9. Public S3 buckets with config backups.
10. Shell history and `~/.bash_history`/`.zsh_history` on shared machines.

Anything in this list is a place to look during an audit (§9).

## 3. `.env` done right

The pattern:

```
repo/
├── .env.example        # committed: every variable name, placeholder values, a comment per var
├── .env                # NOT committed: local dev values; in .gitignore
├── .env.test           # committed only if it contains no real secrets (test DB on localhost is fine)
└── .gitignore          # contains: .env, .env.*, !.env.example, !.env.test (only if .env.test is committed)
```

```bash
# .env.example
# Copy to .env and fill in. Never commit .env.
DATABASE_URL=postgres://app:CHANGE_ME@localhost:5432/app_dev
SESSION_SECRET=CHANGE_ME_generate_with_openssl_rand_hex_32
STRIPE_SECRET_KEY=sk_test_CHANGE_ME          # test-mode key only in dev
STRIPE_WEBHOOK_SECRET=whsec_CHANGE_ME
SMTP_PASSWORD=
```

```gitignore
.env
.env.*
!.env.example
!.env.test        # only when it holds no real secrets (see tree above)
*.pem
*.key
*.p12
*.jks
serviceAccount*.json
.npmrc
.pypirc
```

Rules:

- `.env` is a **local development** convenience. Production does not read
  a `.env` file from disk; it gets variables from the orchestrator or a
  secret manager (§5). Libraries like `dotenv` should be loaded only when
  `NODE_ENV !== 'production'` or not at all in prod images.
- Dev secrets are still secrets if they reach shared services (a real
  Stripe test key, a shared dev database). Use per-developer or local-only
  resources where possible.
- Validate at startup that every required variable is present and
  non-placeholder; fail fast with the variable *name* (never the value).
- Framework public prefixes (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`,
  `EXPO_PUBLIC_`, `NUXT_PUBLIC_`) are a one-way door to the browser. Audit
  every variable with such a prefix.
- Do not `git add -A` without looking. Install `gitleaks` as a pre-commit
  hook (§9) so a `.env` cannot be committed by accident.

Check history even if `.env` is ignored now: `git log --all --
.env` and `git log --all -p -S 'sk_live_'` (or run gitleaks over history).

## 4. Loading secrets in the application

```ts
// Node: one typed config module, validated at boot, never logged wholesale
import { z } from 'zod';
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
});
const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);   // names only, no values
  process.exit(1);
}
export const env = parsed.data;
// Never: console.log(env) / logger.info({ env }) / res.json({ config: env })
```

```python
# Python: pydantic-settings; secrets as SecretStr so repr() redacts them
from pydantic import SecretStr, PostgresDsn
from pydantic_settings import BaseSettings
class Settings(BaseSettings):
    database_url: PostgresDsn
    session_secret: SecretStr
    stripe_secret_key: SecretStr
    model_config = {"env_file": ".env" if os.getenv("ENV") != "production" else None}
settings = Settings()
# settings.stripe_secret_key.get_secret_value() only at the point of use
```

```go
// Go: read env once into a struct; implement String() on it to redact
type Config struct { DatabaseURL string; SessionSecret string }
func (c Config) String() string { return "Config{DatabaseURL: <redacted>, SessionSecret: <redacted>}" }
```

Patterns that reduce accidental logging: a `Secret` wrapper type whose
`toString`/`repr`/`JSON` output is `[REDACTED]`; a logging redaction layer
keyed on field names (`password`, `token`, `secret`, `authorization`,
`cookie`, `api_key`) and on value patterns (see `logging-privacy.md`);
error handlers that strip connection strings.

Rails: `config/credentials.yml.enc` + `RAILS_MASTER_KEY` from the
environment (never commit `config/master.key`). Django: `SECRET_KEY` from
env; `DEBUG=False` in prod (debug pages print settings). Spring: `${ENV_VAR}`
placeholders, Spring Cloud Vault/AWS Secrets Manager integration; never
`application.properties` with real values committed. Laravel: `.env` not
committed, `APP_KEY` generated per environment, `APP_DEBUG=false`.

## 5. Cloud secret managers and runtime injection

| Provider | Service | How the app gets it |
|---|---|---|
| AWS | Secrets Manager (rotation built in) / SSM Parameter Store (cheaper, SecureString) | ECS/EKS task role → SDK `GetSecretValue` at boot; or ECS `secrets:` block / EKS Secrets Store CSI driver injecting into env |
| GCP | Secret Manager | Cloud Run `--set-secrets ENV=secret:version`; GKE Secret Manager add-on; SDK with workload identity |
| Azure | Key Vault | App Service Key Vault references (`@Microsoft.KeyVault(...)`); AKS CSI driver; managed identity + SDK |
| Any | HashiCorp Vault / OpenBao | Vault Agent sidecar/template, Kubernetes auth method, dynamic DB credentials |
| Kubernetes | `Secret` objects | Base64, not encrypted by default: enable encryption at rest, restrict RBAC, prefer External Secrets Operator syncing from a real manager |
| Small deployments | Doppler, Infisical, 1Password Secrets Automation, SOPS-encrypted files with age/KMS | CLI injects env at start (`doppler run -- node server.js`) |

Design points: the application authenticates to the secret manager with
its *workload identity* (role, service account), not with another static
secret (otherwise you have moved the problem one step). Fetch at boot and
cache in memory; re-fetch on a schedule or on a rotation signal so
rotation does not require a restart. Grant each workload access to only
its secrets (resource-level IAM). Audit log who read what.

Workload identity federation for CI (GitHub Actions OIDC → AWS/GCP/Azure
role) removes the long-lived cloud key from CI entirely:

```yaml
# .github/workflows/deploy.yml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@<sha>   # pin by SHA, see dependencies-supply-chain.md
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-deploy
      aws-region: us-east-1
```

The role's trust policy restricts `sub` to `repo:org/repo:ref:refs/heads/main`
so a fork or another branch cannot assume it.

## 6. CI/CD secrets

- Store in the CI's secret store (GitHub encrypted secrets with
  **environments** and required reviewers for production; GitLab protected
  variables; Jenkins credentials plugin). Never in the workflow file.
- Workflows triggered by `pull_request` from forks do not get secrets
  (good). `pull_request_target` and `workflow_run` *do*, and run in the
  base repo's context: checking out the PR head and running its code
  under `pull_request_target` hands your secrets to anyone who opens a PR.
  `zizmor` and `actionlint` flag this.
- Mask secrets in logs (`::add-mask::` for derived values in Actions). Do
  not `set -x` in scripts that use secrets; do not `curl -v`; do not
  `env`/`printenv`/`cat .env` in a step.
- Scope tokens: `GITHUB_TOKEN` with `permissions:` set to the minimum per
  job; deploy keys read-only unless the job pushes.
- Secrets exposed to a job are exposed to every action that job runs,
  including third-party actions. Pin actions by SHA and read what they do
  with `env`.
- Build artifacts and caches: do not cache directories containing
  `.npmrc`/`.netrc`; do not upload `.env` as an artifact.
- Rotate CI secrets when a maintainer leaves and when a third-party action
  you used is compromised (this has happened to widely used actions).

## 7. Secrets in containers and images

```dockerfile
# WRONG: baked into the image forever, visible with `docker history` / `dive`
ENV STRIPE_SECRET_KEY=sk_live_...
ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc && npm ci && rm .npmrc   # still in the layer

# RIGHT: BuildKit secret mounts exist only during the RUN step
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
# docker build --secret id=npmrc,src=$HOME/.npmrc .

# Runtime: inject via the orchestrator (docker run -e / compose `secrets:` / K8s secret env or volume)
```

Also: `.dockerignore` with `.env`, `*.pem`, `.git`; multi-stage builds so
the final image has no build tooling or build-time files; scan images
(`trivy image --scanners secret`); never `COPY . .` without a
`.dockerignore`.

## 8. Rotation: a playbook per secret type

Rotation should be a routine, scripted operation. The general shape is
**dual-run**: add the new secret alongside the old, switch consumers, then
revoke the old. Secrets that cannot be dual-run need a maintenance window.

| Secret | Dual-run approach | Gotchas |
|---|---|---|
| Database password | Create a second DB user with the same grants (or use IAM DB auth); update the app; drop the old user | Connection pools hold old connections; drain or restart. ORMs with hard-coded users in migrations |
| API key to a third party (Stripe, Twilio, SendGrid) | Most providers allow 2 active keys: create new, deploy, delete old | Webhook signing secrets have their own rotation; verify with both during the overlap |
| Session signing key / cookie secret | Key list: new key signs, old keys still verify, for one session lifetime; then drop old | Frameworks support this (Rails `secret_key_base` rotation API, Express `cookie-session` `keys: [new, old]`, Django `SECRET_KEY_FALLBACKS`). Rotating without a key list logs everyone out |
| JWT signing key | Publish new key in JWKS with a new `kid`; sign with new; keep old in JWKS until all tokens expire | Verifiers must cache JWKS with a TTL and refetch on unknown `kid` |
| OAuth client secret | Providers allow multiple secrets (Google, Microsoft, GitHub Apps); add, deploy, remove | Some providers (older setups) have one secret; brief outage |
| Webhook secret you issue to customers | Allow two active secrets per endpoint; notify customers; expire the old after a grace period | Document it in your API docs before you need it |
| TLS private key | Issue new cert with new key; deploy; revoke old (ACME makes this routine) | Pinning on mobile clients (see `mobile-security.md`) |
| Cloud access keys (AWS IAM user keys) | Create second key pair; deploy; deactivate (not delete) old; delete after a day | Better: eliminate static keys in favor of roles. `aws iam list-access-keys` + `get-access-key-last-used` to find stale ones |
| SSH deploy keys | Add new public key; update CI; remove old | Check `authorized_keys` on every host |
| Encryption keys for data at rest | Envelope encryption: rotate the KEK in KMS (automatic), re-wrap DEKs; re-encrypting data is rarely required | See `cryptography.md` |
| Internal service-to-service tokens | Mint from identity (mTLS, SPIFFE, workload identity) so they rotate themselves | |

Schedule: rotate everything static at least yearly (quarterly for high-
value), immediately on suspected exposure, and on team member departure
for anything they could have copied. Track owner, last rotated, and
rotation procedure per secret in an inventory (a spreadsheet beats
nothing).

## 9. Scanning

**gitleaks** (fast, good defaults, pre-commit friendly):

```bash
# Scan working tree and full history
gitleaks detect --source . --verbose --redact
# Only staged changes (pre-commit)
gitleaks protect --staged --redact
# Baseline known/accepted findings so CI only fails on new ones
gitleaks detect --report-path gitleaks-report.json
gitleaks detect --baseline-path gitleaks-report.json
```

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.x.y
    hooks: [{ id: gitleaks }]
```

```toml
# .gitleaks.toml: extend defaults, add org-specific patterns, allowlist fixtures
[extend]
useDefault = true
[[rules]]
id = "acme-internal-token"
description = "Acme internal token"
regex = '''acme_[a-z]{3}_[A-Za-z0-9]{40}'''
[allowlist]
paths = ['''tests/fixtures/fake_keys\.json''']
regexes = ['''EXAMPLE_KEY_DO_NOT_USE''']
```

**trufflehog** (verifies many credential types live against the provider,
which cuts false positives dramatically):

```bash
trufflehog git file://. --only-verified
trufflehog filesystem ./build --only-verified          # scan built artifacts/bundles too
trufflehog github --org=your-org --only-verified       # across repos (needs a token)
trufflehog docker --image=registry/app:tag
```

**Others**: `detect-secrets` (Yelp; baseline-oriented), GitHub secret
scanning + push protection (turn it on; it is free for public repos and
part of Advanced Security for private), GitLab secret detection, `semgrep
--config p/secrets`, `trivy fs --scanners secret .`.

**The bundled script** `scripts/secret_patterns.py <dir>` is a stdlib-only
first pass for environments where none of the above is installed. It
prints `file:line` with the secret redacted and exits non-zero on hits. It
has a fraction of gitleaks' rules and no verification; use it to triage,
then install a real tool.

What to scan: the repo and its full history, built bundles (`dist/`,
`.next/`, APK/IPA), container images, CI logs (export a sample), and
the places in §2.

Triage: `AKIA...` plus a 40-char secret is almost always real; a high-
entropy string in a test fixture named `fake_` probably is not; a JWT in a
test file is a finding only if it was ever valid against a real system.
When in doubt, treat as real and rotate; rotation is cheap.

## 10. The first hour after a leak

A secret was pushed, pasted, or found by a scanner. Order matters. Do not
start with `git filter-repo`.

**Minute 0-5: Contain. Revoke or rotate the credential now.** Assume it has
been used; public GitHub commits are scraped by bots within seconds and
AWS keys in public repos are used for crypto mining within minutes. Use the
provider console or CLI: AWS `aws iam update-access-key --status Inactive`
then delete; GitHub token → revoke; Stripe → roll key; database → `ALTER
USER ... PASSWORD` or drop user; OAuth client secret → regenerate; signing
key → rotate with key list if available, otherwise accept the logout.
If rotating will break production, break production: a few minutes of
downtime is cheaper than a breach, and dual-run (§8) is the thing you
build so this is not the trade-off next time.

**Minute 5-20: Assess what the credential could do and whether it was
used.** Pull the audit logs for that credential: AWS CloudTrail filtered
by access key id (`aws cloudtrail lookup-events --lookup-attributes
AttributeKey=AccessKeyId,AttributeValue=AKIA...`), GCP audit logs by
service account, GitHub audit log by token, Stripe request logs, database
connection logs. Look for activity from unfamiliar IPs or after the leak
time. Note what the credential was authorized to reach: that is the blast
radius even if you see no use yet (logs lag).

**Minute 20-40: Look for persistence and lateral movement** if any use was
found: new IAM users/keys/roles, changed policies, new SSH keys, new
OAuth apps authorized, new webhooks, new repository collaborators, new
deploy keys, modified CI workflows, changed DNS. Attackers who get a key
immediately create a second way in.

**Minute 40-60: Communicate and record.** Tell the team and whoever owns
security/compliance, with: what leaked, when, where, what it could access,
whether use was observed, what has been rotated, what remains. If the
credential protected personal data and use is confirmed or cannot be ruled
out, this may be a notifiable breach under GDPR (72 hours), HIPAA, state
laws, or contracts; say so and let the compliance owner decide. Open an
incident doc with a timeline.

**Then**: fix the cause (why was it in the repo? add gitleaks pre-commit
and CI; move to a secret manager; remove the need for the static key),
scan the rest of the repo and history for siblings (where one key was
committed there are usually more), and finally deal with history (§11).

Do not: wait to see if it gets used; rotate only the one key you noticed
(scan first, rotate all found); assume a private repo means nobody saw it;
delete the commit and consider it done.

## 11. Purging history, and why it is not the fix

Rewriting git history (`git filter-repo --replace-text`, BFG Repo-Cleaner)
removes the secret from *your* clone's history. It does not remove it from
forks, from clones on laptops and CI runners, from GitHub's cached views of
the old commit SHAs (GitHub keeps dangling commits reachable by SHA until
support purges them), from scrapers that already copied it, or from the
package you published that contained it. Treat purging as hygiene so the
secret does not keep tripping scanners and does not get copied further,
after the credential is already dead.

```bash
# After rotation. Everyone must re-clone afterwards; force-push rewrites all SHAs.
pip install git-filter-repo
echo 'sk_live_REDACTEDVALUE==>REMOVED_SECRET' > /tmp/replacements.txt
git filter-repo --replace-text /tmp/replacements.txt
git push --force --all && git push --force --tags
# Then: contact GitHub support to purge cached commits; ask fork owners to re-clone; invalidate CI caches.
```

For a secret that was never pushed (caught by the pre-commit hook or
noticed before `git push`), `git reset`/amend is enough and no rotation
is needed, as long as you are sure no remote has it.

## 12. Secret hygiene checklist for a repo

- `.gitignore` covers `.env*` (except `.env.example`), keys, certs,
  service account files, `.npmrc`/`.pypirc`.
- `.env.example` documents every variable with placeholders.
- gitleaks (or equivalent) runs in pre-commit and CI; history has been
  scanned once and findings rotated.
- Production reads secrets from the orchestrator or a secret manager;
  `dotenv` is dev-only.
- Startup validates presence of required secrets and never prints values.
- A logging redaction layer exists for `authorization`, `cookie`,
  `password`, `token`, `secret`, `key` fields.
- No `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_`/`EXPO_PUBLIC_` variable holds a
  server secret.
- CI uses OIDC federation or environment-scoped secrets; no
  `pull_request_target` checking out PR code; actions pinned by SHA.
- Dockerfiles use secret mounts for build-time credentials; `.dockerignore`
  excludes `.env` and `.git`.
- Every secret has an owner, a scope, a rotation procedure, and a last-
  rotated date somewhere findable.

Cross-references: key management and envelope encryption in
`cryptography.md`; CI action pinning and dependency confusion in
`dependencies-supply-chain.md`; IAM least privilege in
`cloud-and-infra.md`; redaction in `logging-privacy.md`; secrets in mobile
binaries in `mobile-security.md`.
