/**
 * Network interfaces and the mDNS sockets bound on them.
 * Owns: picking usable interfaces (up, not loopback unless --bind names it), the MdnsSocket seam that tests replace with an in-memory bus, the real node:dgram socket pair (IPv4 224.0.0.251 and IPv6 ff02::fb on UDP 5353 with address reuse), and the per-source packet rate limit.
 * Must not: answer or listen on interfaces the user excluded with --bind, or crash the process when 5353 cannot be shared.
 */
import { createSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { MdnsUnavailableError } from '../errors.js';
import { mono, type LanClock } from '../clock.js';
import { MAX_PACKET, MDNS_PORT, MDNS_V4, MDNS_V6 } from './dns-sd.js';

export interface NetIface { name: string; family: 'IPv4' | 'IPv6'; address: string; netmask: string; internal: boolean; scopeid?: number }
export interface RemoteInfo { address: string; family: 'IPv4' | 'IPv6'; port: number; iface?: string }
/** One mDNS endpoint: sends to the multicast groups on every allowed interface and hands over every datagram it receives. */
export interface MdnsSocket { send(packet: Uint8Array): void; onMessage(fn: (packet: Uint8Array, from: RemoteInfo) => void): void; close(): Promise<void> }
export type MdnsSocketFactory = (o: { interfaces: NetIface[] }) => Promise<MdnsSocket>;

type IfaceTable = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Interfaces mDNS may use. Node lists only interfaces that are up and have an address; loopback is skipped unless `bind` names it.
 * `bind` entries are interface names or addresses; when given, only those interfaces are used.
 */
export function usableInterfaces(o: { bind?: readonly string[]; table?: () => IfaceTable } = {}): NetIface[] {
  const table = (o.table ?? networkInterfaces)(); const out: NetIface[] = []; const bind = o.bind?.filter(Boolean) ?? [];
  for (const [name, list] of Object.entries(table)) for (const i of list ?? []) {
    const family = i.family === 'IPv4' || (i.family as unknown) === 4 ? 'IPv4' : 'IPv6';
    const named = bind.length > 0 && (bind.includes(name) || bind.includes(i.address));
    if (bind.length > 0 && !named) continue;
    if (i.internal && !named) continue;
    out.push({ name, family, address: i.address, netmask: i.netmask, internal: i.internal, ...(family === 'IPv6' ? { scopeid: i.scopeid } : {}) });
  }
  return out;
}

const v4num = (a: string) => a.split('.').reduce((n, x) => (n * 256) + Number(x), 0);
/** The allowed interface a source address belongs to (same IPv4 subnet, or for IPv6 the same scope / any link-local), else undefined. */
export function ifaceFor(addr: string, ifaces: readonly NetIface[]): NetIface | undefined {
  const [host, scope] = addr.split('%') as [string, string | undefined];
  if (isIP(host) === 4) return ifaces.find((i) => i.family === 'IPv4' && (v4num(host) & v4num(i.netmask)) >>> 0 === (v4num(i.address) & v4num(i.netmask)) >>> 0);
  if (isIP(host) === 6) return ifaces.find((i) => i.family === 'IPv6' && (scope ? scope === i.name || scope === String(i.scopeid) : true));
  return undefined;
}

/** Drops datagrams above `perSecond` from one source address (default 100/s, CT-LAN failure modes). Tracks at most 1 024 sources per second. */
export function sourceRateLimiter(clock: LanClock, perSecond = 100): (source: string) => boolean {
  let windowStart = mono(clock); let counts = new Map<string, number>();
  return (source) => {
    const now = mono(clock); if (now - windowStart >= 1000) { windowStart = now; counts = new Map(); }
    const n = (counts.get(source) ?? 0) + 1; if (n === 1 && counts.size >= 1024) return false; counts.set(source, n); return n <= perSecond;
  };
}

/** Wrap a socket so received datagrams pass the per-source rate limit and the size cap first. */
export function guarded(sock: MdnsSocket, clock: LanClock, perSecond = 100): MdnsSocket {
  const allow = sourceRateLimiter(clock, perSecond);
  return { send: (p) => sock.send(p), close: () => sock.close(), onMessage: (fn) => sock.onMessage((p, from) => { if (p.length <= MAX_PACKET && allow(from.address)) fn(p, from); }) };
}

export interface UdpOptions { port?: number; reuseAddr?: boolean; createSocket?: typeof createSocket; ipv6?: boolean }

/**
 * The real mDNS socket pair on node:dgram. IPv4 is required; IPv6 is best effort (many hosts have no ff02::fb route).
 * Rejects with MdnsUnavailableError when the IPv4 port cannot be bound or shared.
 */
export function udpSocketFactory(opts: UdpOptions = {}): MdnsSocketFactory {
  const port = opts.port ?? MDNS_PORT; const reuseAddr = opts.reuseAddr ?? true; const mk = opts.createSocket ?? createSocket;
  return async ({ interfaces }) => {
    const v4 = interfaces.filter((i) => i.family === 'IPv4'); const v6 = interfaces.filter((i) => i.family === 'IPv6');
    const open = (type: 'udp4' | 'udp6', group: string, ifs: NetIface[]) => new Promise<Socket>((resolve, reject) => {
      let s: Socket; try { s = mk({ type, reuseAddr }); } catch (e) { reject(e); return; }
      const fail = (e: unknown) => { try { s.close(); } catch { /* already closed */ } reject(e); };
      s.once('error', fail);
      s.bind({ port, address: type === 'udp4' ? '0.0.0.0' : '::', exclusive: false }, () => {
        try {
          s.setMulticastTTL(255); s.setMulticastLoopback(true);
          for (const i of ifs) { try { s.addMembership(group, type === 'udp4' ? i.address : `::%${i.name}`); } catch { /* interface without multicast */ } }
          s.off('error', fail); s.on('error', () => undefined); resolve(s);
        } catch (e) { fail(e); }
      });
    });
    let s4: Socket;
    try { s4 = await open('udp4', MDNS_V4, v4); } catch (e) { throw new MdnsUnavailableError((e as NodeJS.ErrnoException)?.code); }
    let s6: Socket | undefined;
    if (opts.ipv6 !== false && v6.length > 0) { try { s6 = await open('udp6', MDNS_V6, v6); } catch { s6 = undefined; } }
    const listeners: ((p: Uint8Array, from: RemoteInfo) => void)[] = [];
    const deliver = (family: 'IPv4' | 'IPv6') => (msg: Buffer, r: { address: string; port: number }) => {
      const iface = ifaceFor(r.address, interfaces); if (!iface) return; // not from an allowed interface: ignore
      for (const l of listeners) l(new Uint8Array(msg), { address: r.address, family, port: r.port, iface: iface.name });
    };
    s4.on('message', deliver('IPv4')); s6?.on('message', deliver('IPv6'));
    return {
      send(p) {
        for (const i of v4) { try { s4.setMulticastInterface(i.address); s4.send(p, port, MDNS_V4); } catch { /* interface went away */ } }
        if (s6) for (const i of v6) { try { s6.setMulticastInterface(`::%${i.name}`); s6.send(p, port, `${MDNS_V6}%${i.name}`); } catch { /* interface went away */ } }
      },
      onMessage(fn) { listeners.push(fn); },
      async close() { await Promise.all([s4, s6].filter((s): s is Socket => !!s).map((s) => new Promise<void>((r) => { try { s.close(() => r()); } catch { r(); } }))); },
    };
  };
}
