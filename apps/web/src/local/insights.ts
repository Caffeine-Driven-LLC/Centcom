import type { Item } from '@centcom/tui';
import type { WebState } from '../../../desktop/src/local/protocol.js';

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
export interface FileTouch { path: string; edits: number; added: number; removed: number; failed: boolean }
export interface Person { name: string; slot: number; messages: number }
export interface Insights {
  steps: number; failed: number; running: number; commands: number;
  files: FileTouch[]; added: number; removed: number;
  /** People other than this one who wrote in the session (a shared session marks each message with its author). */
  people: Person[];
  plan: { done: number; total: number; current?: string };
  /** The fullest agent context, 0..100, if any agent reports one. */
  context?: number;
  tokens: number; cost: number;
  elapsedS?: number;
}
const countDiff = (diff: string | undefined): { added: number; removed: number } => {
  let added = 0; let removed = 0;
  for (const line of (diff ?? '').split('\n')) { if (line.startsWith('+') && !line.startsWith('+++')) added++; else if (line.startsWith('-') && !line.startsWith('---')) removed++; }
  return { added, removed };
};

/** What the session has done so far, read off the transcript and the agent state. Nothing here is guessed: it only counts what the items and agents say. */
export function insights(items: readonly Item[], state: WebState | undefined, now = Date.now()): Insights {
  const files = new Map<string, FileTouch>(); const people = new Map<string, Person>();
  let steps = 0; let failed = 0; let running = 0; let commands = 0; let added = 0; let removed = 0;
  for (const it of items) {
    if (it.kind === 'user' && it.member) { const p = people.get(it.member.name) ?? { name: it.member.name, slot: it.member.slot, messages: 0 }; p.messages++; people.set(p.name, p); }
    if (it.kind !== 'tool') continue;
    steps++; if (it.status === 'error' || it.status === 'denied') failed++; if (it.status === 'running') running++; if (it.name === 'Bash') commands++;
    if (EDIT_TOOLS.has(it.name) && it.path) {
      const f = files.get(it.path) ?? { path: it.path, edits: 0, added: 0, removed: 0, failed: false };
      const d = countDiff(it.diff); f.edits++; f.added += d.added; f.removed += d.removed; f.failed ||= it.status === 'error' || it.status === 'denied';
      if (it.status === 'ok') { added += d.added; removed += d.removed; }
      files.set(it.path, f);
    }
  }
  const tasks = state?.tasks ?? []; const done = tasks.filter((t) => t.status === 'completed').length;
  const current = tasks.find((t) => t.status === 'in_progress')?.text;
  const agents = state?.agents ?? []; const ctx = agents.map((a) => a.ctxPct).filter((x): x is number => typeof x === 'number');
  const started = state?.busy ? state.turnStartedAt : undefined;
  return {
    steps, failed, running, commands, files: [...files.values()], added, removed, people: [...people.values()],
    plan: { done, total: tasks.length, ...(current ? { current } : {}) },
    ...(ctx.length ? { context: Math.min(100, Math.max(...ctx)) } : {}),
    tokens: agents.reduce((n, a) => n + a.inTok + a.outTok, 0), cost: agents.reduce((n, a) => n + a.cost, 0),
    ...(started ? { elapsedS: Math.max(0, Math.round((now - started) / 1000)) } : {}),
  };
}
export const compactNumber = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export const money = (n: number): string => (n < 0.005 ? '$0.00' : `$${n.toFixed(2)}`);
/** "2m 05s" or "41s". */
export const duration = (s: number): string => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
