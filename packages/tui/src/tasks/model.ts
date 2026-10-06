/** Task lists and progress bars: pure pieces, so they are easy to test and reuse. */
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export interface TaskItem { id: string; text: string; status: TaskStatus }
export interface TaskState { items: TaskItem[] }
export interface TaskUpdate { tasks: { id: string; text: string; status: string }[] }
export const MAX_TASKS = 200;

/** Text from model output: no control characters or escape codes, one line. */
export const cleanText = (s: unknown): string => String(s ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
const status = (s: string): TaskStatus => (s === 'in_progress' || s === 'inProgress' || s === 'in-progress' ? 'in_progress' : s === 'completed' || s === 'done' || s === 'complete' ? 'completed' : 'pending');
/** Replace-all: the agent sends its whole list every time. Order is kept; a repeated id keeps its first place and its last text and status. At most 200 items. */
export function reduceTasks(_state: TaskState, update: TaskUpdate): TaskState {
  const byId = new Map<string, TaskItem>(); for (const t of update?.tasks ?? []) { const id = cleanText(t?.id) || `t${byId.size + 1}`; byId.set(id, { id, text: cleanText(t?.text), status: status(String(t?.status ?? '')) }); }
  return { items: [...byId.values()].slice(0, MAX_TASKS) };
}

/** A determinate bar of `cells` cells. */
export function renderBar(value: number, cells: number, unicode = true): string { const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0; const f = Math.round(v * cells); return (unicode ? '█' : '#').repeat(f) + (unicode ? '░' : '-').repeat(cells - f); }
export const percent = (value: number) => `${Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100)} %`;
export const barLine = (value: number, cells: number, unicode = true) => (unicode ? `▕${renderBar(value, cells)}▏ ${percent(value)}` : `[${renderBar(value, cells, false)}] ${percent(value)}`);
/** The sliding block of an indeterminate bar at `tick` (80 ms each): moves one cell per tick and bounces at both ends. Always `cells` wide. */
export function indeterminateFrame(tick: number, cells = 12, block = 6, unicode = true): string {
  const b = Math.min(block, cells); const span = cells - b; const period = Math.max(1, span * 2); const t = ((tick % period) + period) % period; const pos = span === 0 ? 0 : t <= span ? t : period - t;
  const empty = unicode ? '░' : '-'; const full = unicode ? '▓' : '#'; return empty.repeat(pos) + full.repeat(b) + empty.repeat(cells - b - pos);
}
/** Which rows a task list shows: at most `maxRows` items, always including the one in progress, and how many are hidden. */
export function visibleTasks(items: TaskItem[], maxRows = 10): { shown: TaskItem[]; hidden: number } {
  if (items.length <= maxRows) return { shown: items, hidden: 0 };
  const rows = Math.max(1, maxRows); const ip = items.findIndex((t) => t.status === 'in_progress'); let start = 0;
  if (ip >= rows) start = Math.min(items.length - rows, ip - Math.floor(rows / 2));
  return { shown: items.slice(start, start + rows), hidden: items.length - rows };
}
export const truncate = (s: string, width: number) => (width <= 0 ? '' : s.length <= width ? s : width === 1 ? '…' : s.slice(0, width - 1) + '…');
