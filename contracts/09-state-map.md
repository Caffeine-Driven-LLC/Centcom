# 09 · Product states

Contract in this file: **CT-STATE-MAP**

`state-map.json` (next to this file) is the contract. Keys are **product state names** (kebab-case); values are the names of mascot animations that the client plays for that state.

## Who owns what

| Part | Owner | Rule |
|---|---|---|
| The **set of state names** (keys) | Contract | Adding a state is a minor contract change. Removing/renaming is breaking |
| The **animation** each state plays (values) | Client / design | Free to change without a contract change; clients ship their own copy of the map in the theme package |
| `agent.state.state` on the wire | Both | MUST be one of the keys. The backend validates the enum, never invents states |

## Categories (informational)

`idle`/`ready`/`sleeping`/`away` · work (`thinking`, `planning`, `searching`, `reading-file`, `editing-file`, `creating-file`, `deleting-file`, `running-command`, `tool-running`, `streaming`, `compacting`, `background-task`, `sub-agent`) · human-needed (`awaiting-approval`, `asking-question`, `approved`, `denied`) · outcome (`success`, `celebrate`, `error`, `crash`, `warning`, `tests-pass`, `tests-fail`, `ci-*`, `pr-*`) · connectivity/account (`offline`, `reconnecting`, `online`, `auth-required`, `session-expired`) · limits (`rate-limited`, `quota-reached`, `cost-alert`, `context-full`) · social (`host-session`, `teammate-*`, `message-queued`, `handoff`, `pair-working`, `high-five`, `welcome-teammate`) · lifecycle (`first-run`, `empty`, `no-results`, `update-available`, `saving`, `deploying`, `merge-conflict`).

Which of these travel on the wire as **agent** state (`agent.state`): everything in *idle, work, human-needed, outcome (agent-level)*, `merge-conflict`, `deploying`, `saving`. The rest are **client-local** UI states (connectivity, account, limits, social) that the client derives itself; the backend never sends them as agent states (it uses `sys.notice` for limits).

## Agent-level states (what a client emits in `agent.state`)

`idle`, `ready`, `thinking`, `thinking-hard`, `planning`, `searching`, `reading-file`, `editing-file`, `creating-file`, `deleting-file`, `running-command`, `tool-running`, `streaming`, `compacting`, `background-task`, `sub-agent`, `awaiting-approval`, `asking-question`, `approved`, `denied`, `success`, `error`, `crash`, `warning`, `tests-pass`, `tests-fail`, `merge-conflict`, `deploying`, `saving`.

The relay validates `agent.state.state` against **all** keys of `state-map.json` (tolerant); clients emit only the list above. All other keys (connectivity, account, limits, social, lifecycle such as `first-run`, `empty`, `celebrate`, `ci-*`, `pr-*`, `listening`, `prompt-received`, `host-session`) are client-local UI states, never sent as agent state. `since` is the ISO time the state started.

## Rules
1. Receivers tolerate unknown state names (show generic "working").
2. State changes are rate-limited at the source: ≤ 2 `agent.state` frames per agent per second; identical consecutive states are not re-sent.
3. A state name is **not** user-facing copy; clients map it to text through their message table.
