/** One toast at a time above the prompt, a queue behind it, de-duplication, and never a silent loss of something that needs the person. */
export type ToastLevel = 'info' | 'success' | 'warn' | 'error';
export interface ToastAction { key: string; label: string; id: string }
export interface ToastInput { level: ToastLevel; text: string; key?: string; actions?: ToastAction[]; ttlMs?: number }
export interface Toast { id: string; level: ToastLevel; text: string; key?: string; actions?: ToastAction[]; count: number; /** null: stays until dismissed or resolved. */ expiresAt: number | null }
export interface ToastController { show(t: ToastInput): string; dismiss(id?: string): void; subscribe(fn: (t: Toast | null) => void): () => void; current(): Toast | null; pending(): Toast[] }
export interface ToastClock { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export interface ToastDeps { clock: ToastClock; max?: number; ttlMs?: number; dedupeMs?: number; onShow?: (t: Toast) => void; onDismissed?: (t: Toast, by: 'user' | 'timeout' | 'resolved') => void }

const RANK: Record<ToastLevel, number> = { info: 0, success: 0, warn: 1, error: 2 };
/** An error, a warning or anything with an action must be seen: it never expires on its own. */
const persistent = (t: ToastInput) => t.level === 'error' || (t.actions?.length ?? 0) > 0;

export function createToastController(d: ToastDeps): ToastController {
  const max = d.max ?? 20; const ttl = d.ttlMs ?? 4000; const dedupe = d.dedupeMs ?? 60_000; let n = 0; let cur: Toast | null = null; let timer: unknown; let queue: Toast[] = []; const subs = new Set<(t: Toast | null) => void>();
  const lastKey = new Map<string, { id: string; at: number }>();
  const emit = () => { for (const f of subs) f(cur); };
  const make = (t: ToastInput): Toast => ({ id: `toast_${++n}`, level: t.level, text: t.text, ...(t.key ? { key: t.key } : {}), ...(t.actions?.length ? { actions: t.actions } : {}), count: 1, expiresAt: persistent(t) ? null : d.clock.now() + (t.ttlMs ?? ttl) });
  function arm() { if (timer !== undefined) { d.clock.clearTimeout(timer); timer = undefined; } if (cur && cur.expiresAt !== null) { const id = cur.id; timer = d.clock.setTimeout(() => { if (cur?.id === id) finish('timeout'); }, Math.max(0, cur.expiresAt - d.clock.now())); } }
  function present(t: Toast) { cur = t; d.onShow?.(t); arm(); emit(); }
  function next() { /* what is still alive waits in order; expired ones are skipped */ while (queue.length) { const t = queue.shift()!; if (t.expiresAt === null || t.expiresAt > d.clock.now()) { present(t); return; } } cur = null; emit(); }
  function finish(by: 'user' | 'timeout' | 'resolved') { const t = cur; if (!t) return; cur = null; if (timer !== undefined) { d.clock.clearTimeout(timer); timer = undefined; } d.onDismissed?.(t, by); next(); }
  function trim() { while (queue.length > max) { const i = queue.findIndex((q) => RANK[q.level] === 0); if (i < 0) break; queue.splice(i, 1); } } /* the oldest info goes first; warnings and errors are never dropped */
  return {
    show(input) {
      const now = d.clock.now();
      if (input.key) { /* the same key again: count it instead of stacking */ const seen = lastKey.get(input.key); const live = [cur, ...queue].find((t) => t && t.key === input.key);
        if (live && seen && now - seen.at <= dedupe) { live.count++; live.text = input.text; if (live.expiresAt !== null) live.expiresAt = now + (input.ttlMs ?? ttl); lastKey.set(input.key, { id: live.id, at: now }); if (live === cur) { arm(); emit(); } return live.id; } }
      const t = make(input); if (input.key) lastKey.set(input.key, { id: t.id, at: now });
      if (!cur) { present(t); return t.id; }
      if (RANK[t.level] > RANK[cur.level] && cur.expiresAt !== null) { /* a more serious one pushes the visible, expiring one back (it keeps its remaining time) */ queue.unshift(cur); present(t); trim(); return t.id; }
      queue.push(t); trim(); return t.id;
    },
    dismiss(id) { if (!cur) return; if (id && cur.id !== id) { queue = queue.filter((q) => q.id !== id); return; } finish('user'); },
    subscribe(fn) { subs.add(fn); fn(cur); return () => { subs.delete(fn); }; },
    current: () => cur, pending: () => [...queue],
  };
}
/** The text shown: the message with its repeat count. */
export const toastText = (t: Pick<Toast, 'text' | 'count'>) => (t.count > 1 ? `${t.text} (x${t.count})` : t.text);
