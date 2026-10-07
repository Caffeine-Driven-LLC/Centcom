/**
 * The lan.pair.1..4 and lan.pair.err frames (schemas/lan-pair.schema.json) and the transport seams pairing runs over.
 * Owns: size cap, JSON parsing, schema validation (tolerant on read, strict on write) and the field checks the schema leaves open (lengths, encodings, fingerprint consistency).
 * Must not: throw on any input, or put anything in a frame beyond the documented fields.
 */
import { fingerprint, initCrypto } from '@centcom/net';
import { validateAgainst, type LanPair, type OpenApiComponents } from '@centcom/protocol';
import { FP_RE, SID_RE, cleanText } from '../discovery/txt.js';
import { TOKEN_RE } from './reconnect-token.js';

/** Largest pairing frame accepted or sent, in UTF-8 bytes. */
export const MAX_PAIR_FRAME = 4096;
export const DEVICE_ID_RE = /^dev_[0-9A-HJKMNP-TV-Z]{26}$/;
export const MEMBER_ID_RE = /^mem_[0-9A-HJKMNP-TV-Z]{26}$/;
const B64_32 = /^[A-Za-z0-9_-]{43}$/;

export type SessionPolicy = OpenApiComponents['schemas']['SessionPolicy'];
export interface MemberInfo { id: string; name: string; slot: number; role: 'host' | 'editor' | 'viewer' }
export interface PairDevice { id: string; x25519: string; ed25519: string; name: string }

export type Pair1 = { t: 'lan.pair.1'; cpace_msg: string; device: PairDevice; fp: string };
export type Pair2 = { t: 'lan.pair.2'; cpace_msg: string; device: PairDevice; fp: string };
export type Pair3 = { t: 'lan.pair.3'; confirm: string };
export type Pair4 = { t: 'lan.pair.4'; confirm: string; ok: true; member: MemberInfo; session: { sid: string; name: string; policy: SessionPolicy }; reconnect_token: string };
export type PairErrCode = 'bad_code' | 'locked_out' | 'version' | 'busy';
export type PairErr = { t: 'lan.pair.err'; code: PairErrCode };
export type PairMsg = Pair1 | Pair2 | Pair3 | Pair4 | PairErr;

/** A text transport (an in-memory pair in tests, a WebSocket in the host server). */
export interface TextChannel { send(text: string): void; onMessage(fn: (text: string) => void): void; onClose(fn: (code: number) => void): void; close(code: number): void }
/** One not-yet-paired connection as the LAN host server (lane C072) hands it over. */
export interface PairConn { id: string; remoteIp: string; send(text: string): void; close(code: number): void }
/** What lane C072 calls for pre-hello pairing frames. */
export interface PairingHandler { onPairFrame(conn: PairConn, text: string): Promise<'continue' | 'done' | 'fail'>; onClose(conn: PairConn): void }

export type ParseResult = { ok: true; msg: PairMsg } | { ok: false; reason: 'too_large' | 'not_json' | 'schema' | 'field' | 'fingerprint' };

let cryptoReady: Promise<void> | undefined;
/** The C056 crypto (fingerprints) must be loaded before parsing device frames. */
export const initMessages = (): Promise<void> => (cryptoReady ??= initCrypto());

const utf8Len = (s: string) => Buffer.byteLength(s, 'utf8');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function device(v: unknown): PairDevice | null {
  if (!isObj(v)) return null; const { id, x25519, ed25519, name } = v;
  if (typeof id !== 'string' || !DEVICE_ID_RE.test(id) || typeof x25519 !== 'string' || !B64_32.test(x25519) || typeof ed25519 !== 'string' || !B64_32.test(ed25519) || typeof name !== 'string' || name.length > 200) return null;
  return { id, x25519, ed25519, name: cleanText(name) };
}
function member(v: unknown): MemberInfo | null {
  if (!isObj(v)) return null; const { id, name, slot, role } = v;
  if (typeof id !== 'string' || !MEMBER_ID_RE.test(id) || typeof name !== 'string' || name.length > 200 || !Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 7 || (role !== 'host' && role !== 'editor' && role !== 'viewer')) return null;
  return { id, name: cleanText(name), slot: slot as number, role };
}
function policy(v: unknown): SessionPolicy | null {
  if (!isObj(v) || typeof v.queue_limit !== 'number') return null;
  if (v.auto_approve !== undefined && !['ask', 'trusted', 'everyone'].includes(v.auto_approve as string)) return null;
  for (const k of ['share_history', 'locked', 'auto_failover'] as const) if (v[k] !== undefined && typeof v[k] !== 'boolean') return null;
  return v as SessionPolicy;
}

/** Parse one received frame. Never throws; anything unexpected is a `ParseResult` with ok:false. */
export function parsePairMessage(text: unknown): ParseResult {
  try {
    if (typeof text !== 'string' || utf8Len(text) > MAX_PAIR_FRAME) return { ok: false, reason: 'too_large' };
    let data: unknown; try { data = JSON.parse(text); } catch { return { ok: false, reason: 'not_json' }; }
    const r = validateAgainst('lan-pair', data, 'tolerant'); if (!r.ok) return { ok: false, reason: 'schema' };
    const m = r.value as LanPair;
    switch (m.t) {
      case 'lan.pair.1': case 'lan.pair.2': {
        const d = device(m.device); if (!d || typeof m.cpace_msg !== 'string' || !B64_32.test(m.cpace_msg) || typeof m.fp !== 'string' || !FP_RE.test(m.fp)) return { ok: false, reason: 'field' };
        if (fingerprint(d.x25519, d.ed25519) !== m.fp) return { ok: false, reason: 'fingerprint' };
        return { ok: true, msg: { t: m.t, cpace_msg: m.cpace_msg, device: d, fp: m.fp } };
      }
      case 'lan.pair.3': return typeof m.confirm === 'string' && B64_32.test(m.confirm) ? { ok: true, msg: { t: 'lan.pair.3', confirm: m.confirm } } : { ok: false, reason: 'field' };
      case 'lan.pair.4': {
        const mem = member((m as Record<string, unknown>).member); const ses = (m as Record<string, unknown>).session; const pol = isObj(ses) ? policy(ses.policy) : null;
        if (typeof m.confirm !== 'string' || !B64_32.test(m.confirm) || m.ok !== true || !mem || !isObj(ses) || typeof ses.sid !== 'string' || !SID_RE.test(ses.sid) || typeof ses.name !== 'string' || ses.name.length > 200 || !pol || typeof m.reconnect_token !== 'string' || !TOKEN_RE.test(m.reconnect_token)) return { ok: false, reason: 'field' };
        return { ok: true, msg: { t: 'lan.pair.4', confirm: m.confirm, ok: true, member: mem, session: { sid: ses.sid, name: cleanText(ses.name, 80), policy: pol }, reconnect_token: m.reconnect_token } };
      }
      case 'lan.pair.err': return { ok: true, msg: { t: 'lan.pair.err', code: (['bad_code', 'locked_out', 'version', 'busy'] as const).find((c) => c === m.code) ?? 'version' } };
      default: return { ok: false, reason: 'schema' };
    }
  } catch { return { ok: false, reason: 'field' }; }
}

/** Serialise a frame we send; strict schema check and the size cap. Throws only on our own bug. */
export function encodePairMessage(m: PairMsg): string {
  const r = validateAgainst('lan-pair', m, 'strict'); if (!r.ok) throw new TypeError('invalid pairing frame');
  const s = JSON.stringify(m); if (utf8Len(s) > MAX_PAIR_FRAME) throw new RangeError('pairing frame too large'); return s;
}

/** Two TextChannels wired back to back, for tests and for the host's in-process loopback. */
export function memoryChannelPair(): [TextChannel, TextChannel] {
  const mk = () => ({ msg: [] as ((t: string) => void)[], close: [] as ((c: number) => void)[], open: true });
  const a = mk(), b = mk();
  const side = (me: ReturnType<typeof mk>, peer: ReturnType<typeof mk>): TextChannel => ({
    send(text) { if (!me.open) return; queueMicrotask(() => { if (peer.open) for (const f of peer.msg) f(text); }); },
    onMessage(fn) { me.msg.push(fn); }, onClose(fn) { me.close.push(fn); },
    close(code) { if (!me.open) return; me.open = false; queueMicrotask(() => { for (const f of me.close) f(code); if (peer.open) { peer.open = false; for (const f of peer.close) f(code); } }); },
  });
  return [side(a, b), side(b, a)];
}
