# Configuration and environments

Twelve-factor config without the dogma, a typed config object validated
once at boot in each stack, how secrets reach the process (storage and
rotation are `security`'s), feature flags that do not become permanent
branches, environment parity, and the "works locally, breaks in prod"
checklist.

## Contents

1. Principles
2. What is config, what is code, what is data
3. Typed config loaded once, validated at boot (per stack)
4. Secrets handoff
5. Environments: how many, what differs
6. Local development setup
7. Feature flags
8. Runtime reconfiguration
9. Containers and orchestrators
10. The "works locally, not in prod" checklist
11. Anti-patterns with fixes

## 1. Principles

- **Config comes from the environment, code does not branch on
  environment names.** `if (env === "production")` scattered through the
  code is config by another name, and it means staging never exercises
  the production path. Branch on specific settings (`config.emailDriver
  === "ses"`), set by environment.
- **One typed config object, built once at startup, passed or imported
  everywhere.** `process.env.X` / `os.environ["X"]` / `os.Getenv` appear in
  exactly one file. Reasons: a missing variable fails at boot with a
  message instead of at 2am inside a request; types are parsed once (`"8080"`
  → `8080`, `"true"` → `true`, a URL → a parsed URL); tests construct a
  config object directly; the set of knobs is visible in one place.
- **Fail fast, loudly, on invalid config.** The process should not start
  if a required value is missing, malformed, or inconsistent (live Stripe
  key in a non-production environment; `DATABASE_URL` pointing at
  localhost in production).
- **Defaults only for things that are safe to default.** Port, log level,
  timeouts: yes. Database URL, secret keys, external service URLs: no
  default, or a default that only works in `development` and is rejected
  elsewhere.
- **Secrets never in the repo, never in logs, never in error messages or
  crash dumps.** Including `.env` files, `application.yml`, test fixtures,
  and Docker images.
- **The same artifact runs in every environment.** Build once, configure
  per environment. If you rebuild per environment, you are testing a
  different binary than you deploy.

## 2. What is config, what is code, what is data

| Kind | Examples | Lives in |
|---|---|---|
| Deploy-varying config | DB URL, Redis URL, external API base URLs, credentials, log level, port, concurrency, feature-flag provider key | Environment variables (or a mounted file / secret manager that produces them) |
| Code-level constants | Retry counts, timeouts, pagination limits, bucket sizes | Code (a `constants.ts`/`settings.py` section), occasionally overridable via env for tuning |
| Business configuration | Tax rates, plan limits, shipping zones, email templates | Database (admin-editable), versioned seed files, or a config service; not env vars |
| Feature flags | Rollout toggles, kill switches, experiments | Flag service or database (section 7); env vars only for build-time or boot-time toggles |
| Build-time | Target platform, bundle options, public client config (`NEXT_PUBLIC_*`) | Build config; remember public vars ship to clients |

If a value differs between staging and production, it is config. If it
would require a code review to change, it is code. If a product manager
changes it, it is data.

## 3. Typed config loaded once, validated at boot (per stack)

Node / TypeScript (zod):

```ts
// src/config.ts: the only file that touches process.env
import { z } from "zod";

const Env = z.enum(["development", "test", "staging", "production"]);
const schema = z.object({
  APP_ENV: Env.default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STRIPE_API_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  HTTP_TIMEOUT_MS: z.coerce.number().int().default(5000),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
}).superRefine((c, ctx) => {
  if (c.APP_ENV === "production" && c.STRIPE_API_KEY.startsWith("sk_test_")) ctx.addIssue({ code: "custom", message: "test Stripe key in production", path: ["STRIPE_API_KEY"] });
  if (c.APP_ENV !== "production" && c.STRIPE_API_KEY.startsWith("sk_live_")) ctx.addIssue({ code: "custom", message: "live Stripe key outside production", path: ["STRIPE_API_KEY"] });
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid configuration:\n" + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}
export const config = Object.freeze({
  env: parsed.data.APP_ENV,
  port: parsed.data.PORT,
  logLevel: parsed.data.LOG_LEVEL,
  databaseUrl: parsed.data.DATABASE_URL,
  databasePoolMax: parsed.data.DATABASE_POOL_MAX,
  redisUrl: parsed.data.REDIS_URL,
  sessionSecret: parsed.data.SESSION_SECRET,
  stripe: { apiKey: parsed.data.STRIPE_API_KEY, webhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET },
  httpTimeoutMs: parsed.data.HTTP_TIMEOUT_MS,
  otelEndpoint: parsed.data.OTEL_EXPORTER_OTLP_ENDPOINT,
});
export type Config = typeof config;
```

Load `.env` only in development (`dotenv` guarded by `APP_ENV !==
"production"`, or `node --env-file=.env`); never ship `dotenv` loading
into production images where the orchestrator provides env. `t3-env`,
`envalid`, `znv` are fine wrappers if the repo uses them.

Python: pydantic-settings (see `python.md` section 9) with `SecretStr`
for secrets and `model_validator` for cross-field checks. Django: read
env in `settings.py` once via `django-environ` (`env.db()`, `env.cache()`),
split by environment module only if the repo does.

Go:

```go
type Config struct {
    Env            string        `env:"APP_ENV" envDefault:"development"`
    Addr           string        `env:"ADDR" envDefault:":8080"`
    DatabaseURL    string        `env:"DATABASE_URL,required"`
    DBPoolMax      int32         `env:"DATABASE_POOL_MAX" envDefault:"10"`
    RedisURL       string        `env:"REDIS_URL,required"`
    SessionSecret  string        `env:"SESSION_SECRET,required"`
    HTTPTimeout    time.Duration `env:"HTTP_TIMEOUT" envDefault:"5s"`
    ShutdownGrace  time.Duration `env:"SHUTDOWN_GRACE" envDefault:"25s"`
}

func MustLoad() Config {
    var c Config
    if err := env.Parse(&c); err != nil {                      // github.com/caarlos0/env or kelseyhightower/envconfig
        log.Fatalf("config: %v", err)
    }
    if len(c.SessionSecret) < 32 { log.Fatal("config: SESSION_SECRET must be at least 32 chars") }
    if c.Env == "production" && strings.Contains(c.DatabaseURL, "localhost") { log.Fatal("config: localhost database in production") }
    return c
}
```

Java/Kotlin: `@ConfigurationProperties` records with `@Validated` (see
`java-kotlin.md` section 9); profiles for environment files; env vars
override via relaxed binding. Ruby: `ENV.fetch` in `config/` initializers
or `anyway_config`/`dry-configurable`; credentials for secrets. PHP:
`config/*.php` reading `env()` once; a boot-time validator. Rust:
`figment` or `config` crate merging defaults + file + env into a
`Deserialize` struct, with a `validate()` call in `main`.

Whatever the stack: the config object is immutable after boot, secrets are
wrapped in a type whose `Debug`/`toString`/`repr` redacts, and `Config` is
passed to constructors (or imported from the one module) rather than
re-read from the environment.

## 4. Secrets handoff

This file covers how a secret *reaches* the process; storage, rotation
policy, and leak response are `security/references/`.

Delivery mechanisms, in order of preference:

1. **Platform secret manager injected as env vars or files at start**:
   Kubernetes Secrets (ideally from External Secrets Operator syncing
   Vault/AWS SM/GCP SM), ECS task definition `secrets`, Cloud Run secret
   mounts, Fly/Heroku/Render/Vercel secret env, Lambda env from SM/SSM.
   The app just reads env or a file.
2. **Fetched at boot by the app** from a secret manager via the cloud SDK
   (IAM-authenticated, no bootstrap secret), then placed into the config
   object. Adds a dependency at boot; cache and handle the manager being
   down (fail to start, do not run with defaults).
3. **Sidecar/agent** (Vault Agent, Doppler, Infisical) that renders a file
   or env and can rotate at runtime.
4. **`.env` file**: local development only, gitignored, with a committed
   `.env.example` listing every variable with a placeholder and a comment.

In code: read secrets through the config object only; never log the
config object wholesale (redacting type); never include secrets in error
messages, URLs, or query strings; pass `DATABASE_URL` credentials via the
URL only if the logger redacts URLs (or split user/password into separate
variables). Support rotation without restart where feasible: re-read the
secret file on SIGHUP or a timer, or accept two valid values (old and new)
during a rotation window for things like signing keys.

## 5. Environments: how many, what differs

Typical: `development` (laptop), `test` (CI), `staging`/`preview` (prod-
like, shared or per-branch), `production`. Add more only with a reason.

What *should* differ: credentials, hostnames, scale (replicas, pool
sizes), log level and verbosity, third-party mode (sandbox vs live),
feature flags, data (anonymized or synthetic in non-prod).

What should *not* differ: the artifact, the database engine and major
version, the queue technology, the auth mechanism, TLS termination shape,
the migration path. "Staging uses SQLite and the sync queue adapter" is
how production-only bugs are born. Where a dependency cannot be
reproduced (a payment provider), use its sandbox with the same client
code and the same config shape.

Preview environments per branch (Vercel, Render, Heroku review apps,
ephemeral k8s namespaces) are the strongest parity tool: real deploys of
the real artifact with disposable databases seeded from fixtures.

## 6. Local development setup

A new engineer (or an agent) should go from clone to running service in
three commands. Provide:

- `docker compose up -d` (or `devbox`/`nix`/`mise`) for Postgres, Redis,
  and any brokers, with versions pinned to production's.
- `.env.example` → `.env` copy step with every variable documented; safe
  development defaults; sandbox keys clearly labeled.
- One command to migrate and seed (`make setup`, `bin/setup`, `npm run
  db:setup`).
- One command to run (`make dev`, `npm run dev`, `bin/dev` with a Procfile
  that runs web and worker).
- A health endpoint and a smoke script (`make smoke` that curls two
  endpoints) so "it runs" is verifiable.

Local development should run the real queue adapter against local Redis/
Postgres, not the inline/sync adapter, so job bugs appear locally. Mail
goes to Mailpit/MailHog; object storage to MinIO/LocalStack if the code
paths matter.

## 7. Feature flags

Three kinds, with different lifetimes:

- **Release toggles** (ship dark, enable gradually): live days to weeks;
  remove the flag and the old path after full rollout. Each one is a
  branch in the code with two states to test; after a month they are tech
  debt.
- **Kill switches / ops toggles** (disable an integration, shed a
  feature under load): live indefinitely; few; documented in runbooks;
  default to "on" and tested in the "off" state (`resilience.md`).
- **Permission / entitlement toggles** (plan features, beta access): these
  are business data, not flags; model them as such in the database.

Implementation: LaunchDarkly, Unleash, Flagsmith, GrowthBook, PostHog,
Statsig, OpenFeature as the vendor-neutral SDK layer; or a `feature_flags`
table with name, enabled, percentage, allowlist, cached in-process for
30-60 s. Evaluate flags with a context (user, tenant, environment) in the
application layer, once per request, and pass the decision down; do not
sprinkle `if (flags.isEnabled("x"))` through every layer. Flag evaluation
must be fast and fail safe (provider down → default value, logged).

Hygiene: every flag has an owner, a creation date, and an expected
removal date; a lint or periodic report lists flags older than N days;
removal PRs delete the dead branch, not just flip the default. Test both
states for release toggles; the old state is still production until
rollout completes.

## 8. Runtime reconfiguration

Most config is read at boot; a redeploy applies changes, which is fine for
URLs and credentials. A few things want runtime change: log level (to
debug an incident), feature flags, rate limits, maintenance mode, circuit
breaker forced-open. Provide for these specifically (admin endpoint behind
strong auth, config service poll, SIGHUP reload of a config file) rather
than making all config hot-reloadable, which multiplies failure modes.
Log every runtime change with who and what.

## 9. Containers and orchestrators

- Env vars from the orchestrator (`env:`/`envFrom:` in Kubernetes,
  `environment:`/`secrets:` in ECS, `[env]` in fly.toml); no `.env` inside
  the image; no secrets in `ENV` layers of the Dockerfile (they persist in
  image history and are visible to anyone who pulls it).
- `PORT` from the environment where the platform sets it (Heroku, Cloud
  Run, Render); bind `0.0.0.0`, not `localhost`, inside containers.
- `terminationGracePeriodSeconds` (Kubernetes) / `stopTimeout` (ECS) ≥ your
  shutdown budget (`resilience.md` section 10).
- Resource requests/limits inform pool sizes and worker concurrency; a
  container limited to 512 MB running 20 Celery workers will be OOM-killed.
  Make concurrency a config value.
- Time zone `UTC` everywhere (`TZ=UTC`); locale `C.UTF-8`.
- Read-only root filesystem where possible; write to `/tmp` or a volume.
- Health check paths configured in the orchestrator match the app's
  (`readyz`/`healthz`).
- One process per container generally (web, worker, scheduler as separate
  deployments from the same image with different commands), so they scale
  and restart independently.
- Migrations run as a separate step (init container, release phase, CI
  job) before the new version receives traffic, not on web process start
  (N replicas racing to migrate). Expand/contract migrations so old and new
  code both run during rollout (`database/references/`).

## 10. The "works locally, not in prod" checklist

- A variable set in `.env` but missing from the production environment
  (boot validation catches it).
- `localhost`/`127.0.0.1` hardcoded for a dependency; in containers it is
  the container itself.
- Binding to `localhost` instead of `0.0.0.0`.
- `trust proxy` / forwarded headers not configured, so the app sees HTTP
  and the LB IP; secure cookies and redirects break.
- Different database engine or version; a feature (JSON operator, `RETURNING`,
  case-insensitive collation) exists in one and not the other.
- Sync queue adapter locally, real queue in prod; serialization or timing
  bugs appear only in prod.
- File writes to the local disk that is ephemeral or read-only in
  production; use object storage.
- In-memory state (cache, rate limiter, sessions) assumed shared; prod
  has N replicas.
- Time zone: local machine in local time, prod in UTC.
- Case-sensitive filesystem (Linux) vs insensitive (macOS): an import
  with the wrong case works locally only.
- Memory/CPU limits far below the laptop's; worker concurrency sized for
  the laptop.
- A dependency version pinned loosely so CI/prod resolved a different one;
  commit the lockfile.
- Build-time vs runtime env: `NEXT_PUBLIC_*`/`VITE_*` baked at build; a
  runtime env change does nothing.
- Secrets with special characters mangled by a shell or YAML (`$`, `#`,
  quotes); quote them or use files.
- DNS/egress: production has egress restrictions or a proxy; outbound calls
  that worked locally hang (timeouts make this visible instead of fatal).
- Clock skew on a VM making JWT `nbf`/`exp` or TOTP fail; run NTP.

## 11. Anti-patterns with fixes

- **`process.env.X` / `os.environ` scattered across modules.** Fix: one
  config module.
- **Required config with a silent default** (`process.env.DB_URL ??
  "postgres://localhost/dev"`) that connects production to nothing or to
  the wrong place. Fix: required, validated, no default outside
  development.
- **`if (NODE_ENV === "production")` branching business behavior.** Fix:
  branch on specific settings.
- **Secrets in the repo** (`.env` committed, `application.yml` with keys,
  test fixtures with real tokens). Fix: remove, rotate (`security`), add
  to `.gitignore`, add a secret scanner to CI.
- **Secrets in Dockerfile `ENV` or `ARG`.** Fix: runtime injection.
- **Logging the config object at startup** including secrets. Fix: log
  the non-secret keys only; redacting type.
- **Env-specific artifacts** (`npm run build:prod` vs `build:staging` with
  different code). Fix: build once; configure at runtime.
- **Feature flags that never get removed.** Fix: owner and expiry; report.
- **Flags checked in six layers.** Fix: evaluate once per request at the
  application layer.
- **Migrations on container start with N replicas.** Fix: separate
  release step.
- **`.env.example` missing half the variables.** Fix: generate it from
  the config schema, or validate in CI that every schema key appears in
  the example.
- **Staging with different infrastructure than production.** Fix: parity;
  the same compose/Terraform modules with smaller sizes.
