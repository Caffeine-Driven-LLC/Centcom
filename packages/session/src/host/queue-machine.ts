/** The command-post queue as the host's authority sees it (CT-WS-QUEUE): the checks before a frame is accepted, and the state it leads to. */
export type QState = 'queued' | 'approved' | 'running' | 'done' | 'failed' | 'canceled' | 'rejected' | 'dropped' | 'held';
export interface QItem { item: string; submitter: string; state: QState; size: number; kind: string; ts: string; agent_id?: string }
export const MAX_ITEM_BYTES = 196_608; export const MEMBER_CAP = 5; export const DEFAULT_LIMIT = 20;
export type QCheck = { ok: true } | { ok: false; code: 'forbidden' | 'queue_full' | 'queue_item_gone' | 'invalid_frame' | 'payload_too_large' | 'queue_not_allowed'; noop?: boolean };
const LIVE = new Set<QState>(['queued', 'approved', 'running', 'held']);
export class QueueMachine {
  private items = new Map<string, QItem>(); private order: string[] = []; version = 0; held = false;
  constructor(private readonly limit: () => number) {}
  get(id: string): QItem | undefined { return this.items.get(id); }
  live(): QItem[] { return [...this.items.values()].filter((i) => LIVE.has(i.state)); }
  view(): { version: number; items: Record<string, unknown>[] } {
    const live = this.order.map((i) => this.items.get(i)!).filter((i) => i && LIVE.has(i.state)); const rank = (s: QState) => (s === 'running' ? 0 : s === 'approved' || s === 'held' ? 1 : 2); live.sort((a, b) => rank(a.state) - rank(b.state) || this.order.indexOf(a.item) - this.order.indexOf(b.item)); let pos = 0;
    return { version: this.version, items: live.map((i) => ({ item: i.item, submitter: i.submitter, state: this.held && (i.state === 'approved' || i.state === 'running') ? 'held' : i.state === 'held' ? 'approved' : i.state, position: i.state === 'running' ? null : pos++, size: i.size, kind: i.kind, ts: i.ts, ...(i.agent_id ? { agent_id: i.agent_id } : {}) })) };
  }
  /** Checks only; nothing changes until `apply`. */
  check(kind: string, from: string, p: Record<string, unknown>, o: { paused: boolean }): QCheck {
    const id = typeof p.item === 'string' ? p.item : undefined; const it = id ? this.items.get(id) : undefined;
    switch (kind) {
      case 'queue.submit': { if (!id) return { ok: false, code: 'invalid_frame' }; if (it) return { ok: false, code: 'forbidden', noop: true }; if (typeof p.size === 'number' && p.size > MAX_ITEM_BYTES) return { ok: false, code: 'payload_too_large' }; const live = this.live(); if (live.filter((i) => i.submitter === from).length >= MEMBER_CAP || live.length >= this.limit()) return { ok: false, code: 'queue_full' }; return { ok: true }; }
      case 'queue.cancel': { if (!it) return { ok: false, code: 'queue_item_gone' }; if (it.submitter !== from) return { ok: false, code: 'forbidden' }; return it.state === 'queued' || it.state === 'approved' ? { ok: true } : { ok: false, code: 'queue_item_gone' }; }
      case 'queue.approve': { if (o.paused) return { ok: false, code: 'queue_not_allowed' }; return it && it.state === 'queued' ? { ok: true } : { ok: false, code: 'queue_item_gone' }; }
      case 'queue.claim': { if (o.paused) return { ok: false, code: 'queue_not_allowed' }; return it && it.state === 'approved' ? { ok: true } : { ok: false, code: 'queue_item_gone' }; }
      case 'queue.reject': case 'queue.drop': return it && LIVE.has(it.state) && it.state !== 'running' ? { ok: true } : { ok: false, code: 'queue_item_gone' };
      case 'queue.done': return it && it.state === 'running' ? { ok: true } : { ok: false, code: 'queue_item_gone' };
      case 'queue.reorder': return Array.isArray(p.order) && p.order.every((x) => typeof x === 'string') ? { ok: true } : { ok: false, code: 'invalid_frame' };
      default: return { ok: true };
    }
  }
  apply(kind: string, from: string, p: Record<string, unknown>, ts: string): boolean {
    const id = typeof p.item === 'string' ? p.item : ''; const it = this.items.get(id);
    switch (kind) {
      case 'queue.submit': this.items.set(id, { item: id, submitter: from, state: 'queued', size: Number(p.size ?? 0), kind: String(p.kind ?? 'message'), ts }); this.order.push(id); break;
      case 'queue.cancel': if (it) it.state = 'canceled'; break;
      case 'queue.approve': if (it) { it.state = 'approved'; this.order = this.order.filter((x) => x !== id); let at = 0; this.order.forEach((x, i) => { const s = this.items.get(x)?.state; if (s === 'approved' || s === 'running') at = i + 1; }); this.order.splice(at, 0, id); } break;
      case 'queue.claim': if (it) { it.state = 'running'; it.agent_id = String(p.agent_id ?? ''); } break;
      case 'queue.done': if (it) it.state = p.outcome === 'ok' ? 'done' : p.outcome === 'canceled' ? 'canceled' : 'failed'; break;
      case 'queue.reject': if (it) it.state = 'rejected'; break; case 'queue.drop': if (it) it.state = 'dropped'; break;
      case 'queue.reorder': { const ord = (p.order as string[]).filter((x) => this.items.has(x)); const set = new Set(ord); this.order = [...this.order.filter((x) => !set.has(x) && !LIVE.has(this.items.get(x)?.state ?? 'done')), ...ord.filter((x) => LIVE.has(this.items.get(x)!.state)), ...this.order.filter((x) => !set.has(x) && LIVE.has(this.items.get(x)?.state ?? 'done'))]; break; }
      default: return false;
    }
    this.version++; return true;
  }
  /** The host is gone: approved and running items show as held. */
  setHostAway(away: boolean): boolean { if (this.held === away) return false; this.held = away; this.version++; return true; }
}
