/** Messages between the app's screens and the local session service in the main process. Plain objects over Electron IPC. */
import type { AppState, Item } from '@centcom/tui';

export interface DirEntry { name: string; git: boolean }
export interface RecentDir { dir: string; at: number }
export interface ClaudeStatus { installed: boolean; version?: string; signedIn: 'yes' | 'no' | 'unknown'; kind?: string }
export type CodexStatusMsg = ClaudeStatus

export interface Prefs { theme: 'auto' | 'dark' | 'light'; side: boolean; engine: 'claude-code' | 'codex' }

export type ClientMsg =
  | { t: 'hello' }
  | { t: 'browse'; path: string }
  | { t: 'open'; dir: string; demo?: boolean; engine?: 'claude-code' | 'codex'; resume?: string }
  | { t: 'close' }
  /** Go back to the project list; the agent keeps running in the background. */
  | { t: 'leave' }
  | { t: 'pref'; theme?: Prefs['theme']; side?: boolean }
  | { t: 'submit'; text: string }
  | { t: 'approve'; decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'always' }
  | { t: 'interrupt' }
  | { t: 'setModel'; id: string }
  | { t: 'cycleMode' }
  | { t: 'setMode'; mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' }
  | { t: 'models' }
  | { t: 'setEffort'; effort: string }
  | { t: 'compact' }
  | { t: 'board' }
  | { t: 'note'; type: 'decision' | 'warning' | 'finding'; text: string }
  | { t: 'notePin'; id: string; pinned: boolean }
  | { t: 'noteRemove'; id: string }
  | { t: 'auto'; on: boolean };

/** AppState without the parts that only make sense in a terminal or cannot be serialised. */
export type WebState = Omit<AppState, 'items' | 'approvals' | 'input' | 'cursor' | 'histIdx' | 'draft' | 'scroll' | 'palette' | 'modelSel' | 'gallery' | 'slashSel' | 'mode' | 'history'> & {
  approvals: { id: string; tool: string; summary: string; risk: string; path?: string; command?: string; diff?: string; agentName: string }[];
};

/** One agent session that is alive in the main process, whether or not a window is showing it. */
export interface RunningSession { dir: string; engine: 'claude-code' | 'codex'; demo: boolean; busy: boolean; /** Approvals waiting for a person. */ waiting: number; /** What the first waiting approval asks for. */ ask?: string }

/** One entry of the context board (docs/context-sharing.md), as the screen needs it. */
export interface BoardNote { id: string; type: string; text: string; author: string; person: boolean; pinned: boolean; ts: number; files: string[] }

export type ServerMsg =
  | { t: 'launcher'; home: string; cwd: string; recent: RecentDir[]; claude: ClaudeStatus; codex: CodexStatusMsg; prefs: Prefs }
  | { t: 'dir'; path: string; parent: string | null; git: boolean; entries: DirEntry[]; error?: string; saved?: number }
  | { t: 'opened'; dir: string; history: string[]; engine?: 'claude-code' | 'codex'; demo?: boolean } // prompt history rides along once here, not in every state push
  | { t: 'closed' }
  | { t: 'state'; state: WebState; changed: Item[]; order: string[] }
  | { t: 'models'; models: { id: string; label: string; note: string; efforts?: string[]; defaultEffort?: string; isDefault?: boolean }[] }
  /** Every installed agent's models, for the one model menu: choosing another agent's model switches to it. */
  | { t: 'engineModels'; engines: { engine: 'claude-code' | 'codex'; models: { id: string; label: string; note: string; efforts?: string[]; defaultEffort?: string; isDefault?: boolean }[] }[] }
  | { t: 'running'; sessions: RunningSession[] }
  /** The board of the shown session; `enabled` is false when `context.board` is off. */
  | { t: 'board'; enabled: boolean; notes: BoardNote[] }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; text: string };
