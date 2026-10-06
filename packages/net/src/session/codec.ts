/** Turns a frame into what goes on the wire and back: encrypt and sign on the way out, verify and decrypt on the way in. */
import { assertWritableFrame, parseEventPayload, parseSecretPayload, payloadMode } from '@centcom/protocol';
import { decryptPayload, encryptPayload, signFrame, verifyFrame, type Ciphertext, type FrameHeader } from '../crypto/frame.js';
import type { DeviceKeyStore } from '../crypto/device-keys.js';
import type { KeyRing } from '../crypto/keyring.js';
import { CryptoError, sodium, unb64 } from '../crypto/sodium.js';
import type { SequencedFrame } from '../delivery/inbox.js';
import type { Roster } from './roster.js';
import { SessionError, type DecodedEvent } from './types.js';

export type FrameType = 'event' | 'queue' | 'control' | 'presence';
export const frameTypeOf = (kind: string): FrameType => (kind.startsWith('queue.') ? 'queue' : kind.startsWith('control.') ? 'control' : kind.startsWith('presence.') ? 'presence' : 'event');
/** The server speaks control frames about members and keys; a client must ignore them when `from` is anyone else. */
export const SERVER_ONLY = new Set(['control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']);

/** `key.grant` carries sealed boxes that only the recipient can open, so the frame's own AEAD uses a key anyone can derive; the signature and the AAD still bind it to sender, session and recipient. (The contract leaves this key open: see the lane's README.) */
export function grantTransportKey(sid: string, toDevice: string): Uint8Array { return sodium().crypto_generichash(32, `centcom.keygrant.v1|${sid}|${toDevice}`, null); }

export type DecodeFailure = 'unknown_sender' | 'unknown_kid' | 'bad_signature' | 'unsigned' | 'aead_failed' | 'invalid_payload' | 'untrusted_device' | 'too_large';
export type Decoded = { ok: true; event: DecodedEvent; clear: boolean } | { ok: false; reason: DecodeFailure; kid?: string };
export interface Outbound { t: FrameType; id: string; k: string; p?: Record<string, unknown>; ct?: Ciphertext; sig?: string }

export class FrameCodec {
  constructor(private readonly o: { sid: string; deviceId: string; device: DeviceKeyStore | undefined; ring: KeyRing; roster: Roster }) {}
  private header(t: string, id: string, k: string, fromDev: string): FrameHeader { return { v: 1, t, id, sid: this.o.sid, from_dev: fromDev, k }; }

  /** Clear kinds go out as they are; encrypted and hybrid kinds are encrypted under the current epoch and signed with the device key. */
  /** `p` may be a function of the ciphertext size (queue.submit carries it in the clear and signs it). */
  encode(kind: string, id: string, body: { p?: Record<string, unknown> | ((info: { ctBytes: number }) => Record<string, unknown>); secret?: Record<string, unknown> }, o: { kid?: string } = {}): Outbound {
    const mode = payloadMode(kind); const t = frameTypeOf(kind);
    if (mode === 'clear') { const p = typeof body.p === 'function' ? body.p({ ctBytes: 0 }) : body.p; return { t, id, k: kind, ...(p !== undefined ? { p } : {}) }; }
    if (!this.o.device) throw new SessionError('view_only', 'You joined with a view-only link, so you cannot send this.');
    const secret = body.secret ?? {}; const header = this.header(t, id, kind, this.o.deviceId); let key: Uint8Array; let kid: string;
    if (kind === 'key.grant') { const bp = typeof body.p === 'function' ? {} : body.p; const to = String(bp?.to_device ?? ''); const kids = (bp?.kids as string[] | undefined) ?? []; kid = o.kid ?? kids.at(-1) ?? 'k1'; key = grantTransportKey(this.o.sid, to); }
    else { const cur = o.kid ? { kid: o.kid, key: this.o.ring.get(o.kid) } : this.o.ring.current(); if (!cur.key) throw new SessionError('no_key', 'There is no key for that epoch yet.'); kid = cur.kid; key = cur.key; }
    let ct: Ciphertext; try { ct = encryptPayload({ key, kid, header, secret }); } catch (e) { if (e instanceof CryptoError && e.code === 'too_large') throw new SessionError('too_large', 'That message is too large to send in one piece.'); throw e; }
    const ctBytes = Math.floor((ct.c.length * 3) / 4); const rawP = typeof body.p === 'function' ? body.p({ ctBytes }) : body.p; const p = mode === 'hybrid' ? rawP ?? {} : undefined; const sig = signFrame(this.o.device.signingKey(), { header, ct, ...(p !== undefined ? { p } : {}) });
    const out: Outbound = { t, id, k: kind, ct, sig, ...(p !== undefined ? { p } : {}) }; assertWritableFrame({ v: 1, sid: this.o.sid, ...out }); return out;
  }

  decode(f: SequencedFrame): Decoded {
    const kind = f.k ?? ''; const base = { kind, seq: f.seq, id: f.id ?? '', from: f.from ?? '', ts: f.ts ?? '', verified: true as const };
    if (!f.ct) { // clear: whatever the relay stamped
      if (f.p !== undefined && !parseEventPayload(kind, f.p).ok && payloadMode(kind) === 'clear') return { ok: false, reason: 'invalid_payload' };
      return { ok: true, clear: true, event: { ...base, ...(f.p !== undefined ? { p: f.p } : {}) } };
    }
    const sender = this.o.roster.get(f.from); if (!sender?.keys) return { ok: false, reason: 'unknown_sender' }; if (sender.keyChanged || sender.keys.revoked) return { ok: false, reason: 'untrusted_device' };
    if (typeof f.sig !== 'string' || !f.sig) return { ok: false, reason: 'unsigned' };
    const header = this.header(f.t, f.id ?? '', kind, sender.keys.device); const mode = payloadMode(kind); const p = mode === 'hybrid' ? (f.p ?? {}) : undefined;
    let ok = false; try { ok = verifyFrame(unb64(sender.keys.ed25519), { header, ct: f.ct as Ciphertext, ...(p !== undefined ? { p } : {}) }, f.sig); } catch { ok = false; } if (!ok) return { ok: false, reason: 'bad_signature' };
    const grantKey = kind === 'key.grant' ? grantTransportKey(this.o.sid, String(f.p?.to_device ?? '')) : undefined; let secret: object;
    try { secret = decryptPayload({ keyFor: (kid) => grantKey ?? this.o.ring.get(kid), header, ct: f.ct as Ciphertext }); } catch (e) { const c = (e as CryptoError).code; return c === 'unknown_kid' ? { ok: false, reason: 'unknown_kid', kid: f.ct.kid } : c === 'too_large' ? { ok: false, reason: 'too_large' } : { ok: false, reason: 'aead_failed' }; }
    if (!parseSecretPayload(kind, secret).ok) return { ok: false, reason: 'invalid_payload' };
    return { ok: true, clear: false, event: { ...base, ...(f.p !== undefined ? { p: f.p } : {}), secret: secret as Record<string, unknown> } };
  }
}
