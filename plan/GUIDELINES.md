# Lane Guidelines (strict)

These rules apply to **every** lane in both plans. A lane is "done" only when all of §1–§8 hold. Reviewers reject PRs that break them, even if the code works.

## 0. What a lane is

A **lane** is one independently buildable, independently reviewable task with:
a single owner, a fixed scope, explicit inputs and outputs, and testable acceptance criteria.
Each lane has a card in `plan/lanes/<plan>/<ID>.json` (rendered to `plan/<plan>/<ID>.md`).

- **Size:** S ≤ 1 day · M ≤ 3 days · L ≤ 5 days of focused work. Anything bigger must be split before it starts.
- **Ownership:** one named owner per lane. Others may review, not co-edit, until it merges.
- **One PR per lane** (or a short chain of stacked PRs). The PR title starts with the lane ID: `B037: relay service skeleton`.

## 1. Boundaries

1. **No cross-plan dependencies.** Backend lanes never depend on client lanes and vice versa. The only coupling is a contract ID (`CT-*`).
2. **Depend only on what the card says.** `depends_on` lists lane IDs from the *same* plan. If you need something from a lane not listed, stop and update the card first (a one-line PR to the plan).
3. **Stay inside `deliverables`.** Touching files outside your lane's paths requires the owning lane's approval in the PR.
4. **Public surface is the card's `interfaces`.** Everything else is private. Other lanes may only import what a card lists as an interface.
5. **Build against mocks.** Until the counterpart exists, use the mock named in the card's `build_against` (client: lane `C007` mock backend; backend: lane `B011` client simulator).

## 2. Contracts

1. `contracts/` is read-only inside a lane. CI runs `tools/plan/lock.py --check`; any diff fails the build.
2. Generated types come from `contracts/` via the codegen lane (`B003` / `C003`). **Never hand-write a type that a contract defines.**
3. Unknown fields are ignored on read; never rely on field order; never send fields not in the schema.
4. Unknown event types and unknown enum values must be tolerated (log at debug, ack, continue).
5. A lane that `implements` a contract must pass that contract's fixtures (`contracts/fixtures/`) in its own CI. A lane that only `consumes` a contract must not re-implement it.
6. Version negotiation (`CT-VER`) is mandatory for anything on the wire.

## 3. Code

1. TypeScript `strict`, no `any` (use `unknown` + validation), no `// @ts-ignore` without an issue link.
2. Validate **all** external input (HTTP, WS, files, env, IPC, LAN) with the generated schemas at the boundary. Internal code trusts typed values.
3. No global mutable state; dependency-inject clocks, RNGs, IDs, loggers, and I/O so tests are deterministic.
4. Errors: throw typed errors from the error registry (`CT-ERR`), never strings. User-facing text lives in one message table, not inline.
5. Logging: structured JSON, one line per event, with `request_id`/`session_id` where available. **Never log** tokens, keys, ciphertext, message bodies, file contents, paths, or branch names.
6. No `console.log` in library code. No `process.exit` outside entrypoints.
7. Time limits on everything that waits (network, child processes, locks). No unbounded queues or buffers; every buffer has a documented cap.
8. Public functions have TSDoc; modules have a header comment saying what they own and what they must not do.
9. Dependencies: justify each new runtime dependency in the PR; prefer the standard library; no packages with install scripts; pin exact versions; licence must be MIT/Apache-2.0/BSD/ISC.
10. Secrets never in the repo. `.env.example` lists names only.

## 4. Tests

1. **Unit tests** for every exported function and every branch of business logic. Target ≥ 90 % line coverage on the lane's deliverables (hard floor 80 %).
2. **Contract tests** wherever a contract is implemented or consumed: run the shared fixtures; add new fixtures only via the contract process.
3. **Property or fuzz tests** for parsers, codecs, state machines, ordering logic.
4. **Failure-path tests**: timeout, malformed input, auth failure, partial failure, retry, cancellation.
5. Tests are deterministic (injected clock/RNG), run offline, and finish in < 60 s per lane in CI. Network tests use the mock from §1.5.
6. A bug fix lands with a regression test that fails before the fix.

## 5. Security and privacy

1. Default deny. Authorisation checks live in one place per service (`B021` RBAC engine; `C015` permission engine) and are called, never re-implemented.
2. Parameterised queries only; no string-built SQL. No `eval`, no `child_process` with shell interpolation.
3. Zero plaintext work content on the backend: if your lane can see message/diff/path/branch text, you have a bug. Review `CT-CRYPTO` §3 (what the relay may see).
4. Every new endpoint/event: write its abuse case (rate limit, size limit, replay) in the PR description and test it.
5. Constant-time comparison for secrets and signatures. Randomness from the platform CSPRNG only.
6. **Provider credentials:** no lane reads, stores, logs, transmits or parses Anthropic/OpenAI credentials, tokens, API keys, `~/.claude*` or `~/.codex/*`. Engines talk to the vendors' CLIs through documented flags/protocols only (CT-PROVIDER). New provider code paths need an ADR.
7. PII minimisation: store only what the lane needs; every stored field has a retention rule (`B090`).

## 6. Observability and operations

1. Every service lane emits metrics for: request/event rate, error rate, latency (p50/p95/p99), saturation of its queues/pools.
2. Every background job is idempotent, retries with backoff + jitter, and has a dead-letter path.
3. Every config value has a default, a validation rule, and an entry in the lane's docs.
4. Every migration is **forward-only, backward-compatible with the previous release** (expand → migrate → contract), and has a rollback note.
5. Feature flags (`CT-API-FLAGS`) guard anything user-visible that can be dark-launched.

## 7. Documentation

1. Each lane adds or updates a short doc next to its code (`README.md` in the package) covering: purpose, public interface, config, failure modes, how to test.
2. Public interfaces and wire behaviour are documented by the **contract**, not by the lane. Do not copy contract text; link it.
3. The PR description uses the template in `plan/PR_TEMPLATE.md`: lane ID, contracts touched, tests run, mocks used, risks.

## 8. Definition of Done (checklist, every lane)

- [ ] All `acceptance` criteria on the card are met and each is covered by a test
- [ ] Every item in `deliverables` exists at the stated path
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally and in CI
- [ ] `tools/plan/lock.py --check` passes (contracts unchanged)
- [ ] Contract fixtures for every implemented contract pass
- [ ] No new `any`, no skipped tests, no TODO without an issue link
- [ ] Logging reviewed for forbidden data
- [ ] Docs updated; PR template filled in
- [ ] Reviewer other than the owner approved
- [ ] The lane's `unblocks` lanes were notified (comment on their cards/issues)

## 9. Change control

| Change | Process |
|---|---|
| Fix a typo in a lane card | Direct PR to `plan/` |
| Change a lane's scope/deps/size | PR to `plan/` reviewed by both plan leads |
| **Change any file in `contracts/`** | **Contract PR**: touches only `contracts/` (+ fixtures + lock), carries an ADR in `plan/adr/`, needs one approver from *each* side, bumps `CT-VER` rules if breaking, and re-runs both conformance suites |
| Add a new contract | Same as above; plus an entry in `contracts/index.json` and at least one implementing lane on each required side |
| Technology change (framework, DB, host) | ADR in `plan/adr/` approved by both leads |

Breaking wire changes follow `CT-VER`: add → dual-support → migrate → remove, never in one step.

## 10. Escalation

If a lane is blocked by a contract that is ambiguous or wrong, **do not guess**. Open a Contract PR (§9) with the smallest clarifying change plus a failing fixture that shows the ambiguity. Meanwhile, implement the most conservative reading behind a feature flag.

## 11. Reviewing a lane

Reviewers check, in order: (1) scope respected, (2) contracts respected, (3) tests prove acceptance, (4) failure paths and limits, (5) security/privacy, (6) logging, (7) docs. Style comes last and is automated.
