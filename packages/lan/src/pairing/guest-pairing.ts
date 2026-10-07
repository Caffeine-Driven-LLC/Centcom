/**
 * Guest side of LAN pairing (CT-LAN §2): CPace as initiator over any TextChannel.
 * Owns: sending lan.pair.1 and lan.pair.3, checking the host's fingerprint against the mDNS hint before confirming, verifying the host's confirmation in constant time, and keeping the reconnect token in the keychain.
 * Must not: send the code or anything derived from it except the CPace share and the confirmation MAC, or put a secret in an error.
 */
import { b64, unb64, type DeviceKeyStore, type Keychain } from '@centcom/net';
import { systemClock, type LanClock, type RandomBytes } from '../clock.js';
import { FingerprintMismatchError, PairingError, fpHint } from '../errors.js';
import { normalizeCode } from './code.js';
import { concat, confirmMac, cpaceStart, ctEqual, initCpace, lanChannelId, transcriptIr, wipe } from './cpace.js';
import { CLOSE_PROTOCOL, CLOSE_REJECTED } from './host-pairing.js';
import { encodePairMessage, initMessages, parsePairMessage, type MemberInfo, type PairMsg, type SessionPolicy, type TextChannel } from './messages.js';
import { saveGuestToken } from './reconnect-token.js';
import { checkTrust, type DeviceRecord, type PairingTrustStore } from './trust-store.js';

/** How long the guest waits for each host answer. */
export const GUEST_STEP_TIMEOUT_MS = 15_000;
const EMPTY = new Uint8Array(0);
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface GuestPairOptions {
  channel: TextChannel; code: string; device: DeviceKeyStore;
  /** This device's id and display name (DeviceKeyStore keeps the id private). */
  deviceInfo: { id: string; name: string };
  /** From mDNS (`sid`, `fp`) or typed in. CT-LAN §2 puts both in the CPace channel identifier, so both are needed before lan.pair.1. */
  hostSessionId?: string; expectedFingerprint?: string;
  clock?: LanClock; random?: RandomBytes; stepTimeoutMs?: number;
  /** Where the reconnect token is kept (the OS keychain). */
  keychain?: Keychain;
  /** Known host devices; a changed key for a known id is refused (TOFU). */
  trust?: PairingTrustStore;
}
export interface GuestPairResult { member: MemberInfo; session: { sid: string; name: string; policy: SessionPolicy }; hostDevice: DeviceRecord; reconnectToken: string }

/** Pair with a LAN host. Rejects with PairingError (bad_code, locked_out, protocol, timeout, closed, confirm_failed, ...) or FingerprintMismatchError. */
export async function guestPair(o: GuestPairOptions): Promise<GuestPairResult> {
  const code = normalizeCode(o.code); if (!code) throw new PairingError('bad_code');
  if (!o.hostSessionId || !o.expectedFingerprint) throw new PairingError('host_identity_required');
  await Promise.all([initCpace(), initMessages()]);
  const sid = o.hostSessionId; const hostFp = o.expectedFingerprint; const clock = o.clock ?? systemClock;
  const keys = await o.device.getOrCreatePublicKeys(); const myFp = o.device.fingerprint();
  const inbox = reader(o.channel, clock, o.stepTimeoutMs ?? GUEST_STEP_TIMEOUT_MS);
  let isk: Uint8Array | null = null;
  const abort = (code: number, err: Error): never => { wipe(isk ?? undefined); inbox.stop(); try { o.channel.close(code); } catch { /* already closed */ } throw err; };
  try {
    const party = cpaceStart({ code, ci: lanChannelId(hostFp, myFp, sid), sid, random: o.random });
    const m1 = encodePairMessage({ t: 'lan.pair.1', cpace_msg: b64(party.share), device: { id: o.deviceInfo.id, x25519: keys.x25519, ed25519: keys.ed25519, name: o.deviceInfo.name }, fp: myFp });
    o.channel.send(m1);

    const r2 = await inbox.next(); const p2 = expect(r2, 'lan.pair.2', abort);
    if (p2.t !== 'lan.pair.2') return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
    if (p2.fp !== hostFp) return abort(CLOSE_REJECTED, new FingerprintMismatchError(fpHint(hostFp), fpHint(p2.fp)));
    if (o.trust && checkTrust(o.trust, p2.device) === 'changed') return abort(CLOSE_REJECTED, new PairingError('trust_changed'));
    isk = party.finish(unb64(p2.cpace_msg), (own, peer) => transcriptIr(own, EMPTY, peer, EMPTY));
    if (!isk) return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
    const myConfirm = confirmMac(isk, 'guest', concat(utf8(m1), utf8(r2)));
    const m3 = encodePairMessage({ t: 'lan.pair.3', confirm: b64(myConfirm) }); wipe(myConfirm);
    o.channel.send(m3);

    const r4 = await inbox.next(); const p4 = expect(r4, 'lan.pair.4', abort);
    if (p4.t !== 'lan.pair.4') return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
    const want = confirmMac(isk, 'host', concat(utf8(m1), utf8(r2), utf8(m3)));
    const ok = ctEqual(want, unb64(p4.confirm)); wipe(want);
    if (!ok) return abort(CLOSE_REJECTED, new PairingError('confirm_failed'));
    if (p4.session.sid !== sid) return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
    wipe(isk); isk = null; inbox.stop();
    const hostDevice: DeviceRecord = { ...p2.device, fingerprint: p2.fp };
    o.trust?.remember(hostDevice);
    if (o.keychain) await saveGuestToken(o.keychain, sid, p4.reconnect_token);
    return { member: p4.member, session: p4.session, hostDevice, reconnectToken: p4.reconnect_token };
  } catch (e) {
    if (e instanceof PairingError || e instanceof FingerprintMismatchError) throw e;
    return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
  }
}

/** Parse a host frame; turn lan.pair.err and anything unexpected into the right PairingError. */
function expect(text: string, want: PairMsg['t'], abort: (code: number, e: Error) => never): PairMsg {
  const p = parsePairMessage(text);
  if (!p.ok) return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
  if (p.msg.t === 'lan.pair.err') return abort(CLOSE_REJECTED, new PairingError(p.msg.code === 'bad_code' ? 'bad_code' : p.msg.code === 'locked_out' ? 'locked_out' : 'protocol'));
  if (p.msg.t !== want) return abort(CLOSE_PROTOCOL, new PairingError('protocol'));
  return p.msg;
}

/** Ordered reads from a TextChannel with a per-read timeout. At most 8 frames are buffered; more is a protocol error. */
function reader(ch: TextChannel, clock: LanClock, timeoutMs: number) {
  const queue: string[] = []; let waiter: { resolve: (t: string) => void; reject: (e: Error) => void; timer: unknown } | undefined; let closed = false; let overflow = false; let stopped = false;
  const settle = () => {
    if (!waiter) return; const w = waiter;
    if (overflow) { waiter = undefined; clock.clearTimeout(w.timer as never); w.reject(new PairingError('protocol')); return; }
    if (queue.length) { waiter = undefined; clock.clearTimeout(w.timer as never); w.resolve(queue.shift()!); return; }
    if (closed) { waiter = undefined; clock.clearTimeout(w.timer as never); w.reject(new PairingError('closed')); }
  };
  ch.onMessage((t) => { if (stopped) return; if (queue.length >= 8) overflow = true; else queue.push(t); settle(); });
  ch.onClose(() => { closed = true; settle(); });
  return {
    next: () => new Promise<string>((resolve, reject) => { waiter = { resolve, reject, timer: clock.setTimeout(() => { if (waiter) { waiter = undefined; reject(new PairingError('timeout')); } }, timeoutMs) }; settle(); }),
    stop: () => { stopped = true; if (waiter) { clock.clearTimeout(waiter.timer as never); waiter = undefined; } },
  };
}
