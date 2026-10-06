/** Messages between the browser and the local Centcom server. Everything is JSON over one WebSocket. */
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
  | { t: 'launchApp'; dir?: string; demo?: boolean; engine?: 'claude-code' | 'codex'; resume?: string }
  | { t: 'close' }
  | { t: 'pref'; theme?: Prefs['theme']; side?: boolean }
  | { t: 'submit'; text: string }
  | { t: 'approve'; decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'always' }
  | { t: 'interrupt' }
  | { t: 'setModel'; id: string }
  | { t: 'cycleMode' }
  | { t: 'setMode'; mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' }
  | { t: 'auto'; on: boolean };

/** AppState without the parts that only make sense in a terminal or cannot be serialised. */
export type WebState = Omit<AppState, 'items' | 'approvals' | 'input' | 'cursor' | 'histIdx' | 'draft' | 'scroll' | 'palette' | 'modelSel' | 'gallery' | 'slashSel' | 'mode' | 'history'> & {
  approvals: { id: string; tool: string; summary: string; risk: string; path?: string; command?: string; diff?: string; agentName: string }[];
};

export type ServerMsg =
  | { t: 'launcher'; home: string; cwd: string; recent: RecentDir[]; claude: ClaudeStatus; codex: CodexStatusMsg; app: boolean; prefs: Prefs }
  | { t: 'dir'; path: string; parent: string | null; git: boolean; entries: DirEntry[]; error?: string; saved?: number }
  | { t: 'opened'; dir: string; history: string[] } // prompt history rides along once here, not in every state push
  | { t: 'closed' }
  | { t: 'state'; state: WebState; changed: Item[]; order: string[] }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; text: string };
