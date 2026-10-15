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

## Before and after

Rows are added here as the cost work lands.

| Number | Before |
|---|---|
| Fixed tokens Centcom adds to each request | about 1.1k |
| Default model | the user's own default (Opus 5.5 in the SAT session) |
| Run limit | none |
| Sub-agents per run | unlimited |
