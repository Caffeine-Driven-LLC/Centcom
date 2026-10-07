/**
 * In-memory multicast bus for tests: any number of advertisers and browsers exchange datagrams with no sockets.
 * It can inject arbitrary packets, drop packets (loss), and records every datagram sent so tests can scan them for secrets.
 */
import type { MdnsSocket, MdnsSocketFactory, NetIface, RemoteInfo } from './interfaces.js';

export interface BusCapture { from: string; at: number; packet: Uint8Array }

export class MulticastBus {
  private endpoints = new Set<{ address: string; fns: ((p: Uint8Array, f: RemoteInfo) => void)[] }>();
  /** Every datagram any endpoint sent, in order. */
  readonly captured: BusCapture[] = [];
  /** Return true to drop a datagram (packet loss or a partitioned host). */
  drop: (c: BusCapture) => boolean = () => false;
  constructor(private now: () => number = () => 0) {}

  /** A socket factory for one machine with the given source address. `failWith` makes opening fail like a real bind error. */
  factory(address: string, o: { failWith?: Error } = {}): MdnsSocketFactory {
    return async (_: { interfaces: NetIface[] }): Promise<MdnsSocket> => {
      if (o.failWith) throw o.failWith;
      const ep = { address, fns: [] as ((p: Uint8Array, f: RemoteInfo) => void)[] }; this.endpoints.add(ep);
      return { send: (p) => this.deliver(address, p), onMessage: (fn) => { ep.fns.push(fn); }, close: async () => { this.endpoints.delete(ep); } };
    };
  }

  /** Send a datagram as if from `from` (malformed, hostile or replayed packets). */
  inject(packet: Uint8Array, from = '192.168.1.66'): void { this.deliver(from, packet); }

  /** Open endpoints right now. */
  size(): number { return this.endpoints.size; }

  private deliver(from: string, packet: Uint8Array) {
    const c = { from, at: this.now(), packet: packet.slice() }; this.captured.push(c);
    if (this.drop(c)) return;
    const targets = [...this.endpoints];
    queueMicrotask(() => { for (const ep of targets) if (this.endpoints.has(ep)) for (const fn of ep.fns) fn(c.packet.slice(), { address: from, family: 'IPv4', port: 5353, iface: 'eth0' }); });
  }
}

/** One fake interface with the given IPv4 address, for advertisers on the bus. */
export const fakeInterfaces = (address: string): NetIface[] => [{ name: 'eth0', family: 'IPv4', address, netmask: '255.255.255.0', internal: false }];
