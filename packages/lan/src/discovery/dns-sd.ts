/**
 * Minimal DNS / DNS-SD packet codec for mDNS (RFC 1035, 6762, 6763): PTR, SRV, TXT, A and AAAA, everything else kept as opaque bytes.
 * Owns: encoding our own packets and decoding untrusted ones. Must not: throw on any input, follow compression loops, or build anything larger than the packet allows.
 * Names are label arrays, so a dot inside an instance label needs no escaping.
 */

export const MDNS_PORT = 5353;
export const MDNS_V4 = '224.0.0.251';
export const MDNS_V6 = 'ff02::fb';
/** Largest packet we read (RFC 6762 §17 allows 9000 bytes over multicast). */
export const MAX_PACKET = 9000;
/** Most records we decode from one packet; a packet claiming more is dropped. Together with MAX_PACKET this keeps one decoded packet well under 64 KiB. */
export const MAX_RECORDS = 48;
const MAX_NAME = 255;
const MAX_LABEL = 63;
const MAX_JUMPS = 16;

export const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, NSEC: 47, ANY: 255 } as const;
export const CLASS_IN = 1;
/** Top bit of the class: cache-flush on records, unicast-response on questions. */
export const CLASS_FLAG = 0x8000;
const FLAG_QR = 0x8000;
const FLAG_AA = 0x0400;

export type Name = string[];
export interface DnsQuestion { name: Name; type: number; unicast?: boolean }
interface RecordBase { name: Name; ttl: number; flush?: boolean }
export type DnsRecord =
  | (RecordBase & { type: 1; address: string })
  | (RecordBase & { type: 28; address: string })
  | (RecordBase & { type: 12; target: Name })
  | (RecordBase & { type: 33; priority: number; weight: number; port: number; target: Name })
  | (RecordBase & { type: 16; entries: Uint8Array[] })
  | (RecordBase & { type: number & {}; data: Uint8Array });
export interface DnsPacket { id: number; response: boolean; questions: DnsQuestion[]; answers: DnsRecord[]; authorities: DnsRecord[]; additionals: DnsRecord[] }

/** A record of a known type, narrowed. */
export const isA = (r: DnsRecord): r is RecordBase & { type: 1; address: string } => r.type === TYPE.A && 'address' in r;
export const isAAAA = (r: DnsRecord): r is RecordBase & { type: 28; address: string } => r.type === TYPE.AAAA && 'address' in r;
export const isPTR = (r: DnsRecord): r is RecordBase & { type: 12; target: Name } => r.type === TYPE.PTR && 'target' in r;
export const isSRV = (r: DnsRecord): r is RecordBase & { type: 33; priority: number; weight: number; port: number; target: Name } => r.type === TYPE.SRV && 'port' in r;
export const isTXT = (r: DnsRecord): r is RecordBase & { type: 16; entries: Uint8Array[] } => r.type === TYPE.TXT && 'entries' in r;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

/** Case-insensitive key for a name (ASCII folding, as DNS does). Dots inside a label are escaped so different label splits never collide. */
export const nameKey = (n: Name): string => n.map((l) => l.replace(/\\/g, '\\\\').replace(/\./g, '\\.')).join('.').replace(/[A-Z]/g, (c) => c.toLowerCase());
export const sameName = (a: Name, b: Name): boolean => a.length === b.length && nameKey(a) === nameKey(b);
/** True when `n` ends with `suffix` (label-wise, case-insensitive). */
export const endsWith = (n: Name, suffix: Name): boolean => n.length >= suffix.length && sameName(n.slice(n.length - suffix.length), suffix);

// ---- encoding (our own data only; bad input is a bug, so it throws)

class Writer {
  private buf = new Uint8Array(512); len = 0;
  private need(n: number) { if (this.len + n > MAX_PACKET) throw new RangeError('DNS packet too large'); if (this.len + n > this.buf.length) { const b = new Uint8Array(Math.min(MAX_PACKET, Math.max(this.buf.length * 2, this.len + n))); b.set(this.buf.subarray(0, this.len)); this.buf = b; } }
  u8(v: number) { this.need(1); this.buf[this.len++] = v & 0xff; }
  u16(v: number) { this.u8(v >>> 8); this.u8(v); }
  u32(v: number) { this.u16(v >>> 16); this.u16(v & 0xffff); }
  bytes(b: Uint8Array) { this.need(b.length); this.buf.set(b, this.len); this.len += b.length; }
  patch16(at: number, v: number) { this.buf[at] = (v >>> 8) & 0xff; this.buf[at + 1] = v & 0xff; }
  done(): Uint8Array { return this.buf.slice(0, this.len); }
}

function writeName(w: Writer, n: Name) {
  let total = 1;
  for (const l of n) { const b = enc.encode(l); if (b.length === 0 || b.length > MAX_LABEL) throw new RangeError('bad DNS label'); total += b.length + 1; if (total > MAX_NAME) throw new RangeError('DNS name too long'); w.u8(b.length); w.bytes(b); }
  w.u8(0);
}

function writeRecord(w: Writer, r: DnsRecord) {
  writeName(w, r.name); w.u16(r.type); w.u16(CLASS_IN | (r.flush ? CLASS_FLAG : 0)); w.u32(Math.max(0, Math.min(0x7fffffff, Math.floor(r.ttl))));
  const at = w.len; w.u16(0); const start = w.len;
  if (isA(r)) w.bytes(ipv4Bytes(r.address));
  else if (isAAAA(r)) w.bytes(ipv6Bytes(r.address));
  else if (isPTR(r)) writeName(w, r.target);
  else if (isSRV(r)) { w.u16(r.priority); w.u16(r.weight); w.u16(r.port); writeName(w, r.target); }
  else if (isTXT(r)) { if (r.entries.length === 0) w.u8(0); for (const e of r.entries) { if (e.length > 255) throw new RangeError('TXT entry over 255 bytes'); w.u8(e.length); w.bytes(e); } }
  else if ('data' in r) w.bytes(r.data);
  w.patch16(at, w.len - start);
}

/** Encode a packet (no name compression: our packets are small). Throws RangeError on our own oversized or malformed data. */
export function encodePacket(p: Partial<DnsPacket> & { response: boolean }): Uint8Array {
  const w = new Writer(); const q = p.questions ?? [], an = p.answers ?? [], ns = p.authorities ?? [], ar = p.additionals ?? [];
  w.u16(p.id ?? 0); w.u16(p.response ? FLAG_QR | FLAG_AA : 0); w.u16(q.length); w.u16(an.length); w.u16(ns.length); w.u16(ar.length);
  for (const x of q) { writeName(w, x.name); w.u16(x.type); w.u16(CLASS_IN | (x.unicast ? CLASS_FLAG : 0)); }
  for (const r of [...an, ...ns, ...ar]) writeRecord(w, r);
  return w.done();
}

// ---- decoding (untrusted; returns null instead of throwing)

class Bad extends Error {}
function readName(b: Uint8Array, start: number): { name: Name; next: number } {
  const labels: string[] = []; let off = start; let next = -1; let jumps = 0; let total = 1;
  for (;;) {
    if (off >= b.length) throw new Bad();
    const len = b[off]!;
    if (len === 0) { if (next < 0) next = off + 1; break; }
    const kind = len & 0xc0;
    if (kind === 0xc0) {
      if (off + 1 >= b.length) throw new Bad();
      const ptr = ((len & 0x3f) << 8) | b[off + 1]!;
      if (ptr >= off || ++jumps > MAX_JUMPS) throw new Bad(); // pointers only go backwards: no loops
      if (next < 0) next = off + 2; off = ptr; continue;
    }
    if (kind !== 0) throw new Bad();
    if (off + 1 + len > b.length) throw new Bad();
    total += len + 1; if (total > MAX_NAME) throw new Bad();
    labels.push(dec.decode(b.subarray(off + 1, off + 1 + len))); off += 1 + len;
  }
  return { name: labels, next };
}
const u16 = (b: Uint8Array, o: number) => { if (o + 2 > b.length) throw new Bad(); return (b[o]! << 8) | b[o + 1]!; };
const u32 = (b: Uint8Array, o: number) => (u16(b, o) * 65536) + u16(b, o + 2);

function readRecord(b: Uint8Array, off: number): { r: DnsRecord; next: number } {
  const { name, next: o1 } = readName(b, off); const type = u16(b, o1); const cls = u16(b, o1 + 2); const ttl = u32(b, o1 + 4); const rdlen = u16(b, o1 + 8); const rd = o1 + 10; const end = rd + rdlen;
  if (end > b.length) throw new Bad();
  const base = { name, ttl, flush: (cls & CLASS_FLAG) !== 0 };
  let r: DnsRecord;
  if (type === TYPE.A) { if (rdlen !== 4) throw new Bad(); r = { ...base, type: 1, address: Array.from(b.subarray(rd, end)).join('.') }; }
  else if (type === TYPE.AAAA) { if (rdlen !== 16) throw new Bad(); r = { ...base, type: 28, address: formatIpv6(b.subarray(rd, end)) }; }
  else if (type === TYPE.PTR) { const t = readName(b, rd); if (t.next > end) throw new Bad(); r = { ...base, type: 12, target: t.name }; }
  else if (type === TYPE.SRV) { if (rdlen < 7) throw new Bad(); const t = readName(b, rd + 6); if (t.next > end) throw new Bad(); r = { ...base, type: 33, priority: u16(b, rd), weight: u16(b, rd + 2), port: u16(b, rd + 4), target: t.name }; }
  else if (type === TYPE.TXT) { const entries: Uint8Array[] = []; let o = rd; while (o < end) { const l = b[o]!; if (o + 1 + l > end) throw new Bad(); entries.push(b.slice(o + 1, o + 1 + l)); o += 1 + l; } r = { ...base, type: 16, entries }; }
  else r = { ...base, type: type as number & {}, data: b.slice(rd, end) };
  return { r, next: end };
}

/** Decode an untrusted packet. Returns null for anything malformed, oversized or with more than MAX_RECORDS entries. Never throws. */
export function decodePacket(input: Uint8Array): DnsPacket | null {
  try {
    if (!(input instanceof Uint8Array) || input.length < 12 || input.length > MAX_PACKET) return null;
    const b = input; const flags = u16(b, 2); const qd = u16(b, 4), an = u16(b, 6), ns = u16(b, 8), ar = u16(b, 10);
    if (qd + an + ns + ar > MAX_RECORDS) return null;
    let off = 12; const questions: DnsQuestion[] = [];
    for (let i = 0; i < qd; i++) { const { name, next } = readName(b, off); const type = u16(b, next); const cls = u16(b, next + 2); questions.push({ name, type, unicast: (cls & CLASS_FLAG) !== 0 }); off = next + 4; }
    const section = (n: number) => { const out: DnsRecord[] = []; for (let i = 0; i < n; i++) { const { r, next } = readRecord(b, off); out.push(r); off = next; } return out; };
    const answers = section(an); const authorities = section(ns); const additionals = section(ar);
    return { id: u16(b, 0), response: (flags & FLAG_QR) !== 0, questions, answers, authorities, additionals };
  } catch { return null; }
}

// ---- addresses

function ipv4Bytes(a: string): Uint8Array { const p = a.split('.').map(Number); if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw new RangeError('bad IPv4 address'); return Uint8Array.from(p); }
function ipv6Bytes(a: string): Uint8Array {
  const s = a.split('%')[0]!; const [head, tail] = s.includes('::') ? s.split('::') as [string, string] : [s, undefined];
  const parse = (x: string) => (x ? x.split(':') : []);
  const h = parse(head); const t = tail === undefined ? [] : parse(tail);
  const v4 = (arr: string[]) => { const last = arr[arr.length - 1]; if (last?.includes('.')) { const b = ipv4Bytes(last); arr.splice(arr.length - 1, 1, ((b[0]! << 8) | b[1]!).toString(16), ((b[2]! << 8) | b[3]!).toString(16)); } };
  if (tail === undefined) v4(h); else v4(t);
  const fill = tail === undefined ? 0 : 8 - h.length - t.length; if (fill < 0 || (tail === undefined && h.length !== 8)) throw new RangeError('bad IPv6 address');
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t]; const out = new Uint8Array(16);
  groups.forEach((g, i) => { const v = parseInt(g, 16); if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new RangeError('bad IPv6 address'); out[i * 2] = v >>> 8; out[i * 2 + 1] = v & 0xff; });
  return out;
}
/** RFC 5952 text form (lower case, longest zero run compressed). */
export function formatIpv6(b: Uint8Array): string {
  const g: number[] = []; for (let i = 0; i < 16; i += 2) g.push((b[i]! << 8) | b[i + 1]!);
  let bestAt = -1, bestLen = 0; for (let i = 0; i < 8;) { if (g[i] !== 0) { i++; continue; } let j = i; while (j < 8 && g[j] === 0) j++; if (j - i > bestLen && j - i > 1) { bestAt = i; bestLen = j - i; } i = j; }
  const hex = g.map((x) => x.toString(16));
  if (bestAt < 0) return hex.join(':');
  return `${hex.slice(0, bestAt).join(':')}::${hex.slice(bestAt + bestLen).join(':')}`;
}
