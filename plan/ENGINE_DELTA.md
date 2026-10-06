# Design change: agents are driven through the vendors' own CLIs

(Authoritative description: `contracts/10-providers.md`, contract CT-PROVIDER, v1.2.0.)

**Before:** the client embedded the Claude Agent SDK and implemented its own tools, permissions, context management, skills, MCP, hooks, memory, subagents, checkpoints and model/cost handling.

**Now:** the client **runs the user's own installed `claude` (Claude Code) and `codex` (OpenAI Codex) CLIs as child processes** and wraps them. Those tools sign the user in, hold credentials, call the models, run tools, apply sandboxing, compact context, load skills/MCP/hooks/memory, run subagents and report usage. Centcom never handles a provider credential, uses no vendor SDK, calls no model API directly, and never modifies or repackages the binaries.

What Centcom still owns (this is what the lanes build):
- **Engines (C101-C103):** the `AgentEngine` interface, capabilities, and a **normalised event stream**; one engine adapter per CLI.
  - Claude Code: `claude -p ... --output-format stream-json --verbose --include-partial-messages`, `--resume <session_id>`, `--permission-mode`, `--permission-prompt-tool` (an MCP tool served by a small stdio MCP server Centcom starts, to route approvals to our UI), `--allowedTools`, `--mcp-config`, `--append-system-prompt`, `--model`, `--agents`, `--forward-subagent-text`; interrupt with SIGINT; read `system/init` (model, tools, MCP servers, `capabilities`), `system/api_retry`, `result` (cost, session id); feature-detect by `capabilities`; never `--bare` for subscription logins.
  - Codex: `codex app-server --listen stdio://` (JSON-RPC: threads, turns, approvals, events); fallback `codex exec --json` with `--sandbox` and `--ask-for-approval`; `codex login status`.
- **Runner and fleet (C013, C024):** process lifecycle for many engines in parallel, each in its own git worktree.
- **Approvals (C015, C038):** one permission-policy engine and one prompt UI; engines forward their approval requests to it and apply the answer.
- **State and UI (C014, C046, C042...):** product states derived from normalised events; mascot, fleet panel, transcript.
- **Collaboration:** LAN and relay session engines carry the normalised events as encrypted frames.
- **Provider UX (C104, C105):** detection and login handoff (launch the vendor's own login; never read credentials), who-pays banners, command-post gate, kill switches.

What Centcom no longer builds: our own tool runtime, our own agent loop, model API clients, a Claude/ChatGPT login flow, credential storage, token counting, our own compaction, our own skill/MCP/hook execution (we configure and display the CLIs' own).

Rules every affected card must follow:
1. No `@anthropic-ai/*` or `openai` SDK dependency; the only model-facing code is child-process IO.
2. Never read credential files or tokens; ask the tools through documented commands/events only.
3. Everything provider-specific lives behind `AgentEngine`; UI and session code see only normalised events and capabilities.
4. Each engine is testable offline with **recorded transcripts** (golden files) replayed by a fake CLI process; no real CLI or network in CI.
5. Feature-detect (`capabilities`, `--version` ranges), degrade gracefully, show the tool's own errors verbatim in a calm frame.
6. Cards keep their ids, sizes and dependencies from `plan/skeleton.json`; titles were updated there.
