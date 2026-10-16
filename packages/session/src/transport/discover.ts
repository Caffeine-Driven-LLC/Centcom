/** Discovery-driven LAN connect (C074): find a host with mDNS and turn it into a transport target that checks the advertised fingerprint. */
import { isPublicAddress, type LanBrowser, type LanHost } from '@centcom/lan';
import type { TransportTarget } from './types.js';

export type LanTarget = Extract<TransportTarget, { kind: 'lan' }>;
export interface DiscoverQuery { /** a session id, or part of the session name or host name (case does not matter) */ match?: string; timeoutMs?: number; code?: string; reconnectToken?: string }
export type Discovered = { ok: true; target: LanTarget; host: LanHost } | { ok: false; reason: 'none' | 'ambiguous'; hosts: LanHost[] };

const rank = (a: string): number => (/^\d+\.\d+\.\d+\.\d+$/.test(a) ? 0 : 1);
/** The first private address of the host (IPv4 before IPv6); advertised public addresses are never used. */
export function addressOf(h: LanHost): string | undefined { return [...h.addresses].filter((a) => !isPublicAddress(a)).sort((a, b) => rank(a) - rank(b))[0]; }

export async function discoverLanTarget(browser: Pick<LanBrowser, 'scan'>, q: DiscoverQuery = {}): Promise<Discovered> {
  const all = await browser.scan(q.timeoutMs ?? 3000); const m = q.match?.trim().toLowerCase();
  const hosts = all.filter((h) => addressOf(h) !== undefined && (!m || h.sessionId.toLowerCase() === m || h.name.toLowerCase().includes(m) || h.hostName.toLowerCase().includes(m)));
  if (hosts.length === 0) return { ok: false, reason: 'none', hosts: [] }; if (hosts.length > 1) return { ok: false, reason: 'ambiguous', hosts };
  const host = hosts[0]!;
  return { ok: true, host, target: { kind: 'lan', host: addressOf(host)!, port: host.port, sessionId: host.sessionId, expectedFingerprint: host.fingerprint, ...(q.code ? { code: q.code } : {}), ...(q.reconnectToken ? { reconnectToken: q.reconnectToken } : {}) } };
}
