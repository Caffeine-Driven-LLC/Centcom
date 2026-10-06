/** One honest answer to "can I reach the backend?", from the sockets and the status feed, with the names the mascot and status line use. */
import { OfflineError } from './errors.js';
export type NetState = 'online' | 'reconnecting' | 'offline' | 'degraded' | 'backend-down';
export const toMascotState = (s: NetState): 'online' | 'reconnecting' | 'offline' => (s === 'online' || s === 'degraded' ? 'online' : s === 'reconnecting' ? 'reconnecting' : 'offline');
export interface LinkSource { link(): 'online' | 'reconnecting' | 'offline'; on(ev: 'link', fn: (l: 'online' | 'reconnecting' | 'offline') => void): () => void }
export interface StatusProbe { (): Promise<{ status: 'ok' | 'partial_outage' | 'major_outage' | 'maintenance' | string }> }
export interface NetClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface NetStateOptions { sessions: () => LinkSource[]; /** `GET /v1/status`: resolves with the feed, rejects when the network or the service fails */ status: StatusProbe; clock: NetClock; pollStatusMs?: number; /** how many failed attempts in a row before reconnecting becomes offline */ offlineAfter?: number }
type Fn = (s: NetState, prev: NetState) => void;

export class NetStateMonitor {
  private state: NetState = 'online'; private fns = new Set<Fn>(); private timer: unknown; private failures = 0; private lastStatus: { at: number; ok: boolean; kind: 'ok' | 'partial' | 'down' | 'unreachable' } | undefined; private offs: (() => void)[] = []; private reconnectingSince = 0; private attempts = 0; private stopped = false;
  constructor(private readonly o: NetStateOptions) {}
  current(): NetState { return this.state; }
  on(ev: 'change', fn: Fn): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }
  start(): void { this.stopped = false; this.watch(); this.recompute(); void this.poll(); }
  stop(): void { this.stopped = true; if (this.timer !== undefined) this.o.clock.clearTimeout(this.timer as never); for (const f of this.offs.splice(0)) f(); this.timer = undefined; }
  /** call again when sessions open or close */
  watch(): void { for (const f of this.offs.splice(0)) f(); for (const s of this.o.sessions()) this.offs.push(s.on('link', (l) => { if (l === 'reconnecting') { this.attempts++; if (!this.reconnectingSince) this.reconnectingSince = this.o.clock.now(); } else if (l === 'online') { this.attempts = 0; this.reconnectingSince = 0; } this.recompute(); })); }
  private async poll(): Promise<void> {
    if (this.stopped) return; const gap = this.o.pollStatusMs ?? 15_000;
    try { const r = await this.o.status(); this.failures = 0; this.lastStatus = { at: this.o.clock.now(), ok: true, kind: r.status === 'ok' ? 'ok' : r.status === 'partial_outage' ? 'partial' : 'down' }; } catch (e) { this.failures++; const status = (e as { status?: number }).status; this.lastStatus = { at: this.o.clock.now(), ok: false, kind: status !== undefined && status >= 500 ? 'down' : 'unreachable' }; }
    this.recompute(); if (!this.stopped) this.timer = this.o.clock.setTimeout(() => { void this.poll(); }, gap);
  }
  /** Sockets first (they are the freshest), then the status feed. Reconnecting becomes offline from the second failed attempt on. */
  private recompute(): void {
    const links = this.o.sessions().map((s) => s.link()); let next: NetState;
    if (links.some((l) => l === 'offline')) next = 'offline';
    else if (links.some((l) => l === 'reconnecting')) next = this.attempts >= (this.o.offlineAfter ?? 2) || this.lastStatus?.kind === 'unreachable' ? 'offline' : 'reconnecting';
    else if (this.lastStatus?.kind === 'unreachable' && this.failures >= 2) next = 'offline'; else if (this.lastStatus?.kind === 'down') next = 'backend-down'; else if (this.lastStatus?.kind === 'partial') next = 'degraded'; else next = 'online';
    if (next !== this.state) { const prev = this.state; this.state = next; for (const f of [...this.fns]) { try { f(next, prev); } catch { /* a listener must not break the monitor */ } } }
  }
}
/** Run a hosted-only action; when the state is known to be down it fails at once, and an action that does not answer in a second fails too. */
export async function requireOnline<T>(fn: () => Promise<T>, o: { timeoutMs?: number; state?: () => NetState; setTimeout?: (f: () => void, ms: number) => unknown; clearTimeout?: (h: never) => void } = {}): Promise<T> {
  const st = o.state?.(); if (st === 'offline' || st === 'backend-down') throw new OfflineError();
  const set = o.setTimeout ?? ((f, ms) => setTimeout(f, ms)); const clear = o.clearTimeout ?? ((h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>)); let timer: unknown;
  try { return await Promise.race([fn(), new Promise<never>((_, rej) => { timer = set(() => rej(new OfflineError()), o.timeoutMs ?? 1000); })]); } finally { if (timer !== undefined) clear(timer as never); }
}
/** Cached entitlements may be shown for 24 h offline; after that they are marked stale. They never decide whether a hosted action is allowed. */
export const ENTITLEMENT_DISPLAY_MS = 24 * 3_600_000;
export function cachedForDisplay(fetchedAt: number, now: number): { usable: true; stale: boolean } { return { usable: true, stale: now - fetchedAt > ENTITLEMENT_DISPLAY_MS }; }
