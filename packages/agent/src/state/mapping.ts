/** The data behind the state machine: which normalised event becomes which contract state (CT-STATE-MAP). `docs/agent-states.md` is generated from this table. */
import type { AgentWireState } from '@centcom/protocol';

/** The machine also produces these two for the UI. They are contract state names but not in the agent-level list, so they never go on the wire. */
export type MachineState = AgentWireState | 'prompt-received' | 'sleeping';
export type ToolKind = 'read' | 'search' | 'web' | 'edit' | 'create' | 'delete' | 'command' | 'subagent' | 'background' | 'mcp' | 'other';

export const TOOL_KIND_STATE: Record<ToolKind, AgentWireState> = {
  read: 'reading-file', search: 'searching', web: 'searching', edit: 'editing-file', create: 'creating-file', delete: 'deleting-file',
  command: 'running-command', subagent: 'sub-agent', background: 'background-task', mcp: 'tool-running', other: 'tool-running',
};

/** Tool names are the only thing the engines tell us; both engines' names are covered, anything else is `other` (shown as tool-running). */
const NAME_RULES: [RegExp, ToolKind][] = [
  [/^(read|notebookread|view|read_file|readfile)$/i, 'read'], [/^(glob|grep|ls|search|find|list_files|codebase_search)$/i, 'search'], [/^(websearch|webfetch|web_search|web_fetch|fetch)$/i, 'web'],
  [/^(edit|multiedit|notebookedit|apply_patch|applypatch|str_replace|patch)$/i, 'edit'], [/^(write|create|create_file|write_file)$/i, 'create'], [/^(delete|remove|rm)$/i, 'delete'],
  [/^(bash|shell|exec|run_command|local_shell|command)$/i, 'command'], [/^(task|agent|subagent)$/i, 'subagent'], [/^(bashoutput|killshell|killbash|background)$/i, 'background'], [/^mcp__/i, 'mcp'],
];
const READ_CMD = /^\s*(cat|head|tail|less|more|bat|nl|wc|stat|file)\b/; const SEARCH_CMD = /^\s*(ls|tree|find|grep|egrep|rg|ag|fd|git (grep|ls-files|log|show|blame))\b/; const DELETE_CMD = /^\s*(rm|rmdir|unlink|git (rm|clean))\b/;

/** Shell tools are looked at once more: `cat file` is a read, `rg x` is a search, `rm x` is a delete. Anything else stays a command. */
export function toolKind(name: string, command?: string): ToolKind {
  const hit = NAME_RULES.find(([re]) => re.test(name))?.[1] ?? 'other';
  if (hit !== 'command' || !command) return hit;
  const first = command.trim().split(/\s*(?:&&|\|\||;|\|)\s*/)[0] ?? '';
  if (DELETE_CMD.test(first)) return 'delete'; if (READ_CMD.test(first)) return 'read'; if (SEARCH_CMD.test(first)) return 'search'; return 'command';
}

/** Dwell times of the transient states, and the two silence timers. */
export const DWELL_MS = { 'prompt-received': 600, approved: 800, denied: 800, success: 2000, error: 2000, warning: 2000, 'tests-pass': 2000, 'tests-fail': 2000, 'merge-conflict': 2000, saving: 2000 } as const;
export const THINKING_HARD_MS = 15_000; export const SLEEP_MS = 15 * 60_000;

export interface TableRow { input: string; state: MachineState | string; note?: string }
/** Same rules the reducer applies, as data, for the docs and for tests. */
export const EVENT_STATE_TABLE: readonly TableRow[] = [
  { input: 'turn.started', state: 'prompt-received', note: '600 ms, then the state below' },
  { input: 'thinking.delta', state: 'thinking', note: 'planning in plan mode; thinking-hard after 15 s without output' },
  { input: 'text.delta', state: 'streaming' },
  ...(Object.entries(TOOL_KIND_STATE) as [ToolKind, AgentWireState][]).map(([k, s]) => ({ input: `tool.requested (${k})`, state: s, note: k === 'other' ? 'also any unknown tool' : undefined })),
  { input: 'tool.result', state: '(previous open tool, else thinking)', note: 'tests-pass / tests-fail when the command was a test run' },
  { input: 'subagent.started', state: 'sub-agent' },
  { input: 'approval.requested', state: 'awaiting-approval', note: 'stays until every open approval is resolved; no other event (warning, error, compaction, tool, text, merge-conflict, saving, a dwell timer) displaces it. Only approval.resolved, turn.done, interrupt and exit leave it' },
  { input: 'approval.resolved (approve)', state: 'approved', note: '800 ms, then back to work' },
  { input: 'approval.resolved (deny)', state: 'denied', note: '800 ms, then back to work' },
  { input: 'question.asked', state: 'asking-question', note: 'stays until the next work event' },
  { input: 'compaction.started', state: 'compacting', note: 'until compaction.ended' },
  { input: 'turn.done (ok)', state: 'success', note: '2 s, then idle' }, { input: 'turn.done (error)', state: 'error', note: '2 s, then idle' }, { input: 'turn.done (canceled)', state: 'idle' },
  { input: 'engine.warning', state: 'warning', note: '2 s, then back to work' },
  { input: 'error (provider_cap_reached / provider_rate_limited)', state: 'warning', note: 'plus a local hint for the UI; the wire state stays warning' },
  { input: 'error (fatal, other)', state: 'error' },
  { input: 'signal: exited crash', state: 'crash', note: 'the machine then ignores everything' }, { input: 'signal: interrupt', state: 'idle' },
  { input: 'signal: merge_conflict / saving', state: 'merge-conflict / saving', note: '2 s' },
  { input: 'idle for 15 min', state: 'sleeping', note: 'any turn.started wakes it' },
];
