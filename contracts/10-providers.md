# 10 · Model providers: driven through the vendors' own CLIs

Contract in this file: **CT-PROVIDER**

Centcom runs agents on **Anthropic** models and **OpenAI** models by driving the user's **own installed command-line tools**: Anthropic's `claude` (Claude Code) and OpenAI's `codex`. Those tools sign the user in, hold the credentials, call the models, run the tools and apply their own sandboxing. Centcom wraps them: it starts them, sends prompts, reads their structured output, routes approvals, and shows the result.

Consequences (the whole point of the design):
- **Centcom never handles a model-provider credential.** No login flow of ours, no key storage, no token proxying, and the **backend never sees one**.
- **Centcom never pays for, resells or pools model usage.** Whoever's CLI is signed in pays and is subject to their own plan limits.
- **We do not use the vendors' SDKs** (Claude Agent SDK, OpenAI Agents SDK) and we do not call model APIs directly in v1. Adding either needs an ADR (it changes this contract's trust model).

> Provider policies change. §2 is dated and sourced; every method has a **kill switch** (§6); §8 lists what still needs written confirmation from the providers.

---

## 1. Rules (normative, both repos)

1. **Credentials stay in the vendor tools.** Centcom MUST NOT read, copy, parse, move or persist `~/.claude*`, `~/.codex/*` (including `auth.json`), keychain items written by those tools, or any token. It asks the tools questions through their documented commands/protocols and nothing else. Provider API keys, if the user uses them, live in the user's own environment or the vendor tool's own config; Centcom inherits the environment of the child process and stores no key.
2. **Credentials never appear in** frames, REST bodies, logs, telemetry, crash reports, snapshots, backups, support bundles or error messages. Backend lanes treat any such string as a bug (credential-leak guard, lane B101); client log/redaction (C005) uses the same patterns (`fixtures/providers/secret-patterns.json`).
3. **Unmodified vendor binaries.** Centcom runs `claude` and `codex` as published, with documented flags only, and never removes or disables any of their authentication methods. It does not bundle, patch or repackage them. It does not use `--bare` for subscription-backed runs (that mode ignores OAuth/keychain by design).
4. **Each person's usage is billed to that person.** The account signed in to the CLI that makes the model call pays and is subject to its limits. One person's CLI MUST NOT serve another person's prompts unless §4 allows it.
5. **No vendor marks in our identity.** The product, company, features and mascot are never named or styled as Claude, Claude Code, Anthropic, OpenAI, ChatGPT or Codex. Plain statements like "works with Claude Code and Codex" are fine.
6. **Honest UI.** Before any model call the user can see which provider and model, and whose account (§5).

## 2. Methods (as of 2026-10-06; re-verify before launch)

| Provider | What the user does | What Centcom does | Status |
|---|---|---|---|
| Anthropic | Signs in to Claude Code with **their own subscription** (Anthropic's own flow), or sets `ANTHROPIC_API_KEY`, or uses Bedrock/Vertex/Foundry credentials in their environment | Runs the unmodified `claude` binary | Allowed *with conditions* (see §8); API key / cloud paths are the plainly allowed ones |
| Anthropic | n/a | "Sign in with Claude" inside Centcom; collecting/reusing Free/Pro/Max OAuth tokens; Agent SDK with subscription OAuth | **Not permitted** by Anthropic, **not implemented** |
| OpenAI | Signs in to Codex with **ChatGPT** (OpenAI's flow, `codex login`), or sets `OPENAI_API_KEY` / `codex login --with-api-key` | Runs the unmodified `codex` binary (`app-server` or `exec --json`) | Allowed *with conditions* (see §8) |
| OpenAI | n/a | A native "Sign in with ChatGPT" plan-token client in Centcom (needs an OpenAI-issued client ID) | **Out of scope for v1**; revisit by ADR |

Sources: [Anthropic legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) · [Claude Code headless](https://code.claude.com/docs/en/headless) · [Codex authentication](https://learn.chatgpt.com/docs/auth) · [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) · [Sign in with ChatGPT](https://developers.openai.com/siwc).

## 3. Engines and how they are driven (informative; the interface itself is client-internal, lane C101)

| Engine id | Binary | Primary protocol | Notes |
|---|---|---|---|
| `claude-code` | `claude` | `claude -p … --output-format stream-json --verbose --include-partial-messages`; continue with `--resume <session_id>`; approvals through `--permission-prompt-tool <mcp tool>` served by a small stdio MCP server Centcom starts; `--permission-mode`, `--allowedTools`, `--mcp-config`, `--append-system-prompt`, `--model`, `--agents`; interrupt with SIGINT | Feature-detect with the `capabilities` array of `system/init`, never by version string. Skills, MCP, hooks, subagents, memory and compaction are the tool's own |
| `codex` | `codex` | `codex app-server --listen stdio://` (JSON-RPC: threads, turns, approvals, events); fallback `codex exec --json` (JSONL) with `--sandbox` and `--ask-for-approval` | `codex login status` reports whether a login exists. Config in `~/.codex/config.toml` is the tool's own |

Every engine exposes the same normalised event stream and a capability set: `streaming`, `approvals`, `resume`, `subagents`, `mcp`, `skills`, `thinking`, `usage`, `models.list`, `interrupt`, `compact`. The UI hides or explains missing capabilities instead of failing. Normalised event names feed the product states in CT-STATE-MAP (`thinking`, `tool-running`, `awaiting-approval`, …).

## 4. Who pays: the command-post rule

| Mode | Whose CLI runs the model | Default |
|---|---|---|
| **Branch mode** (each agent in its own worktree, owned by its member) | the agent owner's | all engines allowed |
| **Command post** (guests queue prompts into the host's agent) | the **host's** | An engine whose CLI is signed in with an **API key or cloud credentials** is allowed (billed to the key owner). An engine signed in with a **subscription** is **blocked by default** |
| Command post on a subscription-backed engine | the host's subscription | The host may enable it per session after confirming a plain policy notice **and** only while the kill switch `provider.command_post.subscription` is on. Ships **off** until a provider's written confirmation covers shared-session use |

How Centcom knows which kind of login a CLI uses, from what the tool itself reports: for Claude Code, `claude auth status` (JSON; exit code 0 = signed in, 1 = not; its `authMethod` is one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party`: `claude.ai` and `oauth_token` count as **subscription**, `api_key` and `api_key_helper` as **API key**, `third_party` as **cloud**); for Codex, `codex login status` plus whether `OPENAI_API_KEY` is set in the environment Centcom passes on. When the tool does not say, Centcom assumes **subscription** (the conservative reading). Centcom never runs `claude setup-token` or `claude auth login` on the user's behalf except by handing the terminal to them (§7).

## 5. Wire fields (the only provider information on the wire)

`agent.spawn` (CT-WS-SESSION-EVENTS) carries in its **clear** part:
- `runs_on: mem_…`: the member whose machine and CLI run the agent;
- `provider: anthropic | openai | other`: coarse, for the UI badge.

Model name, engine id, binary version and everything else stay in the encrypted part.

UI contract (design system §10.1.12): each agent card shows `runs on <name> · <provider>`; in a command post the guest composer says "Your prompt will run on <host>'s account"; the host sees "N guests can spend your <provider> usage" with a one-click pause.

## 6. Kill switches and policy table

Feature flags (CT-API-FLAGS), evaluated on the client before an engine starts:
`provider.claude_code`, `provider.codex`, `provider.command_post.subscription`.
Defaults: `true`, `true`, **`false`**. Turning one off blocks new sessions on that engine, shows the policy notice, and lets running sessions finish.

The client bundles `provider-policy.json` (schema `schemas/provider-policy.schema.json`; reference table in `fixtures/providers/policy-reference.json`) shown by `centcom provider status` and refreshed each release. Before launch a human re-verifies every row of §2 and §8.

## 7. Login handoff

`centcom provider status` reports, per engine: installed? version? signed in? how (subscription / API key / cloud / unknown)? `centcom provider login <claude|codex>` **launches the vendor's own login in the user's terminal** (`claude auth login` — with `--console` when the user chooses API billing — or `codex login`) and then re-checks status. Centcom does not drive or screen-scrape the login, does not accept the user's password/token, and never opens its own OAuth flow.

## 8. Risk register (needs a human decision or written confirmation)

1. **Programmatic Claude Code with a subscription.** Anthropic's headless docs describe `claude -p` as "the Agent SDK via the CLI" (the CLI reference says "Query via SDK, then exit"), while the legal page says products built on the Agent SDK should use API-key authentication and that third parties may not route requests through plan credentials on users' behalf. Our reading: running the user's own unmodified `claude` on their own machine under their own login is the user's own use (Anthropic explicitly says users may sign in to the unmodified binary with their own subscription), and Centcom intermediates nothing. That reading is **not confirmed**; before launch, ask Anthropic (contact sales) for written confirmation, including for many parallel agents and for any shared/command-post use. Until confirmed: subscription-backed command posts stay blocked and the UI states plainly whose login is used.
2. **Plan limits.** Plan limits assume ordinary individual use. A fleet of parallel agents can hit them fast; the UI shows the CLIs' own limit errors verbatim and `provider-cap-reached` states, never retries aggressively.
3. **Codex shared use.** Same caution for ChatGPT-backed Codex in shared sessions.
4. **CLI drift.** Flags and protocols change; engines feature-detect, pin tested version ranges, and the doctor command reports unsupported versions. Contract tests use recorded transcripts (`fixtures/providers/`).
5. **Branding.** §1 rule 5.

## 9. Errors (client-local; shown, never sent)

`provider_not_installed`, `provider_not_signed_in`, `provider_method_disabled`, `provider_policy_blocked`, `provider_cap_reached`, `provider_rate_limited`, `provider_version_unsupported`, `provider_protocol_error`, `provider_capability_missing`. Each maps to one calm message with a next step and no secrets.

## 10. Conformance

`fixtures/providers/` holds: golden normalised event transcripts per engine (recorded by the engine lanes, replayed in CI without the real CLIs), `secret-patterns.json` (strings every log/telemetry/frame scanner must catch), and the policy reference table. Client lane C100 and backend lane B101 run them.
