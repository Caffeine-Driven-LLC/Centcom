# What a session costs, and what Centcom adds

This page is the measurement behind Centcom's cost defaults. Everything here can be re-run; nothing is a guess except where it says so.

## Measure it yourself

```
centcom doctor --cost                        # how Centcom launches claude, and whether the cached prefix stays the same
centcom doctor --cost <session.jsonl> [<session folder>]   # where a recorded Claude Code session's tokens went
pnpm exec tsx tools/dev/cost-report.ts       # the same, plus the size of the text Centcom can add to a prompt
```

A Claude Code transcript lives under `~/.claude/projects/<project>/<session>.jsonl`; its sub-agents are in `<session>/subagents/`. Name both and the report covers the whole session. The report counts tokens; it never prints message text, file names or paths. No command here makes a model call. The code is `packages/agent/src/cost/`.

The tool reads what the engine reported (tokens per request). It has no price table on purpose: a cost shown anywhere in Centcom is the one the engine reported.

## What the "build a SAT app" session used

One real session, recorded by Claude Code, run through Centcom with the user's default model (Opus 5.5). The transcript also holds 19 placeholder messages Claude Code wrote itself; they carry no usage and are left out:

| | Main conversation | Sub-agents (43 transcripts) | Total |
|---|---|---|---|
| API requests | 114 | 569 | 683 |
| Output tokens | 154k | 2,377k | 2.5M |
| Prompt tokens read from cache | 20.8M | 43.3M | 64.1M |
| Prompt tokens written to cache | 0.31M | 4.76M | 5.1M |

- The first request carried 35k tokens; the context grew to 324k at most. Every later request pays for the whole context again (as a cache read, which is cheaper than fresh input, but not free).
- 48 sub-agent calls produced 94 % of the output tokens and 68 % of the cache reads. Each sub-agent starts with its own system prompt and tools and re-reads whatever it opens.
- 19 requests inside sub-agents rewrote 60k to 140k tokens into the cache instead of reading them (1.8M tokens in all). These are large tool results (PDF text) added to a context, not Centcom's doing.
- Centcom put **no text of its own** into the 23 user messages of this session (no board digest, no auto-skill block, no team notice). The cost is the model, the volume of work, and the fan-out.

So the session was expensive because of what was asked and which model answered, not because of Centcom's own text. The rest of this page says what Centcom does about both.

## What Centcom adds to the first request

One-word prompt, cheapest model (Haiku), same folder, `claude -p --output-format json`, prompt-cache state warm. Eleven real calls in all, about 0.37 USD together (one of them, a test that turned a CLI feature off, cost 0.14 USD on its own).

| Launch | Tokens in the first request |
|---|---|
| plain `claude -p` | 25,737 to 26,991 (two runs of the same command differ by 1.2k) |
| plain + Centcom's flags | 28,083 |
| plain + `--add-dir` (the two skill folders) | 27,056 (+65) |
| plain + the approval bridge (`--mcp-config` and `--permission-prompt-tool`) | 28,018 (+1,027 over the same run's plain launch) |

- Centcom's fixed cost is about **1.1k tokens per request, 4 %** of a 27k first request. Almost all of it is the CLI's own deferred-tool machinery that any MCP server switches on, not Centcom's tool (its description is one sentence).
- Turning that machinery off (`ENABLE_TOOL_SEARCH=false`) is not an option: it loads every tool of every MCP server the user has into the prompt (71k tokens in the test).
- The remaining ~25k is the user's own Claude Code setup (plugins, skills, MCP servers). Centcom does not add to it and does not remove from it.

## What Centcom can put in front of a prompt

Measured by `tools/dev/cost-report.ts` (about 4 characters per token):

| Text | Where | Size | When |
|---|---|---|---|
| board digest | start of the user message | up to 500 tokens (`context.digest_tokens`), 356 in the sample | only when another agent or person posted something new; each note once |
| auto skills | start of the user message | about 45 tokens per matched skill | only when the prompt matches a skill |
| team notice | start of the user message | one line | once per conflict |
| carry-over summary | start of the first message of a fresh session | up to 8 KiB | only after switching engines or a resume that could not be continued; sent once |

None of this is in the system prompt. Centcom adds nothing to `--append-system-prompt` at all: the carry-over summary used to be sent there on every turn of its session (up to 8 KiB, 2k tokens, every request); it now goes into the first message once, and a resumed session is never sent it again. The skills pack is 3.3 KB in all (about 800 tokens), so it was left as it is.

## Is the prompt cache kept?

`centcom doctor --cost` launches Centcom's real Claude engine for three turns against a stand-in and compares the flags that reach the cached prefix (`--append-system-prompt`, `--model`, `--effort`, `--allowedTools`, `--mcp-config`, `--add-dir`, `--settings`). Result: byte-identical across turns, so Centcom itself does not invalidate the cache. A test (`packages/agent/test/cost/turns.test.ts`) fails if that changes.

What does invalidate it, and Centcom cannot hide: changing the model or the effort between turns (`/model`, `/effort`), the five-minute or one-hour cache lifetime running out while the agent waits for you, and compaction.

## Which model a turn runs on

Before, Centcom passed `--model` only when you had set one, so a plain start used your own Claude Code default (Opus 5.5 in the SAT session). Now:

| Setting | Default | What it does |
|---|---|---|
| `agent.model` | `sonnet` | the model when you have not picked one |
| `agent.effort` | `medium` | the reasoning effort (`--effort`) when you have not picked one |
| `agent.subagent_model` | `sonnet` | the model of the sub-agents Claude Code starts (`CLAUDE_CODE_SUBAGENT_MODEL`) |

- A choice of yours always wins and is passed as given: `--model`, `/model`, or a model remembered from an earlier run (`client.model`). `/model` has a "Default" entry for your own Claude Code default.
- Set `agent.model` to an empty string to get your own Claude Code default back.
- Your own `CLAUDE_CODE_SUBAGENT_MODEL` is never overridden. A sub-agent model dearer than the main one is not set. Effort is not sent to Haiku.
- A folder's `.centcom/config.json` may set these; Centcom says so at start, because a cloned repo could otherwise pick a dearer model for you.
- When a top-tier model you picked earlier is restored at start, a notice says so and how to go back.
- The header always shows the model the turn ran on, and the effort.
- Checked against the real CLI with one small call each: a sub-agent started under a Sonnet main conversation ran on Haiku when `CLAUDE_CODE_SUBAGENT_MODEL=haiku` was set, and `--effort medium` was accepted.

## The budget guard (on by default)

A run is one task you gave and everything done for it, sub-agents included. Centcom counts each request to the model as it finishes (the engine reports it as a `usage.progress` event, for the main conversation and for every sub-agent) and the cost the engine reports at the end of a turn. At a limit it stops the run, says which limit and why, and asks whether to keep going with a fresh allowance. It never prices anything itself.

| Setting | Default | Limit |
|---|---|---|
| `budget.run_requests` | 60 | requests in one run |
| `budget.run_output_tokens` | 400,000 | output tokens in one run |
| `budget.run_usd` | 5 | engine-reported cost of one run (also passed to Claude Code as `--max-budget-usd` for the turn) |
| `budget.session_requests` | 400 | requests in one conversation |
| `budget.session_output_tokens` | 1,500,000 | output tokens in one conversation |
| `budget.session_usd` | 0 (off) | engine-reported cost of one conversation |
| `budget.max_continues` | 3 | messages like "continue" in a row before it asks |
| `agent.max_subagents` | 6 | sub-agents in one run (0 none, -1 no limit) |
| `budget.big_prompt_tokens` | 2,000 | a prompt this big is confirmed first |
| `budget.enabled` | true | the whole guard |

Set a limit to 0 to switch that one off. `/budget` shows what this run and conversation have used against them; `/budget continue` lets a paused run go on; `/budget off` turns the guard off for the conversation. In `centcom -p` nobody can be asked, so the run stops and exits with code 5.

- **The SAT session would have paused after about 60 requests**, not 683: its sub-agents alone made 569 requests and 2.4M output tokens. Replaying its numbers through the guard is a test.
- **"Continue" loops.** A short message such as "continue" or "choose whatever you want" stays in the run it continues, so it does not reset the allowance, and the fourth one in a row asks. A new task starts a new run.
- **Big prompts.** A prompt of 2,000 tokens or more, or a shorter one that asks for a whole application from scratch, shows an estimate (its size, the model and effort, and what the run may use) and asks before it is sent. Declining puts your text back in the prompt box.
- **Night cycle.** Each night task is a run of its own with the same request, token and cost limits. Nothing is asked at night: a task that passes a limit is stopped and the night goes on to the next.

### Sub-agents: what the claude CLI lets Centcom enforce

| Control | Enforceable? |
|---|---|
| No sub-agents at all (`agent.max_subagents = 0`) | Yes: `--disallowedTools Agent Task` removes the tool, which also saves its description from every request |
| A count per run (the default 6) | Yes, with a hook: Centcom adds a `PreToolUse` hook on the sub-agent tool through `--settings`. It asks Centcom before each one and Claude Code refuses the over-limit call with a reason the model reads. Checked against the real CLI (`tools/dev/cost-live.ts`, one Haiku call): the first sub-agent ran and the second was refused |
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | No: the variable exists in the binary but did not limit anything in a test (two sub-agents ran with it set to 1), so Centcom does not rely on it |
| A hook that cannot reach Centcom | Lets the call through: it is a cost limit, not a security check. The stream count (`subagent.started`) then stops the run |
| A cost cap inside a turn | Yes: `--max-budget-usd`, set each turn to what the run still has |
| A request or token cap inside a turn | Only by Centcom: the CLI has no such flag, so Centcom counts the stream and interrupts |

## Before and after

| | Before | After |
|---|---|---|
| Fixed tokens Centcom adds to each request | about 1.1k (the approval bridge's tool list) | the same: the CLI needs it for approvals, and the only way to drop it loads every other MCP tool into the prompt |
| Centcom's text in the system prompt | the carry-over summary on every turn (up to 2k tokens) | none; the prefix is byte-identical |
| Model on a plain start | your Claude Code default (Opus 5.5 in the SAT session) | Sonnet, medium effort, Sonnet sub-agents; your own choices untouched |
| What stops a long job | nothing (683 requests, 2.5M output tokens in the SAT session) | a pause at 60 requests, 400k output tokens or $5 |
| Sub-agents per run | unlimited (48 calls in the SAT session) | 6, enforced by a hook |
| "Continue" loops | unlimited | the fourth in a row asks |
| Big prompts | sent at once | estimate and confirmation |
