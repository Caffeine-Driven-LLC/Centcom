/** Test doubles for the relay client: a manual clock, an in-memory socket and server, a seeded rng and a log capture. */
import { readFileSync, readdirSync } from 'node:fs';
import type { Frame } from '@centcom/protocol';
import { createLogger, createRingSink, RelayClient, type RelayClientOptions, type RelayClock, type RelaySocket, type WsFactory, type WsFactoryOptions } from '../../src/index.js';

export const SID = 'ses_01JTEST0000000000000000001';
export const MEM = 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export const CLIENT = { name: 'centcom-cli', version: '1.4.2', contract: '1.2.0' };

/** Yield to the event loop a few times so promise chains settle. */
export const flush = async (n = 4): Promise<void> => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r)); };

/** Time moves only in advance(); due timers fire in order (ties in creation order), with promise chains settled after each. */
export class ManualClock implements RelayClock {
  t = Date.UTC(2026, 9, 6, 12, 0, 0); private seq = 0; private order = 0; readonly timers = new Map<number, { at: number; fn: () => void; order: number }>();
  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): number { const id = ++this.seq; this.timers.set(id, { at: this.t + Math.max(0, ms), fn, order: ++this.order }); return id; }
  clearTimeout(h: never): void { this.timers.delete(h as unknown as number); }
  async advance(ms: number): Promise<void> {
    const target = this.t + ms; await flush(2);
    for (;;) {
      let next: [number, { at: number; fn: () => void; order: number }] | undefined;
      for (const e of this.timers) if (e[1].at <= target && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[1].order < next[1].order))) next = e;
      if (!next) break; this.timers.delete(next[0]); this.t = Math.max(this.t, next[1].at); next[1].fn(); await flush(2);
    }
    this.t = target; await flush(2);
  }
  /** Delays of pending timers, from now. */
  pendingDelays(): number[] { return [...this.timers.values()].map((x) => x.at - this.t); }
}

/** Deterministic [0, 1). */
export function seeded(seed = 1): () => number { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 2 ** 24; }; }

type Fn = (...a: never[]) => void;
/** An in-memory WebSocket. The test plays the server: open(), receive(), serverClose(). */
export class FakeSocket implements RelaySocket {
  readyState = 0; protocol = ''; bufferedAmount = 0; sent: string[] = []; closeCalls: { code?: number; reason?: string }[] = []; terminated = false;
  /** false: the "server" never answers our close frame (only terminate() ends it) */
  echoClose = true;
  /** set to make send() fail */
  failSends = false;
  private ls = new Map<string, Fn[]>();
  constructor(readonly url: string, readonly protocols: string[], readonly opts: WsFactoryOptions) {}
  on(ev: string, fn: Fn): this { (this.ls.get(ev) ?? this.ls.set(ev, []).get(ev)!).push(fn); return this; }
  private fire(ev: string, ...a: unknown[]): void { for (const f of this.ls.get(ev) ?? []) (f as (...x: unknown[]) => void)(...a); }
  send(data: string, cb: (err?: Error) => void): void { if (this.readyState !== 1 || this.failSends) { cb(new Error('not open')); return; } this.sent.push(data); cb(); }
  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason }); if (this.readyState === 3 || this.readyState === 2) return; this.readyState = 2;
    if (this.echoClose) queueMicrotask(() => this.serverClose(code ?? 1005, reason ?? ''));
  }
  terminate(): void { this.terminated = true; if (this.readyState !== 3) this.serverClose(1006, ''); }
  /* ---- server side */
  open(protocol = 'centcom.v1'): void { this.readyState = 1; this.protocol = protocol; this.fire('open'); }
  receive(frame: unknown, isBinary = false): void { this.fire('message', Buffer.from(typeof frame === 'string' ? frame : JSON.stringify(frame)), isBinary); }
  serverClose(code: number, reason = ''): void { if (this.readyState === 3) return; this.readyState = 3; this.fire('close', code, Buffer.from(reason)); }
  error(message: string): void { this.fire('error', new Error(message)); }
  frames(): Frame[] { return this.sent.map((s) => JSON.parse(s) as Frame); }
  of(t: string): Frame[] { return this.frames().filter((f) => f.t === t); }
}

export function fakeServer() {
  const sockets: FakeSocket[] = [];
  const factory: WsFactory = (url, protocols, o) => { const s = new FakeSocket(url, protocols, o); sockets.push(s); return s; };
  return { sockets, factory, last: (): FakeSocket => sockets[sockets.length - 1]! };
}

const fixture = (name: string): { valid: boolean; data: Frame } => JSON.parse(readFileSync(new URL(`../../../../contracts/fixtures/envelope/${name}.json`, import.meta.url), 'utf8'));
export const envelopeFixtures = (): { name: string; valid: boolean; data: Frame }[] =>
  readdirSync(new URL('../../../../contracts/fixtures/envelope/', import.meta.url)).filter((f) => f.endsWith('.json')).sort().map((f) => { const x = fixture(f.replace(/\.json$/, '')); return { name: f, valid: x.valid, data: x.data }; });

/** A sys.welcome built on the contract fixture. */
export function welcome(p: Record<string, unknown> = {}): Frame { const w = fixture('welcome').data; return { ...w, p: { ...w.p, caps: ['resume'], resume: null, ...p } }; }

export interface Recorded { welcome: unknown[]; frame: Frame[]; notice: unknown[]; error: (Error & { code?: string; localCode?: string; retryAfterS?: number })[]; slow_down: number[]; link: string[]; closed: { code: number; reason: string; willReconnect: boolean; userFacing?: string }[]; protocol_warning: { reason: string }[] }

/** A RelayClient on the fake server and manual clock, with every event recorded and logs captured. */
export function rig(o: Partial<RelayClientOptions> = {}) {
  const clock = new ManualClock(); const srv = fakeServer(); const tickets: string[] = []; let n = 0;
  const ring = createRingSink(5000); const logger = createLogger({ level: 'trace', sinks: [ring], clock: () => clock.now() });
  const getTicket = async () => { const t = `tkt.${++n}.SECRETTICKETVALUE`; tickets.push(t); return { ticket: t }; };
  const client = new RelayClient({ url: 'wss://relay.centcom.dev/v1/ws', sessionId: SID, getTicket, getLastSeq: () => null, clientInfo: CLIENT, clock, rng: seeded(7), wsFactory: srv.factory, logger, ...o });
  const ev: Recorded = { welcome: [], frame: [], notice: [], error: [], slow_down: [], link: [], closed: [], protocol_warning: [] };
  for (const k of Object.keys(ev) as (keyof Recorded)[]) (client.on as (k: string, f: (x: unknown) => void) => void)(k, (x) => { (ev[k] as unknown[]).push(x); });
  /** The next socket the client creates (each one is handed out once); waits for the attempt to fetch its ticket. */
  let handed = 0;
  const nextSocket = async (): Promise<FakeSocket> => { for (let i = 0; i < 50 && srv.sockets.length <= handed; i++) await flush(1); if (srv.sockets.length <= handed) throw new Error('no new socket'); return srv.sockets[handed++]!; };
  /** Open the pending socket and answer hello with a welcome. */
  const accept = async (w: Record<string, unknown> = {}): Promise<FakeSocket> => { const s = await nextSocket(); s.open(); s.receive(welcome(w)); await flush(); return s; };
  const logs = () => ring.snapshot().map((r) => JSON.stringify(r)).join('\n');
  return { clock, srv, client, tickets, ev, ring, logs, nextSocket, accept };
}
