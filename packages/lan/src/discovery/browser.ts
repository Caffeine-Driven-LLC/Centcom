/**
 * Finds LAN hosts over mDNS: PTR queries for `_centcom._tcp.local.` at 0, 1, 2, 4, 8 s then every 60 s; merges PTR/SRV/TXT/A/AAAA into LanHost entries; expires them on TTL; emits up / update / down.
 * Owns: treating every received record as untrusted (size caps, TXT validation, bounded caches).
 * Must not: connect, prompt or trust identity because of a record. `fingerprint` is only a hint to compare during pairing.
 */
import { isIP } from 'node:net';
import type { Logger } from '@centcom/net';
import { systemClock, type LanClock } from '../clock.js';
import { MdnsUnavailableError } from '../errors.js';
import { SERVICE } from './advertiser.js';
import { decodePacket, encodePacket, endsWith, isA, isAAAA, isPTR, isSRV, isTXT, nameKey, sameName, TYPE, type Name } from './dns-sd.js';
import { guarded, udpSocketFactory, usableInterfaces, type MdnsSocket, type MdnsSocketFactory, type NetIface, type RemoteInfo } from './interfaces.js';
import { parseTxt, type TxtRecord } from './txt.js';

export interface LanHost { instance: string; sessionId: string; name: string; hostName: string; fingerprint: string; port: number; addresses: string[]; memberCount: number; pairRequired: boolean; lastSeen: number }
export type LanHostEvent = 'up' | 'update' | 'down';

/** Delays between queries: 0, 1, 2, 4, 8 s after start, then every 60 s. */
export const QUERY_SCHEDULE_MS = [0, 1000, 1000, 2000, 4000] as const;
export const QUERY_INTERVAL_MS = 60_000;
const SWEEP_MS = 250;
/** Caps on what one browser keeps, whatever the network sends. */
export const MAX_INSTANCES = 64;
export const MAX_ADDRESSES = 8;
const MAX_TTL_S = 4500;

export interface LanBrowserOptions { socketFactory?: MdnsSocketFactory; clock?: LanClock; bind?: string[]; interfaces?: () => NetIface[]; logger?: Logger }

interface Entry { ptrUntil?: number; srv?: { port: number; target: Name; until: number }; txt?: { rec: TxtRecord; until: number }; source?: string; lastSeen: number; label: string }

export class LanBrowser {
  private clock: LanClock; private sock?: MdnsSocket; private running = false; private starting?: Promise<void>;
  private entries = new Map<string, Entry>(); private addrs = new Map<string, Map<string, number>>();
  private published = new Map<string, LanHost>(); private listeners: Record<LanHostEvent, ((h: LanHost) => void)[]> = { up: [], update: [], down: [] };
  private timers = new Set<unknown>(); private step = 0;

  constructor(private o: LanBrowserOptions = {}) { this.clock = o.clock ?? systemClock; }

  on(ev: LanHostEvent, fn: (h: LanHost) => void): this { this.listeners[ev].push(fn); return this; }

  /** Open the socket and start querying. Rejects with MdnsUnavailableError when 5353 cannot be used. */
  start(): Promise<void> {
    if (this.running) return this.starting ?? Promise.resolve();
    this.running = true;
    this.starting = (async () => {
      const factory = this.o.socketFactory ?? udpSocketFactory(); const ifaces = this.o.interfaces?.() ?? usableInterfaces({ bind: this.o.bind });
      let raw: MdnsSocket;
      try { raw = await factory({ interfaces: ifaces }); } catch (e) { this.running = false; throw e instanceof MdnsUnavailableError ? e : new MdnsUnavailableError((e as NodeJS.ErrnoException)?.code); }
      if (!this.running) { await raw.close(); return; }
      this.sock = guarded(raw, this.clock); this.sock.onMessage((p, f) => this.onPacket(p, f));
      this.step = 0; this.scheduleQuery(QUERY_SCHEDULE_MS[0]); this.scheduleSweep();
    })();
    return this.starting;
  }

  /** Stop querying and close. Known hosts stay readable through hosts() but no more events fire. */
  async stop(): Promise<void> {
    this.running = false; for (const t of this.timers) this.clock.clearTimeout(t as never); this.timers.clear();
    await this.starting?.catch(() => undefined); this.starting = undefined;
    const s = this.sock; this.sock = undefined; await s?.close();
  }

  /** Current hosts, sorted by name then instance. */
  hosts(): LanHost[] { return [...this.published.values()].sort((a, b) => a.name.localeCompare(b.name) || a.instance.localeCompare(b.instance)).map((h) => ({ ...h, addresses: [...h.addresses] })); }

  /** Browse for `timeoutMs` and return what was found. Starts and stops the browser unless it was already running. */
  async scan(timeoutMs: number): Promise<LanHost[]> {
    const wasRunning = this.running; await this.start();
    await new Promise<void>((r) => { this.after(Math.max(0, timeoutMs), r); });
    const out = this.hosts(); if (!wasRunning) await this.stop(); return out;
  }

  // ---- schedule

  private after(ms: number, fn: () => void) { const h = this.clock.setTimeout(() => { this.timers.delete(h); fn(); }, ms); this.timers.add(h); }
  private scheduleQuery(delay: number) {
    this.after(delay, () => {
      if (!this.running) return;
      try { this.sock?.send(encodePacket({ response: false, questions: [{ name: SERVICE, type: TYPE.PTR }] })); } catch { /* cannot happen for our fixed query */ }
      this.step++; this.scheduleQuery(this.step < QUERY_SCHEDULE_MS.length ? QUERY_SCHEDULE_MS[this.step]! : QUERY_INTERVAL_MS);
    });
  }
  private scheduleSweep() { this.after(SWEEP_MS, () => { if (!this.running) return; this.reconcile(); this.scheduleSweep(); }); }

  // ---- intake

  private onPacket(buf: Uint8Array, from: RemoteInfo) {
    if (!this.running) return;
    const p = decodePacket(buf); if (!p || !p.response) return;
    const now = this.clock.now(); const ttlMs = (s: number) => Math.min(s, MAX_TTL_S) * 1000;
    for (const r of [...p.answers, ...p.additionals]) {
      if (isPTR(r) && sameName(r.name, SERVICE)) {
        if (r.target.length !== SERVICE.length + 1 || !endsWith(r.target, SERVICE)) continue;
        const e = this.entry(r.target, now); if (!e) continue;
        if (r.ttl === 0) { this.forget(nameKey(r.target)); continue; }
        e.ptrUntil = now + ttlMs(r.ttl); e.lastSeen = now; e.source ??= from.address;
      } else if (isSRV(r) && r.name.length === SERVICE.length + 1 && endsWith(r.name, SERVICE)) {
        if (r.ttl === 0) { this.forget(nameKey(r.name)); continue; }
        if (r.port < 1 || r.port > 65535) continue;
        const e = this.entry(r.name, now); if (!e) continue;
        e.srv = { port: r.port, target: r.target, until: now + ttlMs(r.ttl) }; e.lastSeen = now; e.source = from.address;
      } else if (isTXT(r) && r.name.length === SERVICE.length + 1 && endsWith(r.name, SERVICE)) {
        if (r.ttl === 0) { this.forget(nameKey(r.name)); continue; }
        const rec = parseTxt(r.entries); if (!rec) { this.o.logger?.debug('lan.mdns.txt_rejected'); continue; }
        const e = this.entry(r.name, now); if (!e) continue;
        e.txt = { rec, until: now + ttlMs(r.ttl) }; e.lastSeen = now;
      } else if (isA(r) || isAAAA(r)) {
        if (isIP(r.address) === 0) continue;
        const k = nameKey(r.name); let m = this.addrs.get(k);
        if (!m) { if (this.addrs.size >= MAX_INSTANCES * 2) continue; m = new Map(); this.addrs.set(k, m); }
        if (r.ttl === 0) { m.delete(r.address); continue; }
        if (m.has(r.address) || m.size < MAX_ADDRESSES) m.set(r.address, now + ttlMs(r.ttl));
      }
    }
    this.reconcile();
  }

  private entry(name: Name, now: number): Entry | undefined {
    const k = nameKey(name); let e = this.entries.get(k);
    if (!e) { if (this.entries.size >= MAX_INSTANCES) return undefined; e = { lastSeen: now, label: name[0]! }; this.entries.set(k, e); }
    return e;
  }
  private forget(k: string) { this.entries.delete(k); this.reconcile(); }

  /** Drop expired records, rebuild hosts, emit the differences. */
  private reconcile() {
    const now = this.clock.now(); const next = new Map<string, LanHost>();
    for (const [, m] of this.addrs) for (const [a, until] of m) if (until <= now) m.delete(a);
    for (const [k, m] of this.addrs) if (m.size === 0) this.addrs.delete(k);
    for (const [k, e] of this.entries) {
      if (e.ptrUntil !== undefined && e.ptrUntil <= now) e.ptrUntil = undefined;
      if (e.srv && e.srv.until <= now) e.srv = undefined;
      if (e.txt && e.txt.until <= now) e.txt = undefined;
      if (!e.srv && !e.txt && e.ptrUntil === undefined) { this.entries.delete(k); continue; }
      if (!e.srv || !e.txt) continue;
      const known = [...(this.addrs.get(nameKey(e.srv.target))?.keys() ?? [])];
      const addresses = (known.length ? known : e.source ? [e.source] : []).slice(0, MAX_ADDRESSES).sort();
      const t = e.txt.rec;
      next.set(k, { instance: e.label, sessionId: t.sid, name: t.name, hostName: t.host, fingerprint: t.fp, port: e.srv.port, addresses, memberCount: t.n, pairRequired: t.pair, lastSeen: e.lastSeen });
    }
    const prev = this.published; this.published = next;
    for (const [k, h] of next) { const old = prev.get(k); if (!old) this.emit('up', h); else if (changed(old, h)) this.emit('update', h); }
    for (const [k, h] of prev) if (!next.has(k)) this.emit('down', h);
  }

  private emit(ev: LanHostEvent, h: LanHost) { for (const fn of this.listeners[ev]) { try { fn({ ...h, addresses: [...h.addresses] }); } catch (e) { this.o.logger?.warn('lan.mdns.listener_failed', { error: (e as Error).name }); } } }
}

const changed = (a: LanHost, b: LanHost) => a.sessionId !== b.sessionId || a.name !== b.name || a.hostName !== b.hostName || a.fingerprint !== b.fingerprint || a.port !== b.port || a.memberCount !== b.memberCount || a.pairRequired !== b.pairRequired || a.addresses.join() !== b.addresses.join();
