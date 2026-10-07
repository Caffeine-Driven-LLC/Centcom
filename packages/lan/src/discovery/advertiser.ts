/**
 * Announces a LAN session over mDNS / DNS-SD (CT-LAN §1): `_centcom._tcp.local.` instance `<session-name>-<4 hex>`, SRV, TXT, A/AAAA.
 * Owns: probing for a unique instance name (re-rolling the hex on conflict), two announcements 1 s apart, answering queries, TXT refresh when the member count changes, goodbye (TTL 0) on stop.
 * Must not: put anything secret in a record, send a single packet when disabled (--no-announce), or answer on interfaces excluded by --bind.
 */
import { createServer } from 'node:net';
import type { Logger } from '@centcom/net';
import { cryptoRandom, systemClock, type LanClock, type RandomBytes } from '../clock.js';
import { MdnsUnavailableError } from '../errors.js';
import { decodePacket, encodePacket, isSRV, nameKey, sameName, TYPE, type DnsPacket, type DnsQuestion, type DnsRecord, type Name } from './dns-sd.js';
import { guarded, udpSocketFactory, usableInterfaces, type MdnsSocket, type MdnsSocketFactory, type NetIface, type RemoteInfo } from './interfaces.js';
import { cleanText, encodeTxt, truncateUtf8 } from './txt.js';

export const SERVICE: Name = ['_centcom', '_tcp', 'local'];
export const SERVICES_META: Name = ['_services', '_dns-sd', '_udp', 'local'];
export const DEFAULT_TTL_S = 120;
export const DEFAULT_PORT = 7070;
/** Probe packets go out at these offsets; with no conflict by PROBE_WAIT_MS the name is ours. */
export const PROBE_AT_MS = [0, 250, 500] as const;
export const PROBE_WAIT_MS = 750;
export const ANNOUNCE_GAP_MS = 1000;
const MAX_REROLLS = 10;
const MAX_RESPONSES_PER_S = 20;

/** What the host command passes through from its flags. `enabled: false` is `--no-announce`; `bind` is `--bind`. */
export interface AdvertiseOptions { enabled?: boolean; bind?: string[] }

/** `--no-announce` and `--bind <ip|iface>` (repeatable) as AdvertiseOptions. */
export function advertiseOptionsFromArgs(argv: readonly string[]): AdvertiseOptions {
  const bind: string[] = []; argv.forEach((a, i) => { if (a === '--bind' && argv[i + 1]) bind.push(argv[i + 1]!); else if (a.startsWith('--bind=')) bind.push(a.slice(7)); });
  return { enabled: !argv.includes('--no-announce'), ...(bind.length ? { bind } : {}) };
}

export interface LanAdvertiserOptions extends AdvertiseOptions {
  sessionId: string; sessionName: string; hostName: string; fingerprint: string; port: number; memberCount: () => number;
  socketFactory?: MdnsSocketFactory; clock?: LanClock; rng?: RandomBytes;
  /** Interfaces to announce addresses for; defaults to the usable ones (respecting `bind`). */
  interfaces?: () => NetIface[];
  ttlSeconds?: number; logger?: Logger;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Instance label `<name>-<hex>`: the cleaned session name cut so the label fits the 63-byte DNS limit. */
export function instanceLabel(sessionName: string, hex4: string): string {
  const base = truncateUtf8(cleanText(sessionName).replace(/\.+$/, ''), 63 - 5) || 'centcom';
  return `${base}-${hex4}`;
}

export class LanAdvertiser {
  private clock: LanClock; private rng: RandomBytes; private ttl: number;
  private sock?: MdnsSocket; private state: 'idle' | 'probing' | 'announced' | 'stopped' = 'idle';
  private label = ''; private readonly hostLabel: string; private count: number;
  private timers = new Set<unknown>(); private onConflict?: () => void;
  private respWindow = 0; private respCount = 0;

  constructor(private o: LanAdvertiserOptions) {
    this.clock = o.clock ?? systemClock; this.rng = o.rng ?? cryptoRandom; this.ttl = o.ttlSeconds ?? DEFAULT_TTL_S;
    this.hostLabel = `centcom-${hex(this.rng(4))}`; this.count = clampCount(o.memberCount());
    this.label = instanceLabel(o.sessionName, hex(this.rng(2)));
    encodeTxt(this.txtRecord()); // fail fast on an invalid sid or fingerprint
  }

  /** The current instance label (changes if a conflict forced a re-roll). */
  instance(): string { return this.label; }

  /** Probe, then announce twice. Resolves once the name is ours and the first announcement is out. Disabled: sends nothing and resolves at once. */
  async start(): Promise<{ instance: string; port: number }> {
    if (this.state !== 'idle') return { instance: this.label, port: this.o.port };
    if (this.o.enabled === false) { this.state = 'stopped'; return { instance: this.label, port: this.o.port }; }
    const ifaces = this.ifaces(); const factory = this.o.socketFactory ?? udpSocketFactory();
    let raw: MdnsSocket;
    try { raw = await factory({ interfaces: ifaces }); } catch (e) { this.state = 'stopped'; throw e instanceof MdnsUnavailableError ? e : new MdnsUnavailableError((e as NodeJS.ErrnoException)?.code); }
    this.sock = guarded(raw, this.clock); this.sock.onMessage((p, from) => this.onPacket(p, from));
    await this.claimName();
    return { instance: this.label, port: this.o.port };
  }

  /** Update `n`; when announced, the new TXT goes out now and again 1 s later. */
  setMemberCount(n: number): void {
    const c = clampCount(n); if (c === this.count) return; this.count = c;
    if (this.state !== 'announced') return;
    const send = () => { if (this.state === 'announced') this.send({ response: true, answers: [this.txt(this.ttl)] }); };
    send(); this.after(ANNOUNCE_GAP_MS, send);
  }

  /** Goodbye (every record with TTL 0), then close. Safe to call twice. */
  async stop(): Promise<void> {
    const was = this.state; this.state = 'stopped'; for (const t of this.timers) this.clock.clearTimeout(t as never); this.timers.clear(); this.onConflict?.();
    if (was === 'announced') this.send({ response: true, answers: this.records(0) });
    const s = this.sock; this.sock = undefined; await s?.close();
  }

  // ---- naming

  private isStopped(): boolean { return this.state === 'stopped'; }

  private async claimName() {
    for (let i = 0; i <= MAX_REROLLS; i++) {
      if (this.isStopped()) return;
      this.state = 'probing';
      const conflict = await this.probe();
      if (this.isStopped()) return;
      if (!conflict) break;
      this.o.logger?.info('lan.mdns.name_conflict', { attempt: i + 1 });
      this.label = instanceLabel(this.o.sessionName, hex(this.rng(2)));
    }
    this.state = 'announced';
    const announce = () => { if (this.state === 'announced') this.send({ response: true, answers: this.records(this.ttl) }); };
    announce(); this.after(ANNOUNCE_GAP_MS, announce);
    this.o.logger?.info('lan.mdns.announced', { port: this.o.port });
  }

  /** Resolves true as soon as someone else owns or out-ranks our name, false after PROBE_WAIT_MS of silence. */
  private probe(): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false; const handles: unknown[] = [];
      const finish = (c: boolean) => { if (done) return; done = true; this.onConflict = undefined; for (const h of handles) { this.clock.clearTimeout(h as never); this.timers.delete(h); } resolve(c); };
      this.onConflict = () => finish(true);
      const q = { response: false, questions: [{ name: this.instanceName(), type: TYPE.ANY, unicast: true }], authorities: [this.srv(this.ttl), this.txt(this.ttl)] };
      for (const at of PROBE_AT_MS) handles.push(this.after(at, () => { if (!done) this.send(q); }));
      handles.push(this.after(PROBE_WAIT_MS, () => finish(false)));
    });
  }

  private conflict() { if (this.state === 'probing') { this.onConflict?.(); return; } if (this.state === 'announced') { this.o.logger?.warn('lan.mdns.name_taken_later'); this.label = instanceLabel(this.o.sessionName, hex(this.rng(2))); void this.claimName(); } }

  // ---- receiving

  private onPacket(buf: Uint8Array, _from: RemoteInfo) {
    if (this.state === 'stopped' || this.state === 'idle') return;
    const p = decodePacket(buf); if (!p) return;
    const mine = this.instanceName(); const ours = this.srv(this.ttl);
    if (p.response) {
      for (const r of [...p.answers, ...p.additionals]) if (isSRV(r) && sameName(r.name, mine) && r.ttl > 0 && !sameSrv(r, ours)) { this.conflict(); return; }
      return;
    }
    if (this.state === 'probing') {
      // a simultaneous probe for the same name: the lexicographically later SRV data wins (RFC 6762 §8.2)
      for (const r of p.authorities) if (isSRV(r) && sameName(r.name, mine) && !sameSrv(r, ours) && srvRank(r) > srvRank(ours)) { this.conflict(); return; }
      return;
    }
    this.answer(p.questions);
  }

  private answer(questions: DnsQuestion[]) {
    const answers: DnsRecord[] = []; const extra: DnsRecord[] = []; const inst = this.instanceName(); const host = this.hostFqdn();
    const want = (q: DnsQuestion, t: number) => q.type === t || q.type === TYPE.ANY;
    for (const q of questions) {
      if (sameName(q.name, SERVICE) && want(q, TYPE.PTR)) { answers.push(this.ptr(this.ttl)); extra.push(this.srv(this.ttl), this.txt(this.ttl), ...this.addrs(this.ttl)); }
      else if (sameName(q.name, inst)) { if (want(q, TYPE.SRV)) answers.push(this.srv(this.ttl)); if (want(q, TYPE.TXT)) answers.push(this.txt(this.ttl)); extra.push(...this.addrs(this.ttl)); }
      else if (sameName(q.name, host)) answers.push(...this.addrs(this.ttl).filter((r) => want(q, r.type)));
      else if (sameName(q.name, SERVICES_META) && want(q, TYPE.PTR)) answers.push({ name: SERVICES_META, type: TYPE.PTR, ttl: this.ttl, target: SERVICE });
    }
    if (answers.length === 0) return;
    const now = this.clock.now(); if (now - this.respWindow >= 1000) { this.respWindow = now; this.respCount = 0; } if (++this.respCount > MAX_RESPONSES_PER_S) return;
    const a = dedupe(answers); const inAnswers = new Set(a.map(recKey)); this.send({ response: true, answers: a, additionals: dedupe(extra).filter((r) => !inAnswers.has(recKey(r))) });
  }

  // ---- records

  private ifaces(): NetIface[] { return this.o.interfaces?.() ?? usableInterfaces({ bind: this.o.bind }); }
  private instanceName(): Name { return [this.label, ...SERVICE]; }
  private hostFqdn(): Name { return [this.hostLabel, 'local']; }
  private txtRecord() { return { v: '1' as const, p: '1', sid: this.o.sessionId, name: this.o.sessionName, host: this.o.hostName, fp: this.o.fingerprint, n: this.count, pair: true }; }
  private ptr(ttl: number): DnsRecord { return { name: SERVICE, type: TYPE.PTR, ttl, target: this.instanceName() }; }
  private srv(ttl: number): DnsRecord { return { name: this.instanceName(), type: TYPE.SRV, ttl, flush: true, priority: 0, weight: 0, port: this.o.port, target: this.hostFqdn() }; }
  private txt(ttl: number): DnsRecord { return { name: this.instanceName(), type: TYPE.TXT, ttl, flush: true, entries: encodeTxt(this.txtRecord()).map((b) => new Uint8Array(b)) }; }
  private addrs(ttl: number): DnsRecord[] { return this.ifaces().slice(0, 16).map((i): DnsRecord => (i.family === 'IPv4' ? { name: this.hostFqdn(), type: TYPE.A, ttl, flush: true, address: i.address } : { name: this.hostFqdn(), type: TYPE.AAAA, ttl, flush: true, address: i.address })); }
  private records(ttl: number): DnsRecord[] { return [this.ptr(ttl), this.srv(ttl), this.txt(ttl), ...this.addrs(ttl)]; }

  private send(p: Partial<DnsPacket> & { response: boolean }) { try { this.sock?.send(encodePacket(p)); } catch (e) { this.o.logger?.warn('lan.mdns.send_failed', { error: (e as Error).name }); } }
  private after(ms: number, fn: () => void): unknown { const h = this.clock.setTimeout(() => { this.timers.delete(h); fn(); }, ms); this.timers.add(h); return h; }
}

const clampCount = (n: number) => Math.max(0, Math.min(8, Math.floor(Number.isFinite(n) ? n : 0)));
type Srv = Extract<DnsRecord, { type: 33 }>;
const sameSrv = (a: Srv, b: DnsRecord) => isSRV(b) && a.port === b.port && sameName(a.target, b.target);
const srvRank = (r: DnsRecord) => (isSRV(r) ? `${String(r.port).padStart(5, '0')}|${r.target.join('.').toLowerCase()}` : '');
/** Our records are unique per (name, type) except addresses, which differ by value. */
const recKey = (r: DnsRecord) => `${r.type}|${nameKey(r.name)}|${'address' in r ? r.address : ''}`;
const dedupe = (rs: DnsRecord[]) => { const seen = new Set<string>(); return rs.filter((r) => { const k = recKey(r); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** The preferred port (7070) if it is free on `host`, else a random free port. */
export async function choosePort(preferred = DEFAULT_PORT, host = '0.0.0.0'): Promise<number> {
  const tryPort = (p: number) => new Promise<number | null>((resolve) => { const s = createServer(); s.once('error', () => resolve(null)); s.listen({ port: p, host, exclusive: true }, () => { const a = s.address(); const got = typeof a === 'object' && a ? a.port : null; s.close(() => resolve(got)); }); });
  return (await tryPort(preferred)) ?? (await tryPort(0)) ?? preferred;
}
