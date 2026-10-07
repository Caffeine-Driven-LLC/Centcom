/**
 * Host side of LAN pairing (CT-LAN §2): one state machine per connection over lan.pair.1..4, the PairingHandler lane C072 calls.
 * Owns: the open code (TTL, attempts, single use), CPace as responder, constant-time check of the guest's confirmation before anything is trusted, the failure policy (bad_code then 4403, code invalidated after 5 failures, IP ban), issuing the reconnect token, remembering the guest's keys, and the `paired` signal.
 * Must not: send key.grant (the engine does that on `paired`), log or emit the code, ISK, MACs or tokens, or reveal which side of the exchange failed.
 */
import { b64, unb64, type DeviceKeyStore, type Logger } from '@centcom/net';
import { newIdGenerator } from '@centcom/protocol';
import { cryptoRandom, systemClock, type LanClock, type RandomBytes } from '../clock.js';
import { fpHint } from '../errors.js';
import type { MutableBanList } from './ban-list.js';
import { CodeSlot } from './code.js';
import { concat, confirmMac, cpaceStart, ctEqual, initCpace, lanChannelId, transcriptIr, wipe } from './cpace.js';
import { encodePairMessage, initMessages, parsePairMessage, type MemberInfo, type PairConn, type PairDevice, type PairErrCode, type PairingHandler, type SessionPolicy, type TextChannel } from './messages.js';
import { ReconnectTokens } from './reconnect-token.js';
import { checkTrust, type PairingTrustStore } from './trust-store.js';

export const HALF_OPEN_MS = 10_000;
export const MAX_HALF_OPEN = 16;
export const CLOSE_REJECTED = 4403;
export const CLOSE_PROTOCOL = 4400;
export const CLOSE_TIMEOUT = 4408;
const EMPTY = new Uint8Array(0);
const utf8 = (s: string) => new TextEncoder().encode(s);

export type PairFailReason = 'bad_code' | 'expired' | 'too_many' | 'protocol';
export interface PairedGuest { memberHint: string; member: MemberInfo; device: PairDevice & { fingerprint: string }; reconnectToken: string }
export interface PairFailure { ip: string; reason: PairFailReason }
interface HostEvents { paired: PairedGuest; failed: PairFailure; trust_changed: { deviceId: string; fingerprintHint: string } }

export interface HostPairingOptions {
  sessionId: string; sessionName: string; policy: SessionPolicy;
  /** This host's device keys (C056). Its id and display name come from `deviceInfo` because DeviceKeyStore keeps the id private. */
  device: DeviceKeyStore; deviceInfo: { id: string; name: string }; fingerprint: string;
  clock?: LanClock; bans: MutableBanList; trust: PairingTrustStore;
  tokens?: ReconnectTokens;
  /** Pick the member a new guest becomes; null means the session is full. Default: next free slot 1..7 as editor. */
  assignMember?: (d: PairDevice) => MemberInfo | null;
  random?: RandomBytes; codeRng?: () => Uint8Array; logger?: Logger; halfOpenMs?: number;
}

interface ConnState { m1: string; m2: string; isk: Uint8Array; guest: PairDevice; guestFp: string; timer: unknown }

export class HostPairing implements PairingHandler {
  readonly tokens: ReconnectTokens;
  private clock: LanClock; private slot: CodeSlot; private conns = new Map<string, ConnState>(); private finished = new Set<string>();
  private listeners: { [K in keyof HostEvents]: ((e: HostEvents[K]) => void)[] } = { paired: [], failed: [], trust_changed: [] };
  private memberByDevice = new Map<string, MemberInfo>(); private ids: ReturnType<typeof newIdGenerator>;
  private ready?: Promise<{ x25519: string; ed25519: string }>;

  constructor(private o: HostPairingOptions) {
    this.clock = o.clock ?? systemClock; this.slot = new CodeSlot(this.clock, o.codeRng); this.tokens = o.tokens ?? new ReconnectTokens();
    this.ids = newIdGenerator({ now: () => this.clock.now(), random: o.random ?? cryptoRandom });
  }

  on<K extends keyof HostEvents>(ev: K, fn: (e: HostEvents[K]) => void): this { this.listeners[ev].push(fn); return this; }

  /** Open a fresh code (default 5 minutes). The returned display string is for the host screen only. */
  openCode(ttlMs?: number): { display: string; expiresAt: string } { return this.slot.open(ttlMs); }
  /** Stop accepting the current code. */
  closeCode(): void { this.slot.close(); }

  /** The member each paired device became (for the C072 TokenValidator adapter). */
  memberFor(deviceId: string): MemberInfo | null { return this.memberByDevice.get(deviceId) ?? null; }

  /** Run pairing over any TextChannel (in-memory in tests). Frames are handled strictly in order. */
  attach(channel: TextChannel, remoteIp: string): PairConn {
    const conn: PairConn = { id: b64(cryptoRandom(12)), remoteIp, send: (t) => channel.send(t), close: (c) => channel.close(c) };
    let chain = Promise.resolve<unknown>(undefined);
    channel.onMessage((text) => { chain = chain.then(() => this.onPairFrame(conn, text)).catch(() => undefined); });
    channel.onClose(() => this.onClose(conn));
    return conn;
  }

  async onPairFrame(conn: PairConn, text: string): Promise<'continue' | 'done' | 'fail'> {
    try { return await this.handle(conn, text); } catch (e) {
      this.o.logger?.warn('lan.pair.internal_error', { error: (e as Error).name });
      return this.fail(conn, 'protocol', undefined, CLOSE_PROTOCOL);
    }
  }

  onClose(conn: PairConn): void { this.drop(conn.id); this.finished.delete(conn.id); }

  // ---- the state machine

  private async handle(conn: PairConn, text: string): Promise<'continue' | 'done' | 'fail'> {
    const mine = await this.init();
    if (this.finished.has(conn.id)) return 'done'; // already paired on this connection: later pairing frames are ignored
    if (this.o.bans.isBanned(conn.remoteIp)) return this.fail(conn, 'too_many', 'locked_out', CLOSE_REJECTED);
    const parsed = parsePairMessage(text); const st = this.conns.get(conn.id);
    if (!parsed.ok) { this.o.logger?.info('lan.pair.invalid_frame', { why: parsed.reason }); return this.fail(conn, 'protocol', undefined, CLOSE_PROTOCOL); }
    const msg = parsed.msg;

    if (!st) {
      if (msg.t !== 'lan.pair.1') return this.fail(conn, 'protocol', undefined, CLOSE_PROTOCOL);
      const c = this.slot.current(); if (!c.ok) return this.fail(conn, c.reason, c.reason === 'too_many' ? 'locked_out' : 'bad_code', CLOSE_REJECTED);
      if (this.conns.size >= MAX_HALF_OPEN) return this.fail(conn, 'protocol', 'busy', CLOSE_REJECTED);
      if (checkTrust(this.o.trust, msg.device) === 'changed') { this.emit('trust_changed', { deviceId: msg.device.id, fingerprintHint: fpHint(msg.fp) }); return this.fail(conn, 'protocol', 'busy', CLOSE_REJECTED); }
      const party = cpaceStart({ code: c.code, ci: lanChannelId(this.o.fingerprint, msg.fp, this.o.sessionId), sid: this.o.sessionId, random: this.o.random });
      const isk = party.finish(unb64(msg.cpace_msg), (own, peer) => transcriptIr(peer, EMPTY, own, EMPTY));
      if (!isk) return this.fail(conn, 'protocol', undefined, CLOSE_PROTOCOL);
      const m2 = encodePairMessage({ t: 'lan.pair.2', cpace_msg: b64(party.share), device: { id: this.o.deviceInfo.id, x25519: mine.x25519, ed25519: mine.ed25519, name: this.o.deviceInfo.name }, fp: this.o.fingerprint });
      const timer = this.clock.setTimeout(() => { if (this.conns.has(conn.id)) { this.drop(conn.id); this.o.logger?.info('lan.pair.half_open_timeout'); conn.close(CLOSE_TIMEOUT); } }, this.o.halfOpenMs ?? HALF_OPEN_MS);
      this.conns.set(conn.id, { m1: text, m2, isk, guest: msg.device, guestFp: msg.fp, timer });
      conn.send(m2); return 'continue';
    }

    if (msg.t !== 'lan.pair.3') return this.fail(conn, 'protocol', undefined, CLOSE_PROTOCOL);
    const expected = confirmMac(st.isk, 'guest', concat(utf8(st.m1), utf8(st.m2)));
    const good = ctEqual(expected, unb64(msg.confirm)); wipe(expected);
    const c = this.slot.current();
    if (!c.ok) return this.fail(conn, c.reason, c.reason === 'too_many' ? 'locked_out' : 'bad_code', CLOSE_REJECTED);
    if (!good) {
      this.slot.fail(); this.o.bans.recordFailure(conn.remoteIp);
      return this.fail(conn, 'bad_code', 'bad_code', CLOSE_REJECTED);
    }

    const member = this.assign(st.guest); if (!member) return this.fail(conn, 'protocol', 'busy', CLOSE_REJECTED);
    this.slot.consume();
    const token = this.tokens.issue(st.guest.id); this.memberByDevice.set(st.guest.id, member);
    this.o.trust.remember({ ...st.guest, fingerprint: st.guestFp });
    const hostConfirm = confirmMac(st.isk, 'host', concat(utf8(st.m1), utf8(st.m2), utf8(text)));
    const m4 = encodePairMessage({ t: 'lan.pair.4', confirm: b64(hostConfirm), ok: true, member, session: { sid: this.o.sessionId, name: this.o.sessionName, policy: this.o.policy }, reconnect_token: token });
    wipe(hostConfirm); const guest = { ...st.guest, fingerprint: st.guestFp }; this.drop(conn.id);
    if (this.finished.size >= 256) this.finished.clear(); this.finished.add(conn.id);
    conn.send(m4);
    this.o.logger?.info('lan.pair.paired', { device: guest.id, slot: member.slot });
    this.emit('paired', { memberHint: member.id, member, device: guest, reconnectToken: token });
    return 'done';
  }

  // ---- helpers

  private init() {
    this.ready ??= (async () => {
      await Promise.all([initCpace(), initMessages()]); const k = await this.o.device.getOrCreatePublicKeys();
      if (this.o.device.fingerprint() !== this.o.fingerprint) throw new Error('fingerprint does not match the device keys');
      return k;
    })();
    return this.ready;
  }

  private assign(d: PairDevice): MemberInfo | null {
    const known = this.memberByDevice.get(d.id); if (known) return known;
    if (this.o.assignMember) return this.o.assignMember(d);
    const used = new Set([...this.memberByDevice.values()].map((m) => m.slot)); let slot = 1; while (used.has(slot)) slot++;
    return slot > 7 ? null : { id: this.ids.next('mem'), name: d.name, slot, role: 'editor' };
  }

  private fail(conn: PairConn, reason: PairFailReason, wire: PairErrCode | undefined, close: number): 'fail' {
    this.drop(conn.id);
    if (wire) { try { conn.send(encodePairMessage({ t: 'lan.pair.err', code: wire })); } catch { /* peer gone */ } }
    try { conn.close(close); } catch { /* already closed */ }
    this.o.logger?.info('lan.pair.failed', { reason, close });
    this.emit('failed', { ip: conn.remoteIp, reason });
    return 'fail';
  }

  private drop(id: string) { const st = this.conns.get(id); if (!st) return; this.clock.clearTimeout(st.timer as never); wipe(st.isk); this.conns.delete(id); }

  private emit<K extends keyof HostEvents>(ev: K, e: HostEvents[K]) { for (const fn of this.listeners[ev]) { try { fn(e); } catch (err) { this.o.logger?.warn('lan.pair.listener_failed', { error: (err as Error).name }); } } }
}
