# API and compatibility review

How to spot a change that will break something you cannot see: another
team's client, a mobile app in the store, a stored row written last year,
a script that parses your output. Covers the categories of breaking
change, how to detect them in a diff, semver and what it promises, the
deprecation path, feature flags as a compatibility tool, config changes,
reviewing migrations alongside the code that depends on them, and public
API documentation. API design itself (resource modeling, pagination,
error envelopes) is `backend/references/api-design.md`; migration
mechanics (locking, batching, reversibility) are the `database` skill's.

## Contents

1. What "public" means
2. Categories of breaking change
3. Detecting breaking changes in a diff
4. Semver and what it promises
5. The deprecation path
6. Feature flags for compatibility
7. Config and environment changes
8. Migrations alongside code: the deploy order problem
9. Serialized and stored data
10. Reviewing public API documentation
11. Severity guide

## 1. What "public" means

A surface is public if anyone outside this deployable unit depends on it,
whether or not it was meant that way:

- HTTP, gRPC, GraphQL endpoints; webhooks you send.
- Message schemas on queues and event buses.
- Library and SDK exports (anything importable from the package root, and
  anything importable at all in languages without real privacy).
- CLI arguments, exit codes, stdout format (someone is parsing it).
- Database schema, if another service reads the tables (it should not,
  but check).
- File formats you write and later read, including caches and serialized
  sessions.
- Environment variables and config keys that operators set.
- Log formats that alerting rules match on.
- Shared TypeScript types, protobuf definitions, OpenAPI specs, JSON
  schemas.
- Error codes and messages that clients branch on.

The first review question for a diff that touches any of these: who
consumes this, and can they all deploy at the same moment as this change?
If the answer is "no" or "I do not know", every change is a compatibility
change.

## 2. Categories of breaking change

### Signatures and shapes

| Change | Breaking? | Notes |
|---|---|---|
| Add an optional field to a response | Usually no | Unless clients validate strictly (closed schemas) or the field name collides |
| Add a required field to a request | Yes | Old clients do not send it |
| Remove or rename a field | Yes | Rename is remove plus add |
| Change a field's type (`string` to `number`, scalar to array, nullable to non-null in a request) | Yes | Response nullable to non-null is safe; request non-null to nullable is safe |
| Reorder positional parameters | Yes | Named parameters survive; positional do not |
| Add a parameter with a default | Usually no | Unless the language has no defaults (Go, Java overloads) or the function is passed as a callback with a fixed arity |
| Change a default value | Yes, behaviorally | Callers that relied on the default get new behavior silently; the worst kind because it compiles |
| Widen an accepted input | No | Accepting more is safe |
| Narrow an accepted input (stricter validation) | Yes | Previously valid requests now fail |
| Widen a returned type (return a subtype's parent, add a union member) | Yes for consumers | Exhaustive matches break; TS consumers get type errors |
| Narrow a returned type | No for consumers | |

### Enums and constants

Adding a value to an enum that clients receive is breaking for any client
with an exhaustive switch or strict deserialization (Java `Enum.valueOf`
throws; protobuf handles unknown as a sentinel; TypeScript unions break at
compile time). Adding a value to an enum that clients send is safe.
Removing a value is breaking both ways. Changing the wire representation
(`"ACTIVE"` to `"active"`, `1` to `"one"`) is a rename.

### Errors

Changing a status code (404 to 410), an error code string, or the
structure of the error body breaks clients that branch on them. Adding a
new error code is breaking for clients with exhaustive handling, and most
clients at least log unknown codes; it is usually acceptable with a
changelog note. Changing an error message is safe only if clients were
told never to parse it.

### Behavior

Same signature, different semantics: a list that was sorted is now
unsorted; an endpoint that was idempotent now has a side effect; a
timeout shortened; pagination page size default changed; a method that
returned a copy now returns a reference; a function that accepted
duplicates now dedupes; timezone handling changed. These are the hardest
to detect and the most common cause of "nothing changed but it broke".

### Database schema

Dropping or renaming a column or table breaks any code still reading it,
including the previous version of this service during a rolling deploy.
Adding `NOT NULL` without a default breaks the old writer. Changing a
type can break the ORM mapping of the old code. Adding a unique
constraint can fail against existing data. Section 8.

### Dependencies and runtime

Bumping a minimum language or runtime version (Node 18 to 20, Python 3.9
to 3.11, Go toolchain) is breaking for consumers of a library. Changing a
peer dependency range. Removing a polyfill.

### Protocol and transport

Changing content type, compression, authentication scheme, CORS policy,
required headers, URL structure, TLS minimum version.

## 3. Detecting breaking changes in a diff

### Read the contract files first

Before any implementation, read changes to: OpenAPI/Swagger, `.proto`,
GraphQL schema, JSON Schema, TypeScript `.d.ts` or exported types, Java
public interfaces, Go exported identifiers, Rust `pub` items, database
migrations, config schemas, CLI argument definitions. Every `-` line in
these is a candidate break.

### Tooling

```sh
# OpenAPI
npx @redocly/cli diff old.yaml new.yaml          # or: oasdiff breaking old.yaml new.yaml
# Protobuf
buf breaking --against '.git#branch=main'
# GraphQL
npx graphql-inspector diff 'git:origin/main:schema.graphql' schema.graphql
# TypeScript library surface
npx @microsoft/api-extractor run --local         # compares against the committed .api.md
# or: npx attw --pack .  (are-the-types-wrong, for packaging/exports)
# Java
# japicmp: java -jar japicmp.jar --old old.jar --new new.jar --only-incompatible
# revapi for Maven projects
# Go
go run golang.org/x/exp/cmd/gorelease@latest     # suggests the version bump
apidiff ./old ./new
# Rust
cargo semver-checks check-release
# Python
# griffe check mypkg --against v1.2.0  (or: pip install griffe; griffe check)
# .NET
# Microsoft.DotNet.ApiCompat (dotnet apicompat) against the previous package
# Database: diff the schema dumps
pg_dump --schema-only db_before > before.sql; pg_dump --schema-only db_after > after.sql; diff before.sql after.sql
```

If the repo has none of these and has a public surface, proposing one is
a good separate PR.

### Grep for consumers

For every removed or changed symbol, field, route, enum value, error code
or config key, search beyond this repo if you can:

```sh
gh search code "orderStatus" --owner myorg               # other repos in the org
grep -rn "page_size" clients/ mobile/ docs/              # monorepo neighbors
grep -rn '"/v1/orders"' --include='*.ts' --include='*.kt' --include='*.swift' .
```

Mobile clients deserve special attention: a version shipped a year ago is
still installed somewhere. Ask what the oldest supported client version
is and what it sends and expects.

### Check the default-change category explicitly

Grep the diff for changed defaults: `default`, `= ` in parameter lists,
`??`, `||`, `getOrDefault`, `.get(k, v)`, `unwrap_or`, config loaders
with fallbacks. Each change in a default is a behavior change for every
caller that did not specify, and the description rarely mentions it.

### Behavioral breaks

These need the tests: a test deleted or an expected value changed in the
same PR as a "refactor" is the fingerprint. `reviewing-tests.md` section
9. Beyond tests, ask the author directly: "Does any consumer rely on the
order of this list?"

## 4. Semver and what it promises

For libraries and SDKs: MAJOR for breaking, MINOR for compatible additions,
PATCH for compatible fixes. The review question is whether the proposed
version matches the diff. A "patch" that removes an export is a broken
promise.

Nuances that catch reviewers:

- **0.x versions**: anything may break on minor; many consumers still
  treat `^0.3.0` as compatible. Say so in the changelog anyway.
- **Behavior fixes can be breaking**: fixing a bug that consumers relied
  on (a tolerant parser made strict). Still a fix, but it belongs in the
  changelog's breaking section and sometimes deserves a major.
- **Type-level changes in TypeScript**: tightening a type is breaking for
  consumers even though runtime behavior is unchanged. Many TS libraries
  treat type changes as minor; the repo's policy decides, and it should
  be written down.
- **Transitive bumps**: a minor bump of a dependency that itself bumped
  major (and leaks its types) is a major for you.
- **For services (not libraries)**: semver applies to the API version
  (`/v1`, header, media type), not the deployment. Breaking changes mean
  a new API version running alongside the old.

Ask for a CHANGELOG entry (or a changeset / release note) in the PR for
any public surface change; the entry should say what changed and what
consumers must do.

## 5. The deprecation path

A breaking change for an external consumer should almost always be
staged:

1. **Add the new** alongside the old (new field, new endpoint, new
   parameter, new function).
2. **Mark the old deprecated** in a way consumers will see: `@deprecated`
   JSDoc/TSDoc (IDEs strike it through), Python `warnings.warn(...,
   DeprecationWarning)` plus `@deprecated` (3.13) or `typing_extensions`,
   Go `// Deprecated:` comment, Rust `#[deprecated(since, note)]`, Java
   `@Deprecated(forRemoval = true, since = "...")`, Kotlin
   `@Deprecated(level = WARNING, replaceWith = ...)`, C# `[Obsolete]`,
   Swift `@available(*, deprecated, renamed:)`, HTTP `Deprecation` and
   `Sunset` headers (RFC 9745 / RFC 8594), GraphQL `@deprecated(reason:)`,
   protobuf `[deprecated = true]`.
3. **Say when it goes away** and how to migrate, in the deprecation
   message and the changelog.
4. **Measure usage** of the old path (a metric or log line) so the
   removal date is based on data.
5. **Remove** in a major version or after the announced date, with a
   changelog entry.

In review of a PR that removes something: was it deprecated first, for how
long, and does usage data say it is safe? A PR that removes without
deprecating is blocking for external surfaces unless the author shows
there are no consumers.

```ts
/**
 * @deprecated since 2.4; use `fetchOrders({ status })`. Will be removed in 3.0.
 */
export function getOrdersByStatus(status: string) {
  metrics.increment("deprecated.getOrdersByStatus");
  return fetchOrders({ status: status as OrderStatus });
}
```

## 6. Feature flags for compatibility

Flags let a breaking behavior ship dark and flip per consumer or per
tenant. In review of flag-related changes:

- **Both branches are tested**, and the test names say which flag state
  they exercise.
- **The default is the old behavior** until the flip is deliberate.
- **The flag has an owner and a removal plan** (ticket, date, or
  condition). Flags that live forever are two code paths forever.
- **The flag is read once per request**, not scattered; a request should
  not see both behaviors.
- **The flag's evaluation cannot fail open** into the new behavior by
  accident (a flag service outage should yield the default).
- **Cleanup PRs** that remove a flag remove both the flag reads and the
  dead branch, and the tests for the dead branch.

Flags are the mechanism for the strangler fig (`refactoring.md` section 7)
and for backward-compatible rollouts; they are not a substitute for a
deprecation path on a public API.

## 7. Config and environment changes

A new required env var is a breaking change for every environment that
does not set it, and the failure shows up at deploy time in production.

- **New config key**: is there a default, or does startup fail clearly
  with the key's name? Where is the key documented (`README`,
  `.env.example`, Helm values, Terraform variables)? Is it set in every
  environment's config in this PR or a linked one?
- **Renamed key**: is the old name still read with a deprecation warning
  for one release?
- **Changed default**: who relied on it? Grep deployment configs.
- **Secret vs non-secret**: a new key that is a credential must go
  through the secret mechanism, not plain config
  (`security/references/secrets.md`).
- **Validation at boot**: config should be parsed and validated once at
  startup so a missing key fails fast, not on the first request that
  needs it (`backend/references/config-and-environments.md`).
- **Infra config** (Dockerfile, Helm, Terraform, CI): version pins,
  resource limits, exposed ports, IAM changes. Each is a compatibility
  change for the deployment; `security/references/cloud-and-infra.md`
  for the security angle.

## 8. Migrations alongside code: the deploy order problem

During a rolling deploy, old code and new code run against the same
database for minutes to hours. Any migration must be compatible with
both. The review question for every migration: can the previous version
of the code run against the migrated schema, and can the new code run
against the un-migrated schema (if code deploys first)?

The expand/contract pattern, which the `database` skill details:

1. **Expand**: add the new column/table (nullable or with a default),
   add the new index (concurrently). Old code ignores it. Deploy.
2. **Migrate code** to write both old and new, read new with fallback to
   old. Deploy.
3. **Backfill** in batches, outside the migration file (a job or a
   script with a cursor and a rate limit).
4. **Switch reads** to new only; stop writing old. Deploy.
5. **Contract**: drop the old column, in a later release, after
   confirming nothing reads it.

Review checks on a PR with a migration:

- **Is the migration in the same PR as the code that requires it?** Fine
  for expand steps; a contract step (drop, rename, `NOT NULL`) in the
  same PR as the code change that stops using the column is a rolling-
  deploy outage. Ask for the drop in a follow-up PR.
- **Rename is drop plus add.** `ALTER TABLE ... RENAME COLUMN` breaks the
  old code instantly. Expand/contract instead.
- **Reversibility.** Is there a `down`, and does it actually reverse
  (dropping a column you backfilled loses data; say so)?
- **Locking.** `database` owns the specifics per engine; in review, flag
  anything on a large table that is not known-safe: adding a column with
  a volatile default, adding `NOT NULL`, creating an index without
  `CONCURRENTLY` (Postgres), changing a column type, adding a foreign key
  without `NOT VALID` first.
- **Data migrations in schema migrations.** Backfills belong in a
  separate, resumable, batched job; a migration that `UPDATE`s 50M rows
  in one statement locks the table and may exceed the deploy timeout.
- **Idempotent and ordered.** Migration files have unique, monotonic
  identifiers; two PRs with the same timestamp conflict. Check the
  framework's conflict handling.
- **ORM model matches schema** after the migration, including nullability
  and defaults, or the old code's model matches the new schema well enough
  to run.
- **Tests.** Migration tested against a copy of production-shaped data
  when the table is large or the transformation is non-trivial.

## 9. Serialized and stored data

Anything written to disk, cache, queue or a column as a blob and read back
later is a compatibility surface with your own past self:

- **Pickled/serialized objects** (Python `pickle`, Java serialization,
  Ruby `Marshal`): renaming or moving the class breaks deserialization of
  every stored instance. Prefer explicit formats (JSON, protobuf,
  msgpack) with versioning.
- **JSON blobs in columns**: adding fields is fine; removing or renaming
  needs a reader that handles both shapes, or a migration of the blobs.
- **Cache entries**: a changed shape with the same key returns the old
  shape to new code. Version the key (`user:v2:{id}`) or flush on deploy.
- **Queue messages**: in flight during deploy; the new consumer must read
  the old shape. Add a `version` field to every message schema from day
  one.
- **Session and token payloads**: a JWT issued yesterday is read by
  today's code. Changing claims needs a grace period.
- **Files written by one version and read by another** (exports, reports,
  config saved by the app): include a format version.

Review check: for each stored shape the diff changes, where is the code
that reads old instances, and is there a test with an old-shaped fixture?

## 10. Reviewing public API documentation

Documentation is part of the API. For public surfaces, the PR should
update:

- The contract file (OpenAPI, proto, schema) if it exists; it should be
  generated from or validated against the code, not hand-edited to match.
- The reference docs for the changed function, endpoint or type: what it
  does, parameters with types and constraints, return shape, errors it
  can produce, an example request and response, since-version.
- The changelog or release notes, with a migration note for anything
  breaking or deprecated.
- `README` or guide sections that show the old usage.
- `.env.example` or config docs for new keys.

Review the docs for the same things as the code: do the examples run
(copy them and try)? Do the parameter lists match the signature? Does
the error list match what the code throws? Are the constraints stated
(max length, allowed values, rate limits)? Is the default documented and
does it match the code? Stale docs are a should-fix on a public surface
because consumers will build against them.

## 11. Severity guide

| Finding | Severity |
|---|---|
| Removes or renames a public field, endpoint, export or enum value with no deprecation and unknown consumers | blocking |
| Changes a default on a public surface without a changelog entry | blocking |
| Narrows accepted input on a public endpoint | should-fix; blocking if it rejects requests current clients send |
| Adds a required request field | blocking |
| Contract-step migration (drop, rename, NOT NULL) in the same deploy as the code change | blocking |
| Migration unsafe on a large table (non-concurrent index, volatile default, type change) | blocking; defer to `database` for engine specifics |
| Backfill inside a schema migration on a large table | should-fix; blocking at scale |
| New required config with no default and no deploy config change | blocking |
| Stored shape changed with no reader for old instances | blocking |
| Semver label does not match the change | should-fix |
| Public change with no changelog entry | should-fix |
| Public docs not updated | should-fix |
| Deprecation without a removal plan or usage metric | nit |
| Flag added without owner or cleanup plan | nit; should-fix if the repo has a flag policy |
| Internal-only signature change with all callers updated in the same PR | not a compatibility finding |
