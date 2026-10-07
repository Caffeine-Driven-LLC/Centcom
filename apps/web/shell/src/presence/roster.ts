/** The roster as the session's control frames tell it. A newer full roster wins over anything partial; a presence frame for someone not yet known waits up to 10 s. */
export interface Member { id: string; name: string; slot: number; role: 'host' | 'editor' | 'viewer'; connected: boolean }
export interface CtlFrame { kind: string; from: string; p?: Record<string, unknown>; seq?: number }
export const SERVER = 'srv'; export const HOLD_MS = 10_000;
const str = (v: unknown): string => (typeof v === 'string' ? v : ''); const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const role = (v: unknown): Member['role'] => (v === 'host' || v === 'editor' ? v : 'viewer');
export class RosterStore {
  private m = new Map<string, Member>(); private version = 0; private fns = new Set<(e: { type: 'joined' | 'left'; member: Member }) => void>(); private held = new Map<string, { at: number; frames: unknown[] }>();
  constructor(private readonly now: () => number = Date.now) {}
  list(): Member[] { return [...this.m.values()].sort((a, b) => a.slot - b.slot); } get(id: string): Member | undefined { return this.m.get(id); } host(): Member | undefined { return this.list().find((x) => x.role === 'host'); }
  onChange(f: (e: { type: 'joined' | 'left'; member: Member }) => void): () => void { this.fns.add(f); return () => { this.fns.delete(f); }; }
  private emit(type: 'joined' | 'left', member: Member): void { for (const f of [...this.fns]) { try { f({ type, member }); } catch { /* a listener must not break the roster */ } } }
  /** Control frames from anyone but the server are ignored for the server-only kinds. */
  apply(f: CtlFrame): void {
    const p = f.p ?? {}; const fromServer = f.from === SERVER;
    switch (f.kind) {
      case 'control.roster': { if (!fromServer) return; const v = num(p.version); if (v < this.version) return; this.version = v; const next = new Map<string, Member>(); for (const raw of Array.isArray(p.members) ? p.members : []) { const x = raw as Record<string, unknown>; const id = str(x.id); if (id) next.set(id, { id, name: str(x.name) || 'Someone', slot: num(x.slot), role: role(x.role), connected: x.connected !== false }); } this.m = next; return; }
      case 'control.member_joined': { if (!fromServer) return; const id = str(p.member); if (!id) return; const known = this.m.has(id); const mem: Member = { id, name: str(p.name) || 'Someone', slot: num(p.slot), role: role(p.role), connected: true }; this.m.set(id, mem); if (!known) this.emit('joined', mem); return; }
      case 'control.member_left': { if (!fromServer) return; const id = str(p.member); const mem = this.m.get(id); if (!mem) return; this.m.delete(id); this.emit('left', mem); return; }
      case 'control.role': { const t = this.m.get(str(p.member)); if (t && f.from === this.host()?.id) t.role = role(p.role); return; }
      case 'control.host_changed': { if (!fromServer) return; const h = str(p.host); for (const x of this.m.values()) x.role = x.id === h ? 'host' : x.role === 'host' ? 'editor' : x.role; return; }
      default: return;
    }
  }
  /** Is this sender someone we know? If not, remember that we heard from them; after 10 s they are dropped. */
  known(id: string): boolean { if (this.m.has(id)) { this.held.delete(id); return true; } const h = this.held.get(id); const now = this.now(); if (!h) this.held.set(id, { at: now, frames: [] }); else if (now - h.at > HOLD_MS) this.held.delete(id); return false; }
  heldCount(): number { const now = this.now(); for (const [k, h] of this.held) if (now - h.at > HOLD_MS) this.held.delete(k); return this.held.size; }
}
