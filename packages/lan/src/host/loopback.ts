/** The host's own member, connected to the server through memory instead of a socket: same pipeline, same numbering. It is a `FrameLink`, so the reliable-delivery channel of lane C055 sits on it unchanged. */
import type { Frame } from '@centcom/protocol';
import type { LanClock } from '../clock.js';
export interface LoopbackHost { loopbackSubmit(from: string, f: Frame): void; loopbackWelcome(last: number | null): { welcome: Frame; replay: Frame[] } }
type Ev = { welcome: [Record<string, unknown>]; frame: [Frame]; link: ['online' | 'reconnecting' | 'offline']; closed: [{ code: number; reason: string; willReconnect: boolean }] };
export class LoopbackLink {
  private fns: { [K in keyof Ev]: Set<(...a: Ev[K]) => void> } = { welcome: new Set(), frame: new Set(), link: new Set(), closed: new Set() }; private _welcome: Record<string, unknown> | null = null; private _state = 'idle';
  constructor(private readonly host: LoopbackHost, private readonly member: { id: string }, private readonly clock: LanClock) {}
  get welcome(): never { return this._welcome as never; } get state(): string { return this._state; }
  on<K extends keyof Ev>(ev: K, fn: (...a: Ev[K]) => void): () => void { this.fns[ev].add(fn as never); return () => this.fns[ev].delete(fn as never); }
  private emit<K extends keyof Ev>(ev: K, ...a: Ev[K]): void { for (const f of [...this.fns[ev]]) { try { (f as (...x: Ev[K]) => void)(...a); } catch { /* a listener must not break the host */ } } }
  /** Come online: the welcome, then whatever was missed. */
  connect(lastSeq: number | null = null): Record<string, unknown> { const { welcome, replay } = this.host.loopbackWelcome(lastSeq); this._welcome = welcome.p as Record<string, unknown>; this._state = 'ready'; this.emit('welcome', this._welcome); this.emit('link', 'online'); for (const f of replay) this.emit('frame', f); return this._welcome; }
  async send(f: Omit<Frame, 'v'> & { v?: 1 }): Promise<void> { if (this._state !== 'ready') throw new Error('not connected'); const frame = { ...f, v: 1 } as Frame; queueMicrotask(() => this.host.loopbackSubmit(this.member.id, frame)); void this.clock; }
  /** called by the server for every frame it fans out */ deliver(f: Frame): void { if (this._state === 'ready') this.emit('frame', f); }
  closed(code: number): void { this._state = 'closed'; this.emit('closed', { code, reason: 'host stopped', willReconnect: false }); this.emit('link', 'offline'); }
  reconnect(): void { if (this._state === 'ready') this.connect(null); }
}
