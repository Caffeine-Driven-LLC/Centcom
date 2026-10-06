/** Messages between the browser and the local Centcom server. Everything is JSON over one WebSocket. */
import type { AppState, Item } from '@centcom/tui';

export interface DirEntry { name: string; git: boolean }
export interface RecentDir { dir: string; at: number }
export interface ClaudeStatus { installed: boolean; version?: string; signedIn: 'yes' | 'no' | 'unknown'; kind?: string }
export type CodexStatusMsg = ClaudeStatus

export type ClientMsg =
  | { t: 'hello' }
  | { t: 'browse'; path: string }
  | { t: 'open'; dir: string; demo?: boolean; engine?: 'claude-code' | 'codex' }
  | { t: 'launchApp'; dir?: string; demo?: boolean; engine?: 'claude-code' | 'codex' }
  | { t: 'close' }
  | { t: 'submit'; text: string }
  | { t: 'approve'; decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'always' }
  | { t: 'interrupt' }
  | { t: 'setModel'; id: string }
  | { t: 'cycleMode' }
  | { t: 'auto'; on: boolean };

/** AppState without the parts that only make sense in a terminal or cannot be serialised. */
export type WebState = Omit<AppState, 'items' | 'approvals' | 'input' | 'cursor' | 'history' | 'histIdx' | 'draft' | 'scroll' | 'palette' | 'modelSel' | 'gallery' | 'slashSel' | 'mode'> & {
  approvals: { id: string; tool: string; summary: string; risk: string; path?: string; command?: string; diff?: string; agentName: string }[];
};

export type ServerMsg =
  | { t: 'launcher'; home: string; cwd: string; recent: RecentDir[]; claude: ClaudeStatus; codex: CodexStatusMsg; app: boolean }
  | { t: 'dir'; path: string; parent: string | null; git: boolean; entries: DirEntry[]; error?: string }
  | { t: 'opened'; dir: string }
  | { t: 'closed' }
  | { t: 'state'; state: WebState; changed: Item[]; order: string[] }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; text: string };
