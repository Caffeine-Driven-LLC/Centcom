/** In this process only: the host's own member talking to a LAN host server through memory. No sockets, no network. */
import { LanHostServer, LoopbackLink } from '@centcom/lan';
import type { Welcome } from '@centcom/net';
import { assertWritableFrame, type Frame } from '@centcom/protocol';
import type { SessionTransport, TransportCapabilities, TransportEvents } from './types.js';
const CAPS: TransportCapabilities = { durableHistory: false, restSnapshots: false, lanSnapshots: false, entitlements: false, failover: false, auditLog: false, lanUpgrade: false, maxMembers: 8 };
export class LocalTransport implements SessionTransport {
  readonly kind = 'local' as const; private readonly link: LoopbackLink; private _welcome: Welcome | null = null; private closedFlag = false; private fns = new Map<string, Set<(...a: never[]) => void>>(); constructor(readonly server: LanHostServer, private readonly getLastSeq: () => number | null = () => null) { this.link = server.createLoopbackLink(); this.link.on('welcome', (w) => { this._welcome = w as unknown as Welcome; this.emit('welcome', this._welcome); }); this.link.on('frame', (f) => this.emit('frame', f)); this.link.on('link', (l) => this.emit('link', l)); this.link.on('closed', (c) => this.emit('closed', { ...c })); }
  get capabilities(): TransportCapabilities { return { ...CAPS }; } get welcome(): Welcome | null { return this._welcome; } get state(): string { return this.closedFlag ? 'closed' : this.link.state; }
  private emit<K extends keyof TransportEvents>(ev: K, ...a: TransportEvents[K]): void { for (const f of [...(this.fns.get(ev) ?? [])]) { try { (f as unknown as (...x: TransportEvents[K]) => void)(...a); } catch { /* a listener must not break the host */ } } }
  on(ev: string, fn: (...a: never[]) => void): () => void { let s = this.fns.get(ev); if (!s) this.fns.set(ev, (s = new Set())); s.add(fn); return () => { s!.delete(fn); }; }
  async connect(): Promise<Welcome> { this.link.connect(this.getLastSeq()); return this._welcome!; }
  async close(): Promise<void> { if (this.closedFlag) return; this.closedFlag = true; this.emit('closed', { code: 1000, reason: 'closed', willReconnect: false }); this.emit('link', 'offline'); this.fns.clear(); }
  reconnect(): void { this.link.reconnect(); }
  send(f: Omit<Frame, 'v'> & { v?: 1 }): Promise<void> { if (this.closedFlag) return Promise.reject(new Error('not connected')); try { assertWritableFrame({ ...f, v: 1 }); } catch (e) { return Promise.reject(e); } return this.link.send(f); }
}
