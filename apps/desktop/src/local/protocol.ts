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
  | { t: 'auto'; on: boolean }
  /** Who is signed in (nothing is needed for local sessions). */
  | { t: 'account' }
  /** The Team panel: load it, invite by e-mail with a role, revoke an invite, change a role, remove a member, and where to upgrade the plan. */
  | { t: 'team' }
  | { t: 'teamInvite'; email: string; role: 'admin' | 'member' | 'billing' | 'guest' }
  | { t: 'teamRevoke'; invite: string }
  | { t: 'teamRole'; member: string; role: 'admin' | 'member' | 'billing' | 'guest' }
  | { t: 'teamRemove'; member: string }
  | { t: 'upgrade' }
  | { t: 'login' }
  | { t: 'cancelLogin' }
  | { t: 'logout' }
  /** Sharing the shown conversation over the relay (needs a sign-in and a plan with the relay). */
  | { t: 'share' }
  | { t: 'unshare' }
  | { t: 'shareLink' }
  | { t: 'shareInvite'; email?: string }
  | { t: 'shareDecide'; item: string; decision: 'approve' | 'reject' }
  | { t: 'shareAuto'; on: boolean }
  /** Joining somebody else's session: paste an id or a link. */
  | { t: 'join'; input: string }
  | { t: 'joinedAsk'; text: string }
  | { t: 'joinedLeave' };

/** AppState without the parts that only make sense in a terminal or cannot be serialised. */
export type WebState = Omit<AppState, 'items' | 'approvals' | 'input' | 'cursor' | 'histIdx' | 'draft' | 'scroll' | 'palette' | 'modelSel' | 'gallery' | 'slashSel' | 'mode' | 'history'> & {
  approvals: { id: string; tool: string; summary: string; risk: string; path?: string; command?: string; diff?: string; agentName: string }[];
};

/** One agent session that is alive in the main process, whether or not a window is showing it. */
export interface RunningSession { dir: string; engine: 'claude-code' | 'codex'; demo: boolean; busy: boolean; /** Approvals waiting for a person. */ waiting: number; /** What the first waiting approval asks for. */ ask?: string }

/** One entry of the context board (docs/context-sharing.md), as the screen needs it. */
export interface BoardNote { id: string; type: string; text: string; author: string; person: boolean; pinned: boolean; ts: number; files: string[] }

/** The signed-in person, as the screens show them. */
export interface TeamViewMsg { workspace: { id: string; name: string | null }; plan: string; status: string; seats: { used: number; max: number | null }; relayAccess: boolean; myRole: string; canManage: boolean; members: { id: string; name: string; email?: string; role: string; you: boolean }[]; invites: { id: string; email: string | null; role: string; expiresAt: string }[] }
export interface AccountView { signedIn: boolean; persisted: boolean; offline?: boolean; api: string; me?: { id: string; name: string; email: string; plan: string; workspace?: { id: string; name: string | null } } }
/** A conversation that is being shared: who is in it, what editors asked for, the link. */
export interface SharingView {
  state: 'starting' | 'live' | 'ended' | 'failed'; sessionId?: string; name: string; workspace?: string;
  /** why it is not live, in words for the person */ error?: string; code?: string;
  /** a view-only link (the key is in its fragment: it is a secret) */ link?: { url: string; expiresAt: string };
  /** an invite link for the workspace */ invite?: { url: string; email?: string };
  /** a note on what could not be done and what to do instead */ hint?: string;
  auto: boolean; members: { id: string; name: string; slot: number; role: 'host' | 'editor' | 'viewer'; online: boolean; you: boolean }[];
  pending: { item: string; from: string; slot: number; text: string }[];
}
/** Somebody else's session that this window joined: what happened in it, who is there, what you may do. */
export interface JoinedView {
  state: 'joining' | 'live' | 'ended' | 'failed'; sessionId?: string; how?: 'invite' | 'session' | 'watch'; role?: 'host' | 'editor' | 'viewer'; error?: string;
  /** waiting for the host's key, or reconnecting */ phase?: string;
  people: { id: string; name: string; slot: number; role: 'host' | 'editor' | 'viewer'; you: boolean; online: boolean }[];
  /** what is in the transcript (the last 300 entries) */
  entries: { id: string; kind: 'user' | 'assistant' | 'system' | 'tool' | 'approval'; who?: string; slot?: number; text: string; done?: boolean; status?: string }[];
  /** what you asked for that the host has not run yet */ asked: { item: string; text: string; state: string }[];
}
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
  | { t: 'account'; account: AccountView }
  /** The Team panel's content, or why it could not be loaded; `done` says what the last change did (and `link` is an invite to send by hand). */
  | { t: 'team'; team?: TeamViewMsg; error?: string; done?: string; link?: string }
  | { t: 'upgrade'; url: string }
  | { t: 'sharing'; sharing: SharingView | null }
  | { t: 'joined'; joined: JoinedView | null }
  /** The sign-in dialog: `code` is shown with the address to open, then `done`, or why it ended. */
  | { t: 'login'; phase: 'code'; userCode: string; url: string; expiresInS: number; opened: boolean }
  | { t: 'login'; phase: 'done' | 'cancelled' }
  | { t: 'login'; phase: 'failed'; error: string }
  /** The board of the shown session; `enabled` is false when `context.board` is off. */
  | { t: 'board'; enabled: boolean; notes: BoardNote[] }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; text: string };
