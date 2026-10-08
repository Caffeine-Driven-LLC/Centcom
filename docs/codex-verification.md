# Verifying the Codex engine on a real Codex

**For:** a Claude Code session (or a person) on a computer where OpenAI's `codex` CLI is installed and signed in.
**Why:** everything in Centcom that talks to Codex was built against Codex's published protocol schema and a protocol-faithful fake (`packages/agent/test/fixtures/fake-codex.mjs`). It passes those tests, but **no real Codex turn has ever run**, because the computer it was built on has no Codex account. This guide is the checklist for closing that gap. Work through it top to bottom and fix what does not match.

Work directly on `main` (the client is developed solo; no branches or pull requests), and run all the checks before every push (section 7).

## 0. Ground rules

- **Never read, print, copy or commit Codex's credentials.** Do not open `~/.codex/auth.json` or anything else in `~/.codex/` except `config.toml` when a step says so. Do not paste the output of `codex login status` anywhere: it can contain a masked key. Centcom must never touch Codex credentials, and its tests check that.
- The recorder (section 3) replaces your home folder, user name and the temporary project path with placeholders, and refuses to write a file that still looks like it contains a secret. **Still read every recorded file before you commit it.**
- Codex's real answers are the truth. When the adapter disagrees with them, change the adapter and its tests, not the recording. Exception: if Codex does something that looks like a bug in Codex, write it down in section 8 and work around it.
- Keep each fix small, tested and committed on its own, with a message that says what real Codex did.

## 1. Set up

```sh
git clone git@github.com:Caffeine-Driven-LLC/Centcom.git && cd Centcom
pnpm install --frozen-lockfile        # Node 22, pnpm 10 or newer
pnpm typecheck && pnpm test           # must be green before you start (about 1,500 tests)
codex --version                       # write the version down for the report
codex login status >/dev/null && echo signed-in   # do not print the output itself
codex app-server --help >/dev/null && echo app-server-ok
```

If `codex app-server --help` fails, the installed Codex is too old for the adapter (it only speaks `app-server`). Update Codex (`npm i -g @openai/codex`) and continue.

## 2. Compare the protocol with what the adapter expects

Codex can print its own protocol schema:

```sh
codex app-server generate-json-schema --out /tmp/codex-schema
```

The adapter lives in `packages/agent/src/codex/`:

| File | What it does |
|---|---|
| `engine.ts` | starts `codex app-server --listen stdio://`, then `initialize`, `initialized`, `account/read`, `thread/start` or `thread/resume`, `turn/start`, `turn/interrupt`; answers `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` |
| `map.ts` | turns notifications into Centcom's normalised events: `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `thread/tokenUsage/updated` (uses `tokenUsage.last`, `tokenUsage.total.totalTokens`, `modelContextWindow`), `account/rateLimits/updated` (`rateLimits.primary.usedPercent`, `windowDurationMins`, `resetsAt`) |
| `rpc.ts` | newline-delimited JSON-RPC over stdio |

Check in the schema that every method name and field name in that table still exists with the same shape (including the approval answers `{ decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel' }` and the `approvalPolicy` / `sandbox` values passed to `thread/start` and `turn/start`). Note every difference.

### 2b. Questions that Codex asks you (`item/tool/requestUserInput`)

This was added later and has **only been tried against the mock** (`tools/codex/mock-codex.mjs`, prompt `ask <question> | <a> | <b>`). Check it against the real schema before trusting it:

1. In `/tmp/codex-schema` look for `requestUserInput` (the params and the response types). The adapter (`engine.ts`, `onQuestion`) assumes the request has `questions: [{ id, header?, question, isOther?, isSecret?, options: [{ label, description? }] | null }]` and that the answer is `{ answers: { "<question id>": { answers: ["<label or typed text>"] } } }`. If a field name differs, change `onQuestion` and the mock together and keep the test in `packages/agent/test/codex.mock.test.ts` ("Codex asks the person a question").
2. By hand (section 5), ask Codex something that makes it ask you: for example "Before you start, ask me whether I want red or blue, using your question tool." In Centcom you should get a list (one-of, with "Something else…" when `isOther` is set); your pick must come back to Codex as its answer, and Esc must let the turn go on with an empty answer. A question with no options must ask for a typed line that is not kept in the conversation.
3. Record what Codex really sent (section 3) and replace the mock's `ask` prompt with the recorded request if it differs.

## 3. Record real sessions

```sh
pnpm exec tsx tools/codex/record.ts
```

This drives the real adapter through six scenarios in a throwaway git project and writes, into `packages/agent/test/fixtures/providers/codex/`:

- `real-<scenario>.frames.jsonl`: every JSON-RPC line both ways (`->` Centcom to Codex, `<-` Codex to Centcom), with times;
- `real-<scenario>.events.json`: the normalised events the adapter produced from them;
- `report.md`: per scenario, the methods seen, **the methods the adapter does not know**, the event types produced, approvals asked, and any warnings or errors.

| Scenario | What should happen |
|---|---|
| `hello` | `session.started` (with `login_kind` `subscription` or `api_key`, never `unknown` when signed in), `text.delta`s, `text.done` with the answer, `usage.report`, `turn.done{ok}` |
| `read` | Codex reads `src/a.ts`; you should see `tool.requested` and `tool.result` (no approval needed in the default mode) and an answer naming the value 1 |
| `edit-approve` | a file change request reaches Centcom's gate (`approval.requested`), Centcom says yes, and `src/a.ts` in the temp project changes; then `tool.result{ok}` and `turn.done{ok}` |
| `run-deny` | a command request reaches the gate, Centcom says no, the command does **not** run, the result is `denied`, the turn still ends cleanly |
| `interrupt` | after 4 seconds Centcom sends `turn/interrupt`; the turn ends once with `turn.done{canceled}` well within 10 seconds |
| `resume` | a second session resumes the thread of `hello` (`thread/resume`) and remembers what was asked |

Useful options: `--only <scenario>`, `--turn-ms 300000` for a slow connection, `--bin <path>` for a Codex that is not on PATH.

Read `report.md`. For every scenario that did not behave as in the table, and for every method listed under "methods the adapter does not know", decide whether the adapter should handle it (most `item/*` and `turn/*` notifications should map to something; account and config notifications usually need nothing) and fix `map.ts` / `engine.ts`.

## 4. Turn the recordings into tests

The recordings are the new truth for the adapter:

1. Write `packages/agent/test/codex-real.test.ts` that, for each `real-*.frames.jsonl`, plays the `<-` lines back to the adapter through a tiny fake process (in the style of `fake-codex.mjs`, but reading the file and answering each `->` request with the recorded response with the same position in the sequence), and checks that the events match `real-*.events.json` after dropping `ts`, `seq` and ids.
2. Where the real protocol differs from `fake-codex.mjs`, update the fake so the existing tests in `packages/agent/test/codex.test.ts` describe the real behaviour too.
3. Run `pnpm test` until green.

## 5. Try it by hand

```sh
pnpm centcom --engine codex          # the terminal app on Codex
```

Check, and fix what fails:

- the header shows Codex and your login kind; a first message streams an answer;
- a request to edit a file shows Centcom's approval prompt with the diff; **y** applies it, **n** declines it and Codex carries on;
- a request to run a command shows the command and its risk; denial works;
- **esc** during a long answer stops it within a few seconds, and the next message works. Centcom first sends `turn/interrupt`; if Codex finishes the turn within 3 s nothing is killed (`agent.interrupted` in the log says `method: protocol`). Only if it does not, the app-server's process group gets SIGINT, SIGTERM at 3 s, SIGKILL at 8 s, and the next message starts the app-server again on the same thread (`thread/resume`). Check that real Codex takes the first path, and that **ctrl+c** twice quickly exits with code 130;
- saved conversations: `pnpm centcom --engine codex -c` continues the Codex thread itself (the log at `~/.centcom/sessions/<id>/log.jsonl` has an `engine.session` row with the thread id); continuing a Claude conversation with Codex starts fresh from a summary and says so;
- the context and usage numbers move after each turn (they come from `thread/tokenUsage/updated`);
- `pnpm centcom --engine codex -c` resumes the last conversation, and it is remembered;
- `pnpm centcom --engine codex -p "say hi"` prints the answer and exits 0;
- `pnpm centcom provider status`, `provider doctor` show Codex correctly; `provider logout codex` / `provider login codex` hand over to Codex's own commands (try logout only if you can sign in again).

## 6. Check the other places that assume things about Codex

These were written from Codex's documentation and must be checked against the installed version:

| Where | Assumption | How to check |
|---|---|---|
| `packages/agent/src/sandbox/settings.ts` (`engineSettings`) | `codex exec` takes `--sandbox read-only|workspace-write|danger-full-access` and `--ask-for-approval untrusted|on-request|never`; network off is `-c sandbox_workspace_write.network_access=false`; extra writable folders are `-c sandbox_workspace_write.writable_roots=[...]`; app-server `sandboxPolicy` uses `readOnly`, `workspaceWrite` (with `writableRoots`, `networkAccess`) and `dangerFullAccess` | `codex exec --help`, `codex --help`, the schema from section 2. Then set `caps.codexNetworkOff` / `caps.codexWritableRoots` from what the version supports |
| `packages/agent/src/codex/engine.ts` (`policyFor`) | how Centcom's modes map to `approvalPolicy` and sandbox | run each mode (`shift+tab` in the app) and confirm Codex behaves accordingly (`plan` must not write files) |
| `packages/agent/src/mcp/` | Codex reads MCP servers from `[mcp_servers.<name>]` tables in `config.toml` (`command`, `args`, `env`, `url`, `env_vars`, `env_http_headers`) | `pnpm centcom mcp add test --cmd echo --engine codex --scope project`, then `codex mcp list` in that folder; remove it again |
| `packages/agent/src/memory/` | Codex reads `AGENTS.md` in the project root | add a note with `pnpm centcom memory add "..."` and ask Codex about it |
| `packages/agent/src/hooks/` | the installed Codex documents no hook settings, so the hooks manager says "unsupported" for Codex | if `codex --help` or the docs of this version describe a `notify` setting in `config.toml`, implement editing it in the hooks manager (lane C022) |
| `packages/agent/src/context/` | Codex reports `modelContextWindow`; `compact` is a capability | check that the context meter shows a percentage; try `/compact` |
| `packages/agent/src/fleet/` | several Codex agents can run in parallel in separate worktrees | start two Codex agents with the fleet and check both answer |
| `packages/agent/src/provider/` | version range, `codex login status` classification | `pnpm centcom provider doctor` |

Fix every mismatch in the code and its tests.

## 7. Finish

```sh
pnpm typecheck && pnpm test && pnpm web:build && pnpm plan:check \
  && python3 tools/plan/progress.py --check && pnpm --filter @centcom/protocol gen --check \
  && pnpm exec tsx tools/docs/states-doc.ts --check
```

Then:

- update `plan/STATUS.json` lane `C103` to `1.0` with a note naming the Codex version you tested, and run `python3 tools/plan/progress.py` to refresh the README;
- commit the recordings you read and checked, the new test, and the fixes, to `main`, and push.

## 8. Report back

Leave a short summary at the top of `packages/agent/test/fixtures/providers/codex/report.md` and in the commit message:

- Codex version, operating system;
- which scenarios and manual checks passed first time, which needed fixes, and what the fixes were;
- anything Codex does that Centcom still does not handle, or anything that looks like a Codex bug;
- whether the flags in section 6 are right, and which capability switches (`codexNetworkOff`, `codexWritableRoots`) the version supports.
