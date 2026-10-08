import type { ApprovalDecision, ApprovalRequest, EngineId, LoginKind, PermissionMode, Risk } from '@centcom/agent';
import type { CentoColor, MiniState } from '@centcom/mascot';
import type { SessionMeta } from '../sessions.js';

export type Mode = 'chat' | 'palette' | 'help' | 'gallery' | 'fleet' | 'models' | 'night' | 'pick';
export type MascotSize = 'large' | 'small' | 'off';

export interface AgentView {
  id: string; name: string; color: CentoColor; mine: boolean; engine: string; provider: string; model: string; loginKind: LoginKind;
  state: string; mini: MiniState; busy: boolean; branch: string; runsOn: string; cost: number; inTok: number; outTok: number; ctxPct?: number; ctxTokens?: number; ctxWindow?: number; note?: string;
}

export type Item =
  | { kind: 'user'; id: string; text: string; ts: number; /** Someone else in a shared session (slot = their colour). */ member?: { name: string; slot: number } }
  | { kind: 'assistant'; id: string; messageId: string; agentId: string; text: string; done: boolean; /** The turn was stopped: this is what came before it (lane C030). */ interrupted?: boolean }
  | { kind: 'thinking'; id: string; messageId: string; agentId: string; text: string; ms: number; done: boolean }
  | { kind: 'tool'; id: string; toolId: string; agentId: string; name: string; summary: string; risk: Risk; status: 'running' | 'ok' | 'error' | 'denied' | 'canceled'; result?: string; diff?: string; approval?: 'pending' | 'approved' | 'denied'; path?: string; command?: string; startedAt: number }
  | { kind: 'notice'; id: string; level: 'info' | 'warn' | 'error' | 'ok'; text: string; detail?: string };

export interface Toast { id: string; level: 'info' | 'ok' | 'warn' | 'error'; text: string; until: number }

export interface PendingApproval { req: ApprovalRequest; agentName: string; color: CentoColor; resolve: (d: ApprovalDecision) => void; confirmHigh: boolean }

export interface Settings { theme: 'dark' | 'light' | 'hc'; mascot: MascotSize | 'auto'; permissionMode: PermissionMode; reducedMotion: boolean; color: CentoColor; autoSkills: boolean; model: string; /** Mouse wheel scrolls the transcript; off gives the terminal's own text selection back. */ mouse: boolean }

export interface AppState {
  items: Item[];
  agents: AgentView[];
  activeAgent: string;
  mode: Mode;
  input: string; cursor: number; /** The other end of the selection in the prompt (the cursor is one end). */ anchor?: number;
  history: string[]; histIdx: number | null; draft: string;
  scroll: number;
  toasts: Toast[];
  approvals: PendingApproval[];
  settings: Settings;
  busy: boolean; turnStartedAt?: number; verb: string;
  limits: { name: string; utilization: number; resets_at: number }[];
  cwd: string; branch: string;
  engineId: EngineId; engineLabel: string; demo: boolean;
  fleet: boolean;
  /** The agent's plan (TodoWrite / Codex plan) and whether the panel above the prompt is open (ctrl+t). */
  tasks: import('../tasks/model.js').TaskItem[]; tasksOpen: boolean;
  slashSel: number;
  palette: { query: string; sel: number };
  /** The open multi-select (mode 'pick'). */
  pick?: import('../pick/model.js').PickState;
  modelSel: number;
  gallery: { cat: number; idx: number; color: number; query: string };
  exitArmedAt?: number;
  /** The saved conversation this one is written to, and recent saved ones in this folder. */
  sessionId: string; sessions: SessionMeta[];
  version: string;
  /** The night cycle: tasks worked through unattended. */
  night: import('../night/model.js').NightState;
}

export const initialSettings = (): Settings => ({ theme: 'dark', mascot: 'auto', permissionMode: 'default', reducedMotion: false, color: 'violet', autoSkills: true, model: '', mouse: true });

export function stateToMini(state: string): MiniState {
  switch (state) {
    case 'thinking': case 'thinking-hard': case 'planning': case 'prompt-received': return 'thinking';
    case 'streaming': case 'reading-file': case 'editing-file': case 'creating-file': case 'running-command': case 'tool-running': case 'searching': case 'compacting': case 'sub-agent': case 'deleting-file': case 'background-task': return 'working';
    case 'awaiting-approval': case 'asking-question': return 'waiting';
    case 'error': case 'crash': case 'provider-auth-required': case 'provider-cap-reached': case 'provider-policy-blocked': case 'denied': return 'error';
    case 'success': case 'approved': case 'celebrate': return 'done';
    case 'sleeping': case 'away': return 'sleeping';
    default: return 'idle';
  }
}
export const isBusyState = (s: string) => !['idle', 'ready', 'success', 'sleeping', 'away', 'error', 'crash', 'denied', 'approved', 'celebrate', 'provider-auth-required', 'provider-cap-reached', 'provider-policy-blocked'].includes(s);
