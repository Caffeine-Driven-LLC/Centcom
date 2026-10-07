/** The handshake (CT-WS-ENVELOPE "Handshake", CT-VER): the sys.hello we send, reading sys.welcome, caps negotiation and which URLs we may dial.
 *  Pure functions. Must not: put the ticket anywhere but hello.p, or accept a protocol we did not offer. */
import { PROTOCOL_VERSIONS, type Frame } from '@centcom/protocol';

export const SUBPROTOCOL = 'centcom.v1';
/** How long we wait for sys.welcome after sending hello (and for the socket to open). */
export const HELLO_TIMEOUT_MS = 10_000;
export const DEFAULT_CAPS: readonly string[] = ['resume'];
export const DEFAULT_PROTOCOLS: readonly number[] = PROTOCOL_VERSIONS;
export const DEFAULT_RELAY_URL = 'wss://relay.centcom.dev/v1/ws';

export interface ClientIdent { name: string; version: string; contract: string }

/** The first frame on every connection. */
export function buildHello(o: { protocols: readonly number[]; caps: readonly string[]; ticket: string; client: ClientIdent; lastSeq: number | null }): Frame {
  return { v: 1, t: 'sys.hello', p: { protocols: [...o.protocols], caps: [...o.caps], ticket: o.ticket, client: { name: o.client.name, version: o.client.version, contract: o.client.contract }, last_seq: o.lastSeq } };
}

/** What sys.welcome told us, read from the validated frame. Field names are the wire's. */
export interface Welcome {
  protocol: number;
  /** the server's list as sent (unknown caps included); use negotiatedCaps for what may be used */
  caps: readonly string[];
  member: { id: string; name: string; slot: number; role: string };
  slot: number; role: string;
  roster_v: number | null;
  heartbeat: { ping_ms: number; dead_ms: number };
  limits: Record<string, unknown>;
  /** `{from_seq}` when resuming inside the hot buffer, `{snapshot_required: true}` when not, null on a fresh join */
  resume: Record<string, unknown> | null;
  session?: { mode?: string; state?: string };
  server_time?: string;
}

export type WelcomeResult = { ok: true; welcome: Welcome } | { ok: false; reason: 'protocol_mismatch' | 'invalid_welcome' };

/** The chosen protocol must be one we offered; this is checked before schema validation so a newer server is reported as a mismatch, not as garbage. */
export function checkProtocol(raw: unknown, ours: readonly number[]): boolean {
  const p = (raw as { p?: { protocol?: unknown } } | null)?.p?.protocol; return typeof p === 'number' && ours.includes(p);
}

/** Read an already validated sys.welcome frame. */
export function readWelcome(f: Frame, ours: readonly number[]): WelcomeResult {
  if (!checkProtocol(f, ours)) return { ok: false, reason: 'protocol_mismatch' };
  const p = f.p as Record<string, unknown> | undefined; if (!p || f.t !== 'sys.welcome') return { ok: false, reason: 'invalid_welcome' };
  const m = p.member as Welcome['member'] | undefined; const hb = p.heartbeat as { ping_ms?: unknown; dead_ms?: unknown } | undefined;
  if (!m || typeof m.id !== 'string' || !hb) return { ok: false, reason: 'invalid_welcome' };
  const caps = Array.isArray(p.caps) ? p.caps.filter((c): c is string => typeof c === 'string') : [];
  const welcome: Welcome = {
    protocol: p.protocol as number, caps, member: { id: m.id, name: String(m.name), slot: Number(m.slot), role: String(m.role) }, slot: Number(m.slot), role: String(m.role),
    roster_v: typeof p.roster_v === 'number' ? p.roster_v : null,
    heartbeat: { ping_ms: typeof hb.ping_ms === 'number' ? hb.ping_ms : 20_000, dead_ms: typeof hb.dead_ms === 'number' ? hb.dead_ms : 50_000 },
    limits: p.limits && typeof p.limits === 'object' ? (p.limits as Record<string, unknown>) : {},
    resume: p.resume && typeof p.resume === 'object' ? (p.resume as Record<string, unknown>) : null,
    ...(p.session && typeof p.session === 'object' ? { session: p.session as Welcome['session'] } : {}),
    ...(typeof p.server_time === 'string' ? { server_time: p.server_time } : {}),
  };
  return { ok: true, welcome };
}

/** Caps in use = ours that the server also advertised (CT-VER). Unknown caps from the server are ignored. */
export function negotiateCaps(ours: readonly string[], theirs: readonly unknown[]): ReadonlySet<string> {
  const t = new Set(theirs.filter((c): c is string => typeof c === 'string')); return new Set(ours.filter((c) => t.has(c)));
}

/* ------------------------------------------------------------ which URLs may be dialled */

/** True for loopback, link-local and private-range addresses (RFC 1918, RFC 4193, fe80::/10), and `localhost`. Names other than localhost are never trusted. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost') return true;
  /* the URL parser writes ::ffff:192.168.0.2 as ::ffff:c0a8:2, so the mapped form is read back to dotted form */
  let plain = h.startsWith('::ffff:') ? h.slice(7) : h; const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(plain); if (hex && h.startsWith('::ffff:')) { const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16); plain = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(plain);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]; if ([1, 2, 3, 4].some((i) => Number(v4[i]) > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (!h.includes(':')) return false;
  if (h === '::1') return true;
  const first = parseInt(h.split(':')[0] || '0', 16);
  return (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00;
}
/** The hosted relay's domain: never dialled over plain ws. */
export const isRelayHost = (hostname: string): boolean => { const h = hostname.toLowerCase(); return h === 'centcom.dev' || h.endsWith('.centcom.dev'); };

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };
/** wss:// anywhere; ws:// only with allowPlainWs and a private or loopback address, and never to the relay. No credentials, query or fragment (a ticket must never ride in the URL). */
export function checkRelayUrl(raw: string, o: { allowPlainWs?: boolean } = {}): UrlCheck {
  let u: URL; try { u = new URL(raw); } catch { return { ok: false, reason: 'not_a_url' }; }
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: 'url_has_credentials_or_query' };
  if (u.protocol === 'wss:') return { ok: true, url: u.toString() };
  if (u.protocol !== 'ws:') return { ok: false, reason: 'not_websocket' };
  if (isRelayHost(u.hostname)) return { ok: false, reason: 'relay_needs_tls' };
  if (!o.allowPlainWs) return { ok: false, reason: 'plain_ws_not_allowed' };
  if (!isPrivateHost(u.hostname)) return { ok: false, reason: 'plain_ws_public_host' };
  return { ok: true, url: u.toString() };
}
