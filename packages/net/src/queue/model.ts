/** The queue as every client derives it from sequenced frames (CT-WS-QUEUE). A pure reducer: the same frames in seq order always give the same view. */
export type QueueItemState = 'queued' | 'approved' | 'running' | 'done' | 'failed' | 'canceled' | 'rejected' | 'dropped' | 'held';
export interface QueueItem { id: string; submitter: string; state: QueueItemState; position: number | null; size: number; kind: 'message' | 'command'; body?: string; ts: string; agentId?: string; code?: string }
export interface QueueView { version: number; items: QueueItem[] }
export interface QEvent { kind: string; seq: number; from: string; ts: string; p?: Record<string, unknown>; secret?: Record<string, unknown> }
export interface Ctx { roleOf(member: string): 'host' | 'editor' | 'viewer' | undefined }
export interface Applied { ignored?: string }

type Rec = Omit<QueueItem, 'position' | 'state'> & { state: QueueItemState };
const LIVE = new Set<QueueItemState>(['queued', 'approved', 'running']); const KNOWN = new Set<string>(['queued', 'approved', 'running', 'done', 'failed', 'canceled', 'rejected', 'dropped', 'held']);
const HOST_ONLY = new Set(['queue.approve', 'queue.reject', 'queue.reorder', 'queue.drop', 'queue.claim', 'queue.done']);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export class QueueModel {
  private items = new Map<string, Rec>(); private order: string[] = []; private ver = 0; private paused = false; private lastSeq = 0; private snapshotVersion = 0;
  get version(): number { return this.ver; }
  setPaused(p: boolean): void { this.paused = p; }
  /** The live items in the order they will run: approved ones in approval order (or the host's reorder), then the ones still waiting. */
  private live(): Rec[] { const ids = this.order.filter((i) => LIVE.has(this.items.get(i)?.state ?? 'done')); const rank = (s: QueueItemState) => (s === 'running' ? 0 : s === 'approved' ? 1 : 2); return ids.map((i) => this.items.get(i)!).sort((a, b) => rank(a.state) - rank(b.state) || ids.indexOf(a.id) - ids.indexOf(b.id)); }
  view(): QueueView {
    const live = this.live(); const pos = new Map<string, number>(); let n = 0; for (const it of live) if (it.state !== 'running') pos.set(it.id, n++);
    const items: QueueItem[] = [...this.items.values()].map((r) => ({ ...r, state: this.paused && (r.state === 'approved' || r.state === 'running') ? 'held' : r.state, position: pos.get(r.id) ?? null })).sort((a, b) => this.index(a.id) - this.index(b.id));
    return { version: this.ver, items };
  }
  private index(id: string): number { const i = this.order.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }
  get(id: string): QueueItem | undefined { return this.view().items.find((i) => i.id === id); }
  liveCountOf(member: string): number { return [...this.items.values()].filter((i) => i.submitter === member && LIVE.has(i.state)).length; }
  liveCount(): number { return [...this.items.values()].filter((i) => LIVE.has(i.state)).length; }

  apply(e: QEvent, ctx: Ctx): Applied {
    if (e.seq <= this.lastSeq && e.kind !== 'queue.state') return { ignored: 'old_seq' }; /* a replay of a frame already applied */
    const p = e.p ?? {}; const server = e.from === 'srv';
    if (e.kind === 'queue.state') { if (!server) return { ignored: 'forged_state' }; this.lastSeq = Math.max(this.lastSeq, e.seq); return this.replaceFrom(p); }
    if (!e.kind.startsWith('queue.')) return { ignored: 'not_queue' };
    if (HOST_ONLY.has(e.kind) && !server && ctx.roleOf(e.from) !== 'host') return { ignored: 'not_host' };
    this.lastSeq = Math.max(this.lastSeq, e.seq); const id = str(p.item);
    switch (e.kind) {
      case 'queue.submit': { if (!id || this.items.has(id)) return { ignored: 'duplicate' }; if (ctx.roleOf(e.from) === 'viewer') return { ignored: 'viewer' }; this.items.set(id, { id, submitter: e.from, state: 'queued', size: typeof p.size === 'number' ? p.size : 0, kind: p.kind === 'command' ? 'command' : 'message', ts: e.ts, ...(typeof e.secret?.body === 'string' ? { body: e.secret.body } : {}) }); this.order.push(id); this.ver++; return {}; }
      case 'queue.approve': { const it = id ? this.items.get(id) : undefined; if (!it || it.state !== 'queued') return { ignored: 'bad_transition' }; it.state = 'approved'; this.moveAfterApproved(id!); this.ver++; return {}; }
      case 'queue.reject': { const it = id ? this.items.get(id) : undefined; if (!it || (it.state !== 'queued' && it.state !== 'approved')) return { ignored: 'bad_transition' }; it.state = 'rejected'; if (str(p.code)) it.code = str(p.code); this.ver++; return {}; }
      case 'queue.cancel': { const it = id ? this.items.get(id) : undefined; if (!it || it.submitter !== e.from) return { ignored: it ? 'not_submitter' : 'unknown_item' }; if (it.state !== 'queued' && it.state !== 'approved') return { ignored: 'bad_transition' }; it.state = 'canceled'; this.ver++; return {}; }
      case 'queue.drop': { const it = id ? this.items.get(id) : undefined; if (!it || !LIVE.has(it.state)) return { ignored: 'bad_transition' }; it.state = 'dropped'; this.ver++; return {}; }
      case 'queue.claim': { const it = id ? this.items.get(id) : undefined; if (!it || it.state !== 'approved') return { ignored: 'bad_transition' }; it.state = 'running'; if (str(p.agent_id)) it.agentId = str(p.agent_id); this.ver++; return {}; }
      case 'queue.done': { const it = id ? this.items.get(id) : undefined; if (!it || it.state !== 'running') return { ignored: 'bad_transition' }; it.state = p.outcome === 'ok' ? 'done' : p.outcome === 'canceled' ? 'canceled' : 'failed'; this.ver++; return {}; }
      case 'queue.reorder': { const ord = Array.isArray(p.order) ? p.order.filter((x): x is string => typeof x === 'string' && this.items.has(x)) : []; if (ord.length === 0) return { ignored: 'empty_order' }; const listed = new Set(ord); const rest = this.order.filter((x) => !listed.has(x)); /* listed items go first among the live ones, in the host's order */ const dead = rest.filter((x) => !LIVE.has(this.items.get(x)?.state ?? 'done')); const live = rest.filter((x) => LIVE.has(this.items.get(x)?.state ?? 'done')); this.order = [...dead, ...ord.filter((x) => LIVE.has(this.items.get(x)!.state)), ...live]; this.ver++; return {}; }
      default: return { ignored: 'unknown_kind' };
    }
  }
  /** Approved items queue up in approval order, ahead of those still waiting. */
  private moveAfterApproved(id: string): void {
    this.order = this.order.filter((x) => x !== id); let at = 0; for (let i = 0; i < this.order.length; i++) { const s = this.items.get(this.order[i]!)?.state; if (s === 'approved' || s === 'running') at = i + 1; } this.order.splice(at, 0, id);
  }
  /** `queue.state` from the relay: authoritative, replaces everything when its version is newer than the last one taken from the relay. */
  private replaceFrom(p: Record<string, unknown>): Applied {
    const v = typeof p.version === 'number' ? p.version : -1; if (v <= this.snapshotVersion) return { ignored: 'old_version' }; const items = Array.isArray(p.items) ? p.items : []; this.snapshotVersion = v;
    const next = new Map<string, Rec>(); const order: string[] = [];
    for (const raw of items as Record<string, unknown>[]) { const id = str(raw.item); if (!id) continue; const old = this.items.get(id); const st = KNOWN.has(String(raw.state)) ? (raw.state as QueueItemState) : 'queued'; next.set(id, { id, submitter: str(raw.submitter) ?? old?.submitter ?? '', state: st, size: typeof raw.size === 'number' ? raw.size : old?.size ?? 0, kind: raw.kind === 'command' ? 'command' : 'message', ts: str(raw.ts) ?? old?.ts ?? '', ...(old?.body !== undefined ? { body: old.body } : {}), ...(str(raw.agent_id) ? { agentId: str(raw.agent_id) } : old?.agentId ? { agentId: old.agentId } : {}) }); order.push(id); }
    /* items that finished stay visible with their final state */ for (const [id, r] of this.items) if (!next.has(id) && !LIVE.has(r.state)) { next.set(id, r); order.unshift(id); }
    this.items = next; this.order = order; this.ver = Math.max(this.ver + 1, v); return {};
  }
}
